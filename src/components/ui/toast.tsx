'use client';

import { X, CheckCircle, XCircle, Warning, Info, ArrowClockwise, Gear, Bell } from '@/components/ui/icon';
import { useToastState, type Toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const ICON_MAP = {
  success: CheckCircle,
  error: XCircle,
  warning: Warning,
  info: Info,
  loading: ArrowClockwise,
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICON_MAP[toast.type] || Info;
  
  return (
    <div
      className={cn(
        'relative flex flex-col gap-2 rounded-[8px] border px-4 py-3 shadow-[0_4px_24px_rgba(0,0,0,0.08)] text-sm animate-in slide-in-from-bottom-2 fade-in duration-200 w-[360px]',
        'bg-[#F6F6F6] dark:bg-[#1E1E1E] border-border/60'
      )}
    >
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white shadow-sm",
            toast.type === 'success' ? 'bg-emerald-500' :
            toast.type === 'error' ? 'bg-red-500' :
            toast.type === 'warning' ? 'bg-amber-500' :
            'bg-[#0066cc]'
          )}>
            <Icon size={12} weight="bold" className={cn(toast.type === 'loading' && "animate-spin")} />
          </div>
          <span className="text-[14px] font-medium text-foreground/90 truncate">{toast.message}</span>
        </div>
        
        <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground/60">
          <button className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors" title="设置">
            <Gear size={15} />
          </button>
          <button className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors" title="通知">
            <Bell size={15} />
          </button>
          <button onClick={onDismiss} className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors ml-0.5" title="关闭">
            <X size={15} />
          </button>
        </div>
      </div>
      
      {(toast.source || toast.description || toast.action || true) && (
        <div className="flex items-end justify-between w-full mt-1 min-h-[28px]">
          <div className="text-[13px] text-muted-foreground/70 truncate pr-4 pb-0.5">
            {toast.source || toast.description || '来源: CodePilot'}
          </div>
          {toast.action && (
            <button
              className="flex h-[28px] px-3.5 items-center justify-center bg-[#0066cc] text-white hover:bg-[#0055b3] shadow-[0_1px_2px_rgba(0,0,0,0.1)] rounded-[6px] text-[13px] font-medium transition-all active:scale-95 shrink-0"
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

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}
