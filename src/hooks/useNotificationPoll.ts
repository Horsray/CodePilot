'use client';

import { useEffect, useRef } from 'react';
import { showToast, type ToastType } from '@/hooks/useToast';

const POLL_INTERVAL = 5_000; // 5s

const PRIORITY_TO_TOAST: Record<string, ToastType> = {
  low: 'info',
  normal: 'info',
  urgent: 'warning',
};

/**
 * Play a simple notification sound (beep) in the renderer process.
 */
function playNotificationSound() {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.05);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch {
    // Best effort — browser might block audio without user interaction
  }
}

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
          // Play sound if requested
          if (notif.sound) {
            playNotificationSound();
          }

          // In-app toast for all priorities
          showToast({
            type: PRIORITY_TO_TOAST[notif.priority] || 'info',
            message: notif.body ? `${notif.title}: ${notif.body}` : notif.title,
          });

          // System notification for normal/urgent via Electron IPC bridge
          if (notif.priority === 'normal' || notif.priority === 'urgent') {
            if (typeof window !== 'undefined' && window.electronAPI?.notification) {
              // Electron: use native notification via IPC (supports click-to-focus)
              window.electronAPI.notification.show({
                title: notif.title,
                body: notif.body || '',
              }).catch(() => {}); // best effort
            } else if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              // Browser fallback (dev mode)
              new Notification(notif.title, { body: notif.body || '' });
            }
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
