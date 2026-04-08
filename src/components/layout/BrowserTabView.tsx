"use client";

import dynamic from "next/dynamic";
import { usePanel } from "@/hooks/usePanel";

const BuiltinBrowser = dynamic(
  () => import("@/components/browser/BuiltinBrowser").then((m) => ({ default: m.BuiltinBrowser })),
  { ssr: false }
);

/**
 * BrowserTabView — renders the browser as the main content area.
 * Tab switching is handled by UnifiedTopBar.
 */
export function BrowserTabView() {
  const { browserUrl } = usePanel();

  return (
    <div className="flex flex-col h-full w-full">
      <BuiltinBrowser initialUrl={browserUrl} />
    </div>
  );
}
