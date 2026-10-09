/**
 * learning-store.ts — Layer 1: Low-friction learning capture.
 *
 * Records observations during agent runs: failures, user corrections,
 * discovered better approaches, non-obvious solutions. Each entry is
 * lightweight — no quality gate, just accurate capture.
 *
 * Storage: .learnings/LEARNINGS.md in the working directory.
 * Entries are keyed by a pattern-key for dedup/tracking in Layer 2.
 */

import * as fs from 'fs';
import * as path from 'path';

export type LearningCategory =
  | 'failure'        // command/tool failed
  | 'correction'     // user corrected the AI
  | 'better-way'     // found a superior approach
  | 'non-obvious'    // solution wasn't obvious
  | 'api-behavior'   // API/tool behaved unexpectedly
  | 'architecture'   // project structure insight
  | 'workflow';      // reusable workflow step

export type LearningPriority = 'low' | 'medium' | 'high';
export type LearningStatus = 'pending' | 'resolved' | 'superseded';

export interface LearningEntry {
  id: string;                // LRN-YYYYMMDD-NNN
  category: LearningCategory;
  priority: LearningPriority;
  status: LearningStatus;
  area: string;              // frontend, backend, build, etc.
  patternKey: string;        // for dedup: "build.electron.rebuild"
  summary: string;
  details: string;
  suggestedAction: string;
  timestamp: string;         // ISO
  recurrenceCount: number;
  lastSeen: string;          // ISO
}

const LEARNINGS_DIR = '.learnings';
const LEARNINGS_FILE = 'LEARNINGS.md';

function getLearningsPath(workingDir: string): string {
  return path.join(workingDir, LEARNINGS_DIR, LEARNINGS_FILE);
}

