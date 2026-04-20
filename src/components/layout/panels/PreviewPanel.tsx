"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { X, Copy, Check, SpinnerGap, Image as ImageIcon } from "@/components/ui/icon";
import { exportHtmlAsLongShot, ArtifactExportError } from "@/lib/artifact-export";
import { Button } from "@/components/ui/button";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { useThemeFamily } from "@/lib/theme/context";
import { resolveCodeTheme, resolveHljsStyle } from "@/lib/theme/code-themes";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import type { FilePreview as FilePreviewType } from "@/types";

// Sandpack is pulled in lazily via next/dynamic so its ~MB runtime (React
// bundler + iframe bootstrap) doesn't ship with the first-paint chunk. Only
// loaded when a .jsx/.tsx file is previewed (or inline-jsx source is set).
const SandpackPreview = dynamic(
  () => import("@/components/editor/SandpackPreview").then((m) => m.SandpackPreview),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center py-12"><SpinnerGap size={20} className="animate-spin text-muted-foreground" /></div> },
);

// CodeMirror Markdown editor (Phase 4.3 surface). Only reached when the
// user flips viewMode to "edit" on an EDITABLE_EXTENSIONS file, so the
// ~135 KB chunk stays out of first paint just like Sandpack does.
const MarkdownEditor = dynamic(
  () => import("@/components/editor/MarkdownEditor").then((m) => m.MarkdownEditor),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center py-12"><SpinnerGap size={20} className="animate-spin text-muted-foreground" /></div> },
);

// Lazy-load Streamdown and plugins — only loaded when rendered markdown is needed
let _StreamdownComponent: typeof import("streamdown").Streamdown | null = null;
let _streamdownPlugins: Record<string, unknown> | null = null;
let _streamdownPromise: Promise<void> | null = null;

function loadStreamdown(): Promise<void> {
  if (_streamdownPromise) return _streamdownPromise;
  _streamdownPromise = Promise.all([
    import("streamdown"),
    import("@streamdown/cjk"),
    import("@streamdown/code"),
    import("@streamdown/math"),
    import("@streamdown/mermaid"),
  ]).then(([sd, cjkMod, codeMod, mathMod, mermaidMod]) => {
    _StreamdownComponent = sd.Streamdown;
    _streamdownPlugins = {
      cjk: cjkMod.cjk,
      code: codeMod.code,
      math: mathMod.math,
      mermaid: mermaidMod.mermaid,
    };
  }).catch((err) => {
    // Reset so next call retries instead of caching the rejected promise
    _streamdownPromise = null;
    throw err;
  });
  return _streamdownPromise;
}

type ViewMode = "source" | "rendered" | "edit";

/** Extensions that support a rendered preview */
const RENDERABLE_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm", ".jsx", ".tsx"]);

/** Extensions rendered through Sandpack (React-in-iframe) */
const SANDPACK_EXTENSIONS = new Set([".jsx", ".tsx"]);

/**
 * Extensions that can be edited via the CodeMirror MarkdownEditor surface.
 *
 * Gated to plain-text formats CodeMirror's markdown grammar handles well.
 * .mdx is included because lang-markdown tolerates JSX fragments fine at
 * the source level. Code extensions (.ts, .js, .json, ...) are excluded
 * because they'd want proper language grammars; adding them would also
 * invite confusion about the Save-writes-to-disk contract on files that
 * might be part of the running app.
 */
const EDITABLE_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);

function isSandpack(filePath: string): boolean {
  return SANDPACK_EXTENSIONS.has(getExtension(filePath));
}

function isEditable(filePath: string): boolean {
  return EDITABLE_EXTENSIONS.has(getExtension(filePath));
}

/** Media file extensions that get direct preview (no API fetch needed) */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".avif", ".ico"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".aac"]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

function isRenderable(filePath: string): boolean {
  return RENDERABLE_EXTENSIONS.has(getExtension(filePath));
}

function isImagePreview(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

function isVideoPreview(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filePath));
}

function isAudioPreview(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtension(filePath));
}

function isMediaPreview(filePath: string): boolean {
  return isImagePreview(filePath) || isVideoPreview(filePath) || isAudioPreview(filePath);
}

function isHtml(filePath: string): boolean {
  const ext = getExtension(filePath);
  return ext === ".html" || ext === ".htm";
}

const PREVIEW_MIN_WIDTH = 320;
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_DEFAULT_WIDTH = 480;

