'use client';

import { useEffect, useRef } from 'react';
import { showToast, type ToastType } from '@/hooks/useToast';
import { playNotificationSound, getSelectedNotificationSound } from '@/lib/notificationSound';

const POLL_INTERVAL = 5_000; // 5s

const PRIORITY_TO_TOAST: Record<string, ToastType> = {
  low: 'info',
  normal: 'info',
  urgent: 'warning',
};

/**
 * Polls GET /api/tasks/notify to drain server-side notification queue
 * and display them as toasts + system notifications via Electron IPC.
 */
export function useNotificationPoll() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Request notification permission on mount (web/dev mode only)
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      !window.electronAPI?.notification &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/tasks/notify');
        if (!res.ok) return;
        const data = await res.json();
        const notifications = data.notifications || [];

        for (const notif of notifications) {
          // 中文注释：按用户选择的音效预设播放（移植 cc-haha 的三档合成音）
          if (notif.sound) {
            playNotificationSound(getSelectedNotificationSound());
          }

          // 根据 notificationType 决定显示方式
          const notifType = notif.notificationType || 'default';

          if (notifType === 'task_complete') {
            // 任务完成：仅显示系统级通知，不显示右下角 toast
            if (typeof window !== 'undefined' && window.electronAPI?.notification) {
              window.electronAPI.notification.show({
                title: notif.title,
                body: notif.body || '',
              }).catch(() => {});
            } else if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              new Notification(notif.title, { body: notif.body || '' });
            }
          } else {
            // 其他通知：仅显示右下角 toast，不显示系统级通知
            showToast({
              type: PRIORITY_TO_TOAST[notif.priority] || 'info',
              message: notif.body ? `${notif.title}: ${notif.body}` : notif.title,
            });
          }
        }
      } catch {
        // Best effort polling
      }
    }

    timerRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
}
