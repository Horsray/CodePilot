"use client";

import { useCallback } from "react";
import { usePanel } from "@/hooks/usePanel";
import { EnhancedFileTree } from "@/components/project/EnhancedFileTree";
import { showToast } from "@/hooks/useToast";

export function FileTreePanel() {
  const { workingDirectory, setPreviewFile, setPreviewOpen } = usePanel();

  const handleFileSelect = useCallback((path: string) => {
    setPreviewFile(path);
    setPreviewOpen(true);
  }, [setPreviewFile, setPreviewOpen]);

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
    />
  );
}
