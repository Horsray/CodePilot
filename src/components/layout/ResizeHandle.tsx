"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 中文注释：面板级拖拽调宽手柄（移植 cc-haha AppShell 的 ResizeHandle）——
 * 20px 宽命中区覆盖在卡片左边缘（left: -10px），hover 显示品牌色发光竖线；
 * pointermove 用 rAF 节流，拖拽期间全局 col-resize 光标并禁用 iframe/webview 指针事件。
 */
export function PanelResizeHandle({
  width,
  setWidth,
  onDragChange,
}: {
  width: number;
  setWidth: (w: number) => void;
  onDragChange?: (isDragging: boolean) => void;
}) {
  const [dragState, setDragState] = useState<{ startX: number; startWidth: number } | null>(null);
  const dragStateRef = useRef(dragState);
  const rafRef = useRef<number | null>(null);
  const latestWidthRef = useRef(width);

  useEffect(() => {
    dragStateRef.current = dragState;
    onDragChange?.(!!dragState);
  }, [dragState, onDragChange]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current) return;
      latestWidthRef.current = Math.max(260, current.startWidth + current.startX - event.clientX);
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setWidth(latestWidthRef.current);
        });
      }
    };

    const handlePointerUp = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        setWidth(latestWidthRef.current);
      }
      setDragState(null);
    };

    const style = document.createElement("style");
    style.innerHTML = `* { cursor: col-resize !important; } iframe, webview { pointer-events: none !important; }`;
    document.head.appendChild(style);
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove, { capture: true });
    window.addEventListener("pointerup", handlePointerUp, { capture: true });
    window.addEventListener("pointercancel", handlePointerUp, { capture: true });

    return () => {
      document.head.removeChild(style);
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp, { capture: true });
      window.removeEventListener("pointercancel", handlePointerUp, { capture: true });
    };
  }, [dragState, setWidth]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        latestWidthRef.current = width;
        setDragState({ startX: event.clientX, startWidth: width });
      }}
      className="group absolute left-[-10px] top-0 bottom-0 z-20 flex w-[20px] cursor-col-resize items-stretch justify-center outline-none"
    >
      <div className="absolute inset-0 rounded-full bg-primary/5 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="my-auto h-full w-px bg-primary opacity-0 shadow-[0_0_8px_var(--primary),0_0_16px_var(--primary)] transition-opacity group-hover:opacity-100" />
    </div>
  );
}

interface ResizeHandleProps {
  side: "left" | "right";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

export function ResizeHandle({ side, onResize, onResizeEnd }: ResizeHandleProps) {
  const isDragging = useRef(false);
  const startX = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      // Capture pointer so all subsequent events route here, even over iframes
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
      onResize(delta);
    },
    [onResize]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd?.();
    },
    [onResizeEnd]
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={cn(
        "group relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center touch-none",
        side === "left" ? "-ml-0.5" : "-mr-0.5"
      )}
    >
      <div className="h-full w-px bg-transparent transition-colors duration-150 group-hover:bg-border" />
    </div>
  );
}
