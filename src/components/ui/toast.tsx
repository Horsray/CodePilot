'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/components/ui/icon';
import { useToastState, type Toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

// 中文注释：Toast 视觉对齐 cc-haha —— 280px 卡片、品牌色图标章、右上角滑入、token 化配色。
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs',
        'shadow-[0_4px_24px_rgba(0,0,0,0.12)] w-[280px]',
        'bg-[var(--surface)] border-[var(--border)]',
        'animate-in slide-in-from-right-2 fade-in duration-200'
      )}
    >
      <div className="flex items-start justify-between w-full gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/toast-icon.png"
              alt=""
              className={cn('h-5 w-5 object-cover', toast.type === 'loading' && 'animate-pulse')}
            />
          </div>
          <span className="text-xs font-medium text-[var(--text-primary)] break-words" title={toast.message}>
            {toast.message}
          </span>
        </div>

        <button
          onClick={onDismiss}
          className="p-1 rounded hover:bg-[var(--surface-container-low)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      {(toast.source || toast.description || toast.action) && (
        <div className="flex items-end justify-between w-full min-h-[28px]">
          <div
            className="text-[10px] text-[var(--text-tertiary)] break-words pr-3"
            title={toast.source || toast.description}
          >
            {toast.source || toast.description}
          </div>
          {toast.action && (
            <button
              className="flex h-7 px-3 items-center justify-center bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90 transition-opacity shrink-0"
              onClick={() => {
                toast.action?.onClick();
                onDismiss();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Toaster() {
  const { toasts, removeToast } = useToastState();
  const [container, setContainer] = useState<Element | null>(null);

  useEffect(() => {
    setContainer(document.body);
  }, []);

  if (toasts.length === 0 || !container) return null;

  // 中文注释：对齐 cc-haha —— toast 显示在右上角
  return createPortal(
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-xs">
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  , container);
}
