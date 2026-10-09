"use client";

import dynamic from "next/dynamic";

interface BrowserTabViewProps {
  initialUrl?: string;
  onMetaChange?: (meta: { title?: string; url?: string }) => void;
}

const BuiltinBrowser = dynamic(
  () => import("@/components/browser/BuiltinBrowser").then((m) => ({ default: m.BuiltinBrowser })),
  { ssr: false }
);

export function BrowserTabView({ initialUrl, onMetaChange }: BrowserTabViewProps) {
  return (
    <div className="flex flex-col h-full w-full">
      <BuiltinBrowser
        initialUrl={initialUrl}
        onMetaChange={onMetaChange}
      />
    </div>
  );
}