export function PreviewPanel() {
  const { resolvedTheme } = useTheme();
  const { workingDirectory, sessionId, previewSource, previewFile, setPreviewFile, previewViewMode, setPreviewViewMode, setPreviewOpen } = usePanel();
  const isDark = resolvedTheme === "dark";
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(PREVIEW_DEFAULT_WIDTH);

  const handleResize = useCallback((delta: number) => {
    // Left-side handle: dragging left (negative delta) = wider
    setWidth((w) => Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, w - delta)));
  }, []);

  const filePath = previewFile || "";

  useEffect(() => {
    if (!filePath || isMediaPreview(filePath)) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    // Clear the previous file's preview and flip to loading *synchronously*
    // before any fetch. Without this, the first render after filePath
    // changes still carries the old preview.content, and SandpackPreview
    // (whose React key is filePath) gets mounted for the *new* file using
    // the *old* content. Even though we remount seconds later with the
    // correct content, Sandpack's bundler worker / service worker cache
    // can key the compiled result by the new mount path + old content,
    // which is exactly the "Counter.tsx shows Hello One" symptom.
    // Blanking preview forces the <preview ?> branch to fall through to
    // the loading spinner, so SandpackPreview isn't mounted until we
    // have the right content for the new filePath.
    setLoading(true);
    setPreview(null);
    setError(null);

    async function loadPreview() {
      setError(null);
      try {
        // maxLines is omitted so the API picks a per-extension cap
        // (50k lines for Markdown/text/log/csv, 1k for code).
        // See src/lib/files.ts EXTENSION_LINE_CAPS.
        const res = await fetch(
          `/api/files/preview?path=${encodeURIComponent(filePath)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`
        );
        if (!res.ok) {
          const data = await res.json();
          // Map structured error codes from /api/files/preview to friendly
          // i18n strings. Falls back to raw API message when code is unknown.
          const friendly =
            data.code === 'file_too_large' ? t('filePreview.tooLarge') :
            data.code === 'binary_not_previewable' ? t('filePreview.binaryNotPreviewable') :
            data.code === 'not_found' ? t('filePreview.notFound') :
            (data.error || t('filePreview.failedToLoad'));
          throw new Error(friendly);
        }
        const data = await res.json();
        if (!cancelled) {
          setPreview(data.preview);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('filePreview.failedToLoad'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [filePath, workingDirectory]);

  const handleCopyContent = async () => {
    const text = preview?.content || filePath;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Whether the current preview source is an HTML document we can ship
  // to the Phase 3 long-shot IPC. Only lit up when there's real HTML
  // content to send — file branches need preview.content loaded, inline
  // branches use source.html directly.
  const exportableHtml: string | null = useMemo(() => {
    if (previewSource?.kind === 'inline-html') return previewSource.html;
    if (previewSource?.kind === 'file' && isHtml(filePath) && preview?.content) {
      return preview.content;
    }
    return null;
  }, [previewSource, filePath, preview?.content]);

  const [exporting, setExporting] = useState(false);

  // Editor state for Phase 4.3 edit mode. editContent is the in-memory
  // buffer the CodeMirror surface writes to; saving pushes it to
  // /api/files/write and overwrites the on-disk content. The buffer is
  // reseeded whenever the loaded preview changes (switching files, or
  // the on-disk version updating via another path) so the editor always
  // starts from the latest source of truth.
  const [editContent, setEditContent] = useState<string>("");
  const [savedContent, setSavedContent] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editJustSaved, setEditJustSaved] = useState(false);
  useEffect(() => {
    if (preview?.content !== undefined) {
      setEditContent(preview.content);
      setSavedContent(preview.content);
    }
  }, [preview?.content]);
  const editDirty = editContent !== savedContent;

  const handleSaveEdit = useCallback(async () => {
    if (!editDirty || savingEdit) return;
    if (previewSource?.kind !== "file") return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: previewSource.filePath,
          baseDir: workingDirectory || undefined,
          content: editContent,
          overwrite: true,
          createParents: false,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Save failed: ${data.error || res.statusText}`);
        return;
      }
      // Success — sync savedContent so the dirty indicator clears, plus
      // flash a 2s "Saved" label in the toolbar.
      setSavedContent(editContent);
      setEditJustSaved(true);
      setTimeout(() => setEditJustSaved(false), 2000);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingEdit(false);
    }
  }, [editDirty, savingEdit, previewSource, editContent, workingDirectory]);
  const handleExportLongShot = useCallback(async () => {
    if (!exportableHtml) return;
    setExporting(true);
    try {
      // Compute basename locally so this callback doesn't depend on the
      // `fileName` variable declared later in the component — avoids
      // a TDZ (let/const before initialization) error at mount time.
      const virtualName =
        previewSource?.kind === 'inline-html' ? previewSource.virtualName ?? 'preview.html' :
        previewSource?.kind === 'file' ? (filePath.split('/').pop() || filePath) :
        'artifact';
      await exportHtmlAsLongShot({
        html: exportableHtml,
        filename: virtualName.replace(/\.[^.]+$/, '') || 'artifact',
        width: 1024,
      });
    } catch (err) {
      if (err instanceof ArtifactExportError) {
        // Surface the code so users know whether it was a transient busy
        // state or a hard limit. Full toast/i18n wiring is Phase 3
        // polish — for now, alert() is acceptable for this short flow.
        alert(`Export failed: ${err.code} — ${err.message}`);
      } else {
        alert(`Export failed: ${String(err)}`);
      }
    } finally {
      setExporting(false);
    }
  }, [exportableHtml, filePath, previewSource]);

  const handleClose = () => {
    setPreviewFile(null);
    setPreviewOpen(false);
  };

  // Header title: file uses basename; inline-* sources use virtualName or
  // a kind-appropriate default ("preview.html", "preview.jsx", "table").
  const fileName =
    previewSource?.kind === "inline-html" ? (previewSource.virtualName ?? "preview.html") :
    previewSource?.kind === "inline-jsx" ? (previewSource.virtualName ?? "preview.jsx") :
    previewSource?.kind === "inline-datatable" ? (previewSource.virtualName ?? "table") :
    filePath.split("/").pop() || filePath;

  const breadcrumb = useMemo(() => {
    // Inline sources have no filesystem path — show a zero-width breadcrumb
    // so the row layout stays consistent without misleading virtual paths.
    if (previewSource && previewSource.kind !== "file") return "";
    const segments = filePath.split("/").filter(Boolean);
    const display = segments.slice(-3);
    const prefix = display.length < segments.length ? ".../" : "";
    return prefix + display.join("/");
  }, [filePath, previewSource]);

  const canRender = isRenderable(filePath);
  const isMedia = isMediaPreview(filePath);

  // Build direct file serve URL for media files.
  // Prefer /api/files/serve (session-scoped) when sessionId is available;
  // fall back to /api/files/raw (home-scoped) for pre-session state.
  const fileServeUrl = filePath
    ? sessionId
      ? `/api/files/serve?path=${encodeURIComponent(filePath)}&sessionId=${encodeURIComponent(sessionId)}`
      : `/api/files/raw?path=${encodeURIComponent(filePath)}`
    : '';

  return (
    <div className="flex h-full shrink-0 overflow-hidden">
      <ResizeHandle side="left" onResize={handleResize} />
      <div className="flex h-full flex-1 flex-col overflow-hidden border-r border-border/40 bg-background" style={{ width }}>
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileName}</p>
        </div>

        {canRender && !isMedia && (
          <ViewModeToggle
            value={previewViewMode}
            onChange={setPreviewViewMode}
            showEdit={previewSource?.kind === "file" && isEditable(filePath)}
          />
        )}

        {/* Save button — only visible in edit mode. Mirrors the unsaved-
            dot + label affordance from SkillEditor so the two editing
            surfaces feel consistent. Cmd+S inside the editor triggers the
            same handler, so this is an alternate path for mouse users. */}
        {previewViewMode === "edit" && previewSource?.kind === "file" && isEditable(filePath) && (
          <>
            {editDirty && (
              <span
                className="h-2 w-2 rounded-full bg-status-warning shrink-0"
                title="Unsaved changes"
              />
            )}
            <Button
              size="xs"
              onClick={handleSaveEdit}
              disabled={!editDirty || savingEdit}
              className="gap-1"
            >
              {savingEdit ? (
                <SpinnerGap size={12} className="animate-spin" />
              ) : null}
              {savingEdit ? "Saving" : editJustSaved ? "Saved" : "Save"}
            </Button>
          </>
        )}

        {!isMedia && (
          <Button variant="ghost" size="icon-sm" onClick={handleCopyContent}>
            {copied ? (
              <Check size={14} className="text-status-success-foreground" />
            ) : (
              <Copy size={14} />
            )}
            <span className="sr-only">Copy content</span>
          </Button>
        )}

        {/* Phase 3 long-shot export — only surfaces when we have concrete
            HTML to ship to the IPC. Markdown and Sandpack/JSX variants
            need a serialization step (Streamdown -> HTML, or
            Sandpack files -> esbuild -> HTML) that's Phase 3 follow-up. */}
        {exportableHtml && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleExportLongShot}
            disabled={exporting}
            title="Export long screenshot"
          >
            {exporting ? (
              <SpinnerGap size={14} className="animate-spin" />
            ) : (
              <ImageIcon size={14} />
            )}
            <span className="sr-only">Export long screenshot</span>
          </Button>
        )}

        <Button variant="ghost" size="icon-sm" onClick={handleClose}>
          <X size={14} />
          <span className="sr-only">Close preview</span>
        </Button>
      </div>

      {/* Breadcrumb + language */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
          {breadcrumb}
        </p>
        {preview && !isMedia && (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {preview.language}
          </span>
        )}
      </div>

      {/* Content — dispatch on previewSource.kind. The file branch preserves
          the pre-Phase-1.5 behavior (fetch via API + render via
          MediaView/RenderedView/SourceView). inline-html delegates to a
          sandboxed iframe. inline-jsx / inline-datatable render placeholders
          that Phase 2.1 / Phase 5.4 will fill in with real renderers. */}
      <div className="flex-1 min-h-0 overflow-auto">
        {previewSource?.kind === "inline-html" ? (
          <InlineHtmlView html={previewSource.html} />
        ) : previewSource?.kind === "inline-jsx" ? (
          // key forces remount when the inline JSX source changes, so
          // Sandpack boots fresh instead of recompiling on top of the
          // previous iframe state.
          <SandpackPreview
            key={`inline-${previewSource.virtualName ?? "jsx"}-${previewSource.jsx.length}`}
            content={previewSource.jsx}
            filePath={previewSource.virtualName}
          />
        ) : previewSource?.kind === "inline-datatable" ? (
          <InlinePlaceholder phase="Phase 5.4 (DataTable)" kind="inline-datatable" />
        ) : isMedia ? (
          <MediaView filePath={filePath} fileServeUrl={fileServeUrl} />
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : preview ? (
          <>
            {previewViewMode === "edit" && isEditable(filePath) ? (
              // Phase 4.3: CodeMirror editor for .md/.mdx/.txt. Cmd+S calls
              // handleSaveEdit through the editor's keymap; the external
              // Save button in the toolbar is a second path to the same
              // handler for people who prefer clicking.
              <MarkdownEditor
                value={editContent}
                onChange={setEditContent}
                onSave={handleSaveEdit}
                filename={filePath}
              />
            ) : previewViewMode === "rendered" && canRender ? (
              <RenderedView content={preview.content} filePath={filePath} />
            ) : (
              <SourceView preview={preview} isDark={isDark} />
            )}
            {previewViewMode !== "edit" && preview.truncated && <TruncationBanner preview={preview} />}
          </>
        ) : null}
      </div>
      </div>
    </div>
  );
}

/**
 * Banner shown at the bottom of a truncated preview.
 *
 * The API enforces per-extension line caps + a 10MB byte ceiling (see
 * src/lib/files.ts). When a file exceeds either, `preview.truncated` is true
 * and this banner tells the user what they got vs what the file actually
 * contains, so they don't silently act on partial content.
 */
function TruncationBanner({ preview }: { preview: FilePreviewType }) {
  const { t } = useTranslation();
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
  return (
    <div className="sticky bottom-0 border-t border-border/40 bg-muted/80 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
      {t('filePreview.truncated', {
        lines: preview.line_count,
        bytesReadMb: mb(preview.bytes_read),
        bytesTotalMb: mb(preview.bytes_total),
      })}
    </div>
  );
}

/**
 * Capsule toggle for Source / Preview / Edit view modes.
 *
 * `showEdit` hides the Edit pill for file types without a matching
 * editor — we don't want users to click "Edit" on .ts files and get
 * confused when Save doesn't materialize (EDITABLE_EXTENSIONS gates
 * actual save behavior too, but hiding the button is the UX-level fix).
 */
function ViewModeToggle({
  value,
  onChange,
  showEdit,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  showEdit: boolean;
}) {
  const pill = (mode: ViewMode, label: string) => (
    <Button
      variant="ghost"
      size="sm"
      className={`rounded-full px-2 py-0.5 font-medium h-auto ${
        value === mode
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={() => onChange(mode)}
    >
      {label}
    </Button>
  );
  return (
    <div className="flex h-6 items-center rounded-full bg-muted p-0.5 text-[11px]">
      {showEdit && pill("edit", "Edit")}
      {pill("source", "Source")}
      {pill("rendered", "Preview")}
    </div>
  );
}

/** Resolve hljs style from the current theme family + mode. */
function useDocCodeTheme(isDark: boolean) {
  const { family, families } = useThemeFamily();
  const codeTheme = resolveCodeTheme(families, family);
  return resolveHljsStyle(codeTheme, isDark);
}

/** Source code view using react-syntax-highlighter */
function SourceView({ preview, isDark }: { preview: FilePreviewType; isDark: boolean }) {
  const hljsStyle = useDocCodeTheme(isDark);
  return (
    <div className="text-xs">
      <SyntaxHighlighter
        language={preview.language}
        style={hljsStyle}
        showLineNumbers
        customStyle={{
          margin: 0,
          padding: "8px",
          borderRadius: 0,
          fontSize: "11px",
          lineHeight: "1.5",
          background: "transparent",
        }}
        lineNumberStyle={{
          minWidth: "2.5em",
          paddingRight: "8px",
          color: "var(--muted-foreground)",
          opacity: 0.5,
          userSelect: "none",
        }}
      >
        {preview.content}
      </SyntaxHighlighter>
    </div>
  );
}

/**
 * Inline HTML preview — Phase 1.5.
 *
 * Renders a caller-provided HTML string inside a fully sandboxed iframe.
 * `sandbox=""` (empty) disables scripts, plugins, forms, and same-origin
 * access — the strictest setting. If Phase 2 needs to relax this for
 * interactive HTML artifacts, do it at the caller level by switching to
 * `inline-jsx` (Sandpack) instead, not by loosening the sandbox here.
 */
function InlineHtmlView({ html }: { html: string }) {
  const { t } = useTranslation();
  return (
    <iframe
      srcDoc={html}
      sandbox=""
      className="h-full w-full border-0"
      title={t("docPreview.htmlPreview")}
    />
  );
}

/**
 * Placeholder for preview kinds whose real renderer lands in a later Phase.
 *
 * Showing a visible "coming soon" block (rather than null) makes two things
 * observable in Phase 1.5 smoke tests: (1) PanelZone gate actually mounts
 * the panel for inline-* sources (R1 regression detector), and (2) the
 * caller wired up setPreviewSource correctly.
 */
function InlinePlaceholder({ phase, kind }: { phase: string; kind: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-muted-foreground">
        {kind} preview lands in {phase}
      </p>
      <p className="text-xs text-muted-foreground/60">
        The data channel (PreviewSource → PreviewPanel) is wired; renderer is pending.
      </p>
    </div>
  );
}

/** Direct media preview — no API fetch needed */
function MediaView({ filePath, fileServeUrl }: { filePath: string; fileServeUrl: string }) {
  if (isImagePreview(filePath)) {
    return (
      <div className="flex items-center justify-center p-4 h-full">
        <img
          src={fileServeUrl}
          alt={filePath.split('/').pop() || ''}
          className="max-w-full max-h-full object-contain rounded"
        />
      </div>
    );
  }

  if (isVideoPreview(filePath)) {
    return (
      <div className="flex items-center justify-center p-4 h-full">
        <video
          src={fileServeUrl}
          controls
          preload="metadata"
          className="max-w-full max-h-full rounded"
        />
      </div>
    );
  }

  if (isAudioPreview(filePath)) {
    return (
      <div className="flex items-center justify-center p-8">
        <audio src={fileServeUrl} controls preload="metadata" className="w-full" />
      </div>
    );
  }

  return null;
}
function RenderedView({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadStreamdown().then(() => setReady(true)).catch(() => {});
  }, []);

  if (isHtml(filePath)) {
    return (
      <iframe
        srcDoc={content}
        sandbox=""
        className="h-full w-full border-0"
        title={t('docPreview.htmlPreview')}
      />
    );
  }

  // .jsx / .tsx → Sandpack (React in iframe). See POC 0.5 for the s4
  // default-sandbox security posture and the upgrade path to s2 if
  // Phase 2.5 demands stricter iframe isolation.
  //
  // key ties the SandpackPreview instance to the concrete file path, so
  // clicking a different .tsx from the same folder rebuilds the preview
  // from scratch instead of serving the previously-compiled one.
  if (isSandpack(filePath)) {
    return <SandpackPreview key={filePath} filePath={filePath} content={content} />;
  }

  // Markdown / MDX — wait for Streamdown to load
  if (!ready || !_StreamdownComponent || !_streamdownPlugins) {
    return (
      <div className="flex items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const Sd = _StreamdownComponent;
  return (
    <div className="px-6 py-4 overflow-x-hidden break-words">
      <Sd
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-6 [&_ol]:pl-6"
        plugins={_streamdownPlugins}
      >
        {content}
      </Sd>
    </div>
  );
}
