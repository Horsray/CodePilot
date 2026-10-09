"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { SandpackFiles, SandpackSetup } from "@codesandbox/sandpack-react";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";

/*
 * SandpackPreview — Phase 2.1 of the Markdown/Artifact overhaul.
 *
 * Hosts a Sandpack-in-iframe preview for .jsx / .tsx source. Isolated from
 * first-paint via next/dynamic(ssr:false); only loaded when PreviewPanel
 * actually needs it.
 *
 * Security posture (Phase 2.1 default = s4): accept Sandpack's default
 * iframe sandbox string. Phase 2.5 will re-evaluate the 4 iframe attack
 * samples and upgrade to s2 (low-level sandpack-client + custom iframe)
 * if we need to drop allow-same-origin. See
 * docs/research/phase-0-pocs/0.5-sandpack-integration.md for the full
 * s1/s2/s3/s4 analysis.
 */

const SandpackProvider = dynamic(
  () => import("@codesandbox/sandpack-react").then((m) => m.SandpackProvider),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);
const SandpackLayout = dynamic(
  () => import("@codesandbox/sandpack-react").then((m) => m.SandpackLayout),
  { ssr: false },
);
const SandpackPreviewInner = dynamic(
  () => import("@codesandbox/sandpack-react").then((m) => m.SandpackPreview),
  { ssr: false },
);

/**
 * Dependency allowlist for Phase 2.1. Sandpack's bundler will 404 on imports
 * that aren't in customSetup.dependencies, so we pre-register the packages
 * AI-generated snippets most commonly reach for. Extend as user feedback
 * comes in — new entries here also need to be safe-to-load from Sandpack's
 * CDN resolver.
 */
const ALLOWED_DEPS_REACT: Record<string, string> = {
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  "lucide-react": "^0.468.0",
};

const ALLOWED_DEPS_VUE: Record<string, string> = {
  vue: "^3.4.0",
  "lucide-vue-next": "^0.468.0",
};

/**
 * External resources injected into the Sandpack preview iframe. Tailwind v4
 * Play CDN gives snippets utility classes without bundler-side PostCSS
 * config. For production/offline use, Phase 2.5 will consider inlining the
 * compiled CSS via customSetup.files instead (see POC 0.5 §G).
 */
const EXTERNAL_RESOURCES = [
  "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
];

export interface SandpackPreviewProps {
  /**
   * Source file path. Only the basename matters — it becomes the mount
   * point (e.g. "App.tsx"). Non-.jsx/.tsx names fall back to "/App.tsx"
   * since Sandpack's react-ts template entry expects that path.
   */
  filePath?: string;
  /** Source code. Empty / missing files render a "no content" stub. */
  content?: string;
  /**
   * Override bundler URL. Leave undefined for the hosted default
   * (https://sandpack-bundler.codesandbox.io). Set to a local URL when
   * the user runs the open-source bundler locally for offline work.
   * See POC 0.5 §F for setup instructions.
   */
  bundlerURL?: string;
}

/**
 * Small string hash for provider-key disambiguation. djb2 variant — fast,
 * good enough for "are these two payloads the same" in a React key, not
 * intended for any security purpose.
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash).toString(36);
}

/** Sandpack's react-ts template hard-codes /index.tsx → `import App from './App'`. */
const MOUNT_PATH = "/App.tsx";

export function SandpackPreview({ filePath, content, bundlerURL }: SandpackPreviewProps) {
  const [mountToken] = useState(() => Math.random().toString(36).slice(2));

  const isVue = filePath?.endsWith('.vue');
  const templateType = isVue ? "vue-ts" : "react-ts";
  const mountPath = isVue ? "/src/App.vue" : "/App.tsx";
  const allowedDeps = isVue ? ALLOWED_DEPS_VUE : ALLOWED_DEPS_REACT;

  const { files, setup, activeFile, providerKey } = useMemo(() => {
    const files: SandpackFiles = {
      [mountPath]: {
        code: content ?? (isVue ? "<template></template>" : "export default () => null;\n"),
        active: true,
      },
    };
    const setup: SandpackSetup = { dependencies: allowedDeps };
    const pathKey = filePath ?? "inline";
    const contentHash = hashString(content ?? "");
    const providerKey = `${pathKey}::${mountToken}::${contentHash}`;
    return { files, setup, activeFile: mountPath, providerKey };
  }, [filePath, content, mountToken, isVue, mountPath, allowedDeps]);

  return (
    <ErrorBoundary fallback={<PreviewError />}>
      <SandpackProvider
        key={providerKey}
        template={templateType}
        files={files}
        customSetup={setup}
        options={{
          activeFile,
          bundlerURL,
          externalResources: EXTERNAL_RESOURCES,
          recompileMode: "delayed",
          recompileDelay: 400,
          autorun: true,
        }}
        // Fill the parent panel height + kill the default card border that
        // made the preview occupy only half the panel. SandpackLayout's
        // default CSS wraps children in a bordered 480px-min-height box;
        // stretching the root div + removing border visually aligns the
        // preview with the rest of PreviewPanel's content area.
        style={{ height: "100%", display: "flex", flexDirection: "column" }}
      >
        <SandpackLayout
          style={{
            height: "100%",
            flex: 1,
            border: "none",
            borderRadius: 0,
          }}
        >
          <SandpackPreviewInner
            showOpenInCodeSandbox={false}
            showRefreshButton
            showSandpackErrorOverlay
            style={{ flex: 1, height: "100%" }}
          />
        </SandpackLayout>
      </SandpackProvider>
    </ErrorBoundary>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex h-full min-h-[480px] w-full items-center justify-center bg-muted/20">
      <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}

function PreviewError() {
  // Human-readable explanation of the MVP scope boundary. Phase 5.8
  // product decision — when Sandpack fails, the most common cause in
  // this product is "user's snippet uses a feature outside our first-
  // version support envelope" (multi-file, @ alias, CSS import). The
  // ErrorBoundary trip itself is rare; most failures show up inside
  // Sandpack's own error overlay, but this fallback catches the
  // catastrophic cases and still frames them in product terms.
  return (
    <div className="flex h-full min-h-[480px] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
      <p className="font-medium">Preview unavailable</p>
      <p className="text-xs max-w-sm">
        Single-file React/Vue preview only — multi-file imports, <code>@/</code>{" "}
        path aliases, CSS imports, and custom tsconfig aren’t supported in
        this version.
      </p>
    </div>
  );
}
