"use client";

import dynamic from "next/dynamic";
import { X, Globe } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";

const BuiltinBrowser = dynamic(
  () => import("@/components/browser/BuiltinBrowser").then((m) => ({ default: m.BuiltinBrowser })),
  { ssr: false }
);

/**
 * BrowserTabView — renders the browser as a full tab in the main content area,
 * with a tab bar at the top (like browser tabs).
 */
export function BrowserTabView() {
  const { browserTabOpen, setBrowserTabOpen, browserUrl } = usePanel();
  const { t } = useTranslation();

  if (!browserTabOpen) return null;

  return (
    <div className="flex flex-col h-full w-full">
      {/* Tab bar */}
      <div className="flex items-center h-9 bg-muted/30 border-b border-border/40 shrink-0 px-1 gap-0.5">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-background rounded-t-md border border-border/40 border-b-0 text-xs font-medium max-w-[200px]">
          <Globe size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{browserUrl || t('browser.title')}</span>
          <button
            onClick={() => setBrowserTabOpen(false)}
            className="ml-1 shrink-0 rounded-sm hover:bg-muted p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t('browser.close')}
          >
            <X size={10} />
          </button>
        </div>
      </div>

      {/* Browser content */}
      <div className="flex-1 min-h-0">
        <BuiltinBrowser initialUrl={browserUrl} />
      </div>
    </div>
  );
}
