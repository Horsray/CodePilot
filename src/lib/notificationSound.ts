// 中文注释：通知音效合成模块（移植自 cc-haha）。用多谐波模拟真实乐器音色（玻璃/木琴），
// 比单一 sine 波更自然；三个预设供用户在设置里试听选择，偏好存 localStorage。

export type NotificationSoundId = 'glass' | 'ascending' | 'marimba';

const SOUND_STORAGE_KEY = 'codepilot-notification-sound';

export const NOTIFICATION_SOUNDS: Array<{ id: NotificationSoundId; label: string }> = [
  { id: 'glass', label: '清脆玻璃' },
  { id: 'ascending', label: '柔和上行' },
  { id: 'marimba', label: '温暖木琴' },
];

type Harmonic = { ratio: number; gain: number };

// 中文注释：合成一个带多个谐波分量的音符，ratio 为相对基频的倍数，gain 为该谐波相对音量。
function playNote(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  volume: number,
  harmonics: Harmonic[],
): void {
  for (const h of harmonics) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * h.ratio, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume * h.gain, startTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }
}

// 中文注释：清脆玻璃音，类似 macOS 提示声——高频明亮、快速衰减。
function playGlass(): void {
  const ctx = new AudioContext();
  const now = ctx.currentTime;
  playNote(ctx, 880, now, 0.6, 0.12, [
    { ratio: 1, gain: 1 },
    { ratio: 2, gain: 0.5 },
    { ratio: 3, gain: 0.25 },
    { ratio: 4, gain: 0.1 },
  ]);
  setTimeout(() => { void ctx.close().catch(() => {}); }, 800);
}

// 中文注释：柔和上行三音（E5→A5→C6），像竖琴一样依次展开，温暖不刺耳。
function playAscending(): void {
  const ctx = new AudioContext();
  const now = ctx.currentTime;
  const notes = [
    { f: 659.25, t: 0 },     // E5
    { f: 880, t: 0.09 },     // A5
    { f: 1046.5, t: 0.18 },  // C6
  ];
  for (const n of notes) {
    playNote(ctx, n.f, now + n.t, 0.5, 0.1, [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.3 },
    ]);
  }
  setTimeout(() => { void ctx.close().catch(() => {}); }, 1000);
}

// 中文注释：温暖木琴音，突出 4 倍与 8 倍泛音，像木质敲击、圆润厚实。
function playMarimba(): void {
  const ctx = new AudioContext();
  const now = ctx.currentTime;
  playNote(ctx, 523.25, now, 0.4, 0.12, [
    { ratio: 1, gain: 0.6 },
    { ratio: 4, gain: 1 },
    { ratio: 8, gain: 0.4 },
  ]);
  setTimeout(() => { void ctx.close().catch(() => {}); }, 600);
}

// 中文注释：根据音效 id 播放对应预设。
export function playNotificationSound(id: NotificationSoundId): void {
  try {
    if (id === 'glass') playGlass();
    else if (id === 'ascending') playAscending();
    else playMarimba();
  } catch {
    // Best effort — browser may block audio without user interaction
  }
}

export function getSelectedNotificationSound(): NotificationSoundId {
  try {
    const stored = localStorage.getItem(SOUND_STORAGE_KEY);
    if (stored === 'glass' || stored === 'ascending' || stored === 'marimba') return stored;
  } catch { /* noop */ }
  return 'glass';
}

export function setSelectedNotificationSound(id: NotificationSoundId): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, id);
  } catch { /* noop */ }
}
