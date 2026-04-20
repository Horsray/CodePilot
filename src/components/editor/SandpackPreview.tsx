"use client";

import { useMemo } from "react";
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
const ALLOWED_DEPS: Record<string, string> = {
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  "lucide-react": "^0.468.0",
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
 * Normalize an arbitrary source path to Sandpack's virtual filesystem.
 * Sandpack requires the entry file to have a known JSX/TSX extension so its
 * template configuration picks the right transform.
 */
function inferMountPath(filePath?: string): string {
  if (!filePath) return "/App.tsx";
  const base = filePath.split("/").pop() ?? "App.tsx";
  return base.endsWith(".tsx") || base.endsWith(".jsx") ? `/${base}` : "/App.tsx";
}

export function SandpackPreview({ filePath, content, bundlerURL }: SandpackPreviewProps) {
  const { files, setup, activeFile } = useMemo(() => {
    const mount = inferMountPath(filePath);
    const files: SandpackFiles = {
      [mount]: {
        code: content ?? "export default () => null;\n",
        active: true,
      },
    };
    const setup: SandpackSetup = { dependencies: ALLOWED_DEPS };
    return { files, setup, activeFile: mount };
  }, [filePath, content]);

  return (
    <ErrorBoundary fallback={<PreviewError />}>
      <SandpackProvider
        template="react-ts"
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
      >
        <SandpackLayout style={{ height: "100%" }}>
          <SandpackPreviewInner
            showOpenInCodeSandbox={false}
            showRefreshButton
            showSandpackErrorOverlay
            style={{ height: "100%", minHeight: 480 }}
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
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-[480px] items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {t("filePreview.sandpackError", { error: "SandpackPreview failed to load" })}
    </div>
  );
}