function ensureDir(workingDir: string): void {
  const dir = path.join(workingDir, LEARNINGS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateId(workingDir: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const existing = parseLearnings(workingDir);
  const todayEntries = existing.filter(e => e.id.startsWith(`LRN-${today}`));
  const seq = String(todayEntries.length + 1).padStart(3, '0');
  return `LRN-${today}-${seq}`;
}

/**
 * Parse all learning entries from LEARNINGS.md.
 */
export function parseLearnings(workingDir: string): LearningEntry[] {
  const filePath = getLearningsPath(workingDir);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: LearningEntry[] = [];
  const blocks = content.split(/^## /m).filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const idMatch = lines[0]?.match(/^(LRN-\d{8}-\d{3})/);
    if (!idMatch) continue;

    const entry: Partial<LearningEntry> = { id: idMatch[1] };

    for (const line of lines) {
      const catMatch = line.match(/\*\*Category\*\*:\s*(\S+)/);
      const priMatch = line.match(/\*\*Priority\*\*:\s*(\S+)/);
      const statusMatch = line.match(/\*\*Status\*\*:\s*(\S+)/);
      const areaMatch = line.match(/\*\*Area\*\*:\s*(.+)/);
      const keyMatch = line.match(/\*\*Pattern-Key\*\*:\s*(.+)/);
      const recurMatch = line.match(/\*\*Recurrence-Count\*\*:\s*(\d+)/);
      const lastSeenMatch = line.match(/\*\*Last-Seen\*\*:\s*(.+)/);

      if (catMatch) entry.category = catMatch[1] as LearningCategory;
      if (priMatch) entry.priority = priMatch[1] as LearningPriority;
      if (statusMatch) entry.status = statusMatch[1] as LearningStatus;
      if (areaMatch) entry.area = areaMatch[1].trim();
      if (keyMatch) entry.patternKey = keyMatch[1].trim();
      if (recurMatch) entry.recurrenceCount = parseInt(recurMatch[1], 10);
      if (lastSeenMatch) entry.lastSeen = lastSeenMatch[1].trim();
    }

    // Extract sections
    const summaryMatch = block.match(/### Summary\s*\n(.+?)(?=\n###|\n$)/s);
    const detailsMatch = block.match(/### Details\s*\n(.+?)(?=\n###|\n$)/s);
    const actionMatch = block.match(/### Suggested Action\s*\n(.+?)(?=\n###|\n$)/s);

    entry.summary = summaryMatch?.[1]?.trim() || '';
    entry.details = detailsMatch?.[1]?.trim() || '';
    entry.suggestedAction = actionMatch?.[1]?.trim() || '';
    entry.timestamp = entry.lastSeen || new Date().toISOString();
    entry.recurrenceCount = entry.recurrenceCount || 1;

    if (entry.category && entry.summary) {
      entries.push(entry as LearningEntry);
    }
  }

  return entries;
}

/**
 * Record a new learning or increment recurrence of an existing one.
 * Returns the entry (new or updated).
 */
export function recordLearning(
  workingDir: string,
  input: {
    category: LearningCategory;
    priority?: LearningPriority;
    area?: string;
    patternKey: string;
    summary: string;
    details?: string;
    suggestedAction?: string;
  }
): LearningEntry {
  ensureDir(workingDir);

  const existing = parseLearnings(workingDir);
  const now = new Date().toISOString();

  // Check for existing entry with same pattern-key
  const match = existing.find(e => e.patternKey === input.patternKey && e.status !== 'superseded');

  if (match) {
    // Increment recurrence — update in-place
    match.recurrenceCount++;
    match.lastSeen = now;
    if (input.priority === 'high' && match.priority !== 'high') {
      match.priority = 'high';
    }
    rewriteLearnings(workingDir, existing);
    return match;
  }

  // New entry
  const entry: LearningEntry = {
    id: generateId(workingDir),
    category: input.category,
    priority: input.priority || 'medium',
    status: 'pending',
    area: input.area || 'general',
    patternKey: input.patternKey,
    summary: input.summary,
    details: input.details || '',
    suggestedAction: input.suggestedAction || '',
    timestamp: now,
    recurrenceCount: 1,
    lastSeen: now,
  };

  existing.push(entry);
  rewriteLearnings(workingDir, existing);
  return entry;
}

/**
 * Mark a learning as resolved.
 */
export function resolveLearning(workingDir: string, id: string): void {
  const entries = parseLearnings(workingDir);
  const entry = entries.find(e => e.id === id);
  if (entry) {
    entry.status = 'resolved';
    rewriteLearnings(workingDir, entries);
  }
}

/**
 * Get entries that are candidates for pattern promotion (recurrence >= threshold).
 */
export function getPromotionCandidates(workingDir: string, threshold: number = 3): LearningEntry[] {
  return parseLearnings(workingDir).filter(
    e => e.recurrenceCount >= threshold && e.status === 'pending'
  );
}

/**
 * Get all learnings, optionally filtered.
 */
export function getLearnings(
  workingDir: string,
  filter?: { category?: LearningCategory; status?: LearningStatus; area?: string }
): LearningEntry[] {
  let entries = parseLearnings(workingDir);
  if (filter?.category) entries = entries.filter(e => e.category === filter.category);
  if (filter?.status) entries = entries.filter(e => e.status === filter.status);
  if (filter?.area) entries = entries.filter(e => e.area === filter.area);
  return entries;
}

/**
 * Rewrite the entire LEARNINGS.md from in-memory entries.
 */
function rewriteLearnings(workingDir: string, entries: LearningEntry[]): void {
  const filePath = getLearningsPath(workingDir);
  ensureDir(workingDir);

  const header = `# Learnings Log

Auto-captured observations during agent runs. Each entry tracks a pattern
that may be promoted to a Skill after sufficient recurrence.

`;

  const blocks = entries.map(e => `## ${e.id} ${e.category}
**Category**: ${e.category}
**Priority**: ${e.priority}
**Status**: ${e.status}
**Area**: ${e.area}
**Pattern-Key**: ${e.patternKey}
**Recurrence-Count**: ${e.recurrenceCount}
**Last-Seen**: ${e.lastSeen}

### Summary
${e.summary}

### Details
${e.details || '(none)'}

### Suggested Action
${e.suggestedAction || '(none)'}
`);

  fs.writeFileSync(filePath, header + blocks.join('\n'), 'utf-8');
}
