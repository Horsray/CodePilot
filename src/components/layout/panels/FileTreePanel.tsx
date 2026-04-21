"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { usePanel } from "@/hooks/usePanel";
import { EnhancedFileTree } from "@/components/project/EnhancedFileTree";
import { showToast } from "@/hooks/useToast";

export function FileTreePanel() {
  const { workingDirectory, sessionId, openPreviewTab } = usePanel();
  const searchParams = useSearchParams();

  const highlightPath = searchParams.get('file') || undefined;
  const highlightSeek = searchParams.get('seek') || undefined;

  const handleFileSelect = useCallback((path: string) => {
    openPreviewTab(path);
  }, [openPreviewTab]);

  const handleFileAdd = useCallback((path: string) => {
    window.dispatchEvent(new CustomEvent('attach-file-to-chat', { detail: { path } }));
    showToast({
      type: "success",
      message: "文件已添加到对话",
    });
  }, []);

  return (
    <EnhancedFileTree
      workingDirectory={workingDirectory}
      onFileSelect={handleFileSelect}
      onFileAdd={handleFileAdd}
      highlightPath={highlightPath}
      highlightSeek={highlightSeek}
    />
  );
}
