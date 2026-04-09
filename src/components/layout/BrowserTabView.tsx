"use client";

import dynamic from "next/dynamic";
import { usePanel } from "@/hooks/usePanel";

const BuiltinBrowser = dynamic(
  () => import("@/components/browser/BuiltinBrowser").then((m) => ({ default: m.BuiltinBrowser })),
  { ssr: false }
);

export function BrowserTabView() {
  const { browserUrl } = usePanel();

  return (
    <div className="flex flex-col h-full w-full">
      <BuiltinBrowser initialUrl={browserUrl} />
    </div>
  );
}
