/**
 * pattern-tracker.ts — Layer 2: Pattern discovery and skill promotion.
 *
 * Tracks recurrence of learning entries via pattern-keys. When a pattern
 * meets promotion criteria (recurrence >= 3, cross-task, verified, not
 * project-specific), it evaluates whether to crystallize into a Skill.
 *
 * Storage: .patterns/PATTERNS.md in the working directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { type LearningEntry, getPromotionCandidates, resolveLearning } from './learning-store';

export interface PatternEntry {
  id: string;                // PAT-YYYYMMDD-NNN
  patternKey: string;
  description: string;
  category: string;
  area: string;
  recurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  status: 'tracking' | 'promoted' | 'dismissed';
  promotedSkillName?: string;
  evidence: string[];        // summaries from learning entries
}

const PATTERNS_DIR = '.patterns';
const PATTERNS_FILE = 'PATTERNS.md';

function getPatternsPath(workingDir: string): string {
  return path.join(workingDir, PATTERNS_DIR, PATTERNS_FILE);
}

function ensureDir(workingDir: string): void {
  const dir = path.join(workingDir, PATTERNS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateId(workingDir: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const existing = parsePatterns(workingDir);
  const todayEntries = existing.filter(e => e.id.startsWith(`PAT-${today}`));
  const seq = String(todayEntries.length + 1).padStart(3, '0');
  return `PAT-${today}-${seq}`;
}

/**
 * Parse all pattern entries from PATTERNS.md.
 */
export function parsePatterns(workingDir: string): PatternEntry[] {
  const filePath = getPatternsPath(workingDir);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: PatternEntry[] = [];
  const blocks = content.split(/^## /m).filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const idMatch = lines[0]?.match(/^(PAT-\d{8}-\d{3})/);
    if (!idMatch) continue;

    const entry: Partial<PatternEntry> = { id: idMatch[1] };

    for (const line of lines) {
      const keyMatch = line.match(/\*\*Pattern-Key\*\*:\s*(.+)/);
      const catMatch = line.match(/\*\*Category\*\*:\s*(.+)/);
      const areaMatch = line.match(/\*\*Area\*\*:\s*(.+)/);
      const countMatch = line.match(/\*\*Recurrence-Count\*\*:\s*(\d+)/);
      const firstMatch = line.match(/\*\*First-Seen\*\*:\s*(.+)/);
      const lastMatch = line.match(/\*\*Last-Seen\*\*:\s*(.+)/);
      const statusMatch = line.match(/\*\*Status\*\*:\s*(\S+)/);
      const skillMatch = line.match(/\*\*Promoted-Skill\*\*:\s*(.+)/);

      if (keyMatch) entry.patternKey = keyMatch[1].trim();
      if (catMatch) entry.category = catMatch[1].trim();
      if (areaMatch) entry.area = areaMatch[1].trim();
      if (countMatch) entry.recurrenceCount = parseInt(countMatch[1], 10);
      if (firstMatch) entry.firstSeen = firstMatch[1].trim();
      if (lastMatch) entry.lastSeen = lastMatch[1].trim();
      if (statusMatch) entry.status = statusMatch[1] as PatternEntry['status'];
      if (skillMatch) entry.promotedSkillName = skillMatch[1].trim();
    }

    const descMatch = block.match(/### Description\s*\n(.+?)(?=\n###|\n$)/s);
    const evidenceMatch = block.match(/### Evidence\s*\n([\s\S]+?)(?=\n###|\n$)/);

    entry.description = descMatch?.[1]?.trim() || '';
    entry.evidence = evidenceMatch?.[1]?.trim().split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2)) || [];
    entry.recurrenceCount = entry.recurrenceCount || 1;

    if (entry.patternKey && entry.description) {
      entries.push(entry as PatternEntry);
    }
  }

  return entries;
}

/**
 * Upsert a pattern: create new or update existing with incremented count.
 */
export function upsertPattern(
  workingDir: string,
  input: {
    patternKey: string;
    description: string;
    category: string;
    area: string;
    evidenceSummary: string;
  }
): PatternEntry {
  ensureDir(workingDir);

  const existing = parsePatterns(workingDir);
  const now = new Date().toISOString();

  const match = existing.find(e => e.patternKey === input.patternKey && e.status !== 'dismissed');

  if (match) {
    match.recurrenceCount++;
    match.lastSeen = now;
    if (!match.evidence.includes(input.evidenceSummary)) {
      match.evidence.push(input.evidenceSummary);
      if (match.evidence.length > 10) match.evidence = match.evidence.slice(-10);
    }
    rewritePatterns(workingDir, existing);
    return match;
  }

  const entry: PatternEntry = {
    id: generateId(workingDir),
    patternKey: input.patternKey,
    description: input.description,
    category: input.category,
    area: input.area,
    recurrenceCount: 1,
    firstSeen: now,
    lastSeen: now,
    status: 'tracking',
    evidence: [input.evidenceSummary],
  };

  existing.push(entry);
  rewritePatterns(workingDir, existing);
  return entry;
}

/**
 * Mark a pattern as promoted to a skill.
 */
export function markPromoted(workingDir: string, patternKey: string, skillName: string): void {
  const entries = parsePatterns(workingDir);
  const entry = entries.find(e => e.patternKey === patternKey);
  if (entry) {
    entry.status = 'promoted';
    entry.promotedSkillName = skillName;
    rewritePatterns(workingDir, entries);
  }
}

/**
 * Evaluate promotion candidates from learnings.
 * Returns entries that meet all promotion criteria.
 */
export function evaluatePromotions(workingDir: string): Array<{
  pattern: PatternEntry;
  shouldPromote: boolean;
  reason: string;
}> {
  const candidates = getPromotionCandidates(workingDir, 3);
  const results: Array<{ pattern: PatternEntry; shouldPromote: boolean; reason: string }> = [];

  for (const learning of candidates) {
    const pattern = upsertPattern(workingDir, {
      patternKey: learning.patternKey,
      description: learning.summary,
      category: learning.category,
      area: learning.area,
      evidenceSummary: learning.summary,
    });

    // Promotion criteria
    const checks: Array<{ pass: boolean; reason: string }> = [
      { pass: pattern.recurrenceCount >= 3, reason: `recurrence=${pattern.recurrenceCount} < 3` },
      { pass: learning.status === 'resolved' || learning.status === 'pending', reason: `status=${learning.status}` },
      { pass: !isProjectSpecific(learning.details), reason: 'contains project-specific paths/values' },
    ];

    const failures = checks.filter(c => !c.pass);
    const shouldPromote = failures.length === 0;

    results.push({
      pattern,
      shouldPromote,
      reason: shouldPromote
        ? `Ready for promotion: ${pattern.recurrenceCount} recurrences, verified, generic`
        : `Not ready: ${failures.map(f => f.reason).join('; ')}`,
    });
  }

  return results;
}

/**
 * Heuristic: does the text contain project-specific paths or values?
 */
function isProjectSpecific(text: string): boolean {
  const patterns = [
    /\/Users\/\w+\//i,
    /C:\\Users/i,
    /\/home\/\w+\//i,
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,  // IP addresses
    /localhost:\d+/,
    /[a-f0-9]{8,}/,  // hashes
  ];
  return patterns.some(p => p.test(text));
}

/**
 * Get all patterns, optionally filtered.
 */
export function getPatterns(
  workingDir: string,
  filter?: { status?: PatternEntry['status']; category?: string }
): PatternEntry[] {
  let entries = parsePatterns(workingDir);
  if (filter?.status) entries = entries.filter(e => e.status === filter.status);
  if (filter?.category) entries = entries.filter(e => e.category === filter.category);
  return entries;
}

/**
 * Rewrite the entire PATTERNS.md from in-memory entries.
 */
function rewritePatterns(workingDir: string, entries: PatternEntry[]): void {
  const filePath = getPatternsPath(workingDir);
  ensureDir(workingDir);

  const header = `# Pattern Tracker

Tracks recurring patterns from learnings. When a pattern meets promotion
criteria (recurrence >= 3, cross-task, verified, generic), it is evaluated
for crystallization into a reusable Skill.

`;

  const blocks = entries.map(e => `## ${e.id} ${e.patternKey}
**Pattern-Key**: ${e.patternKey}
**Category**: ${e.category}
**Area**: ${e.area}
**Recurrence-Count**: ${e.recurrenceCount}
**First-Seen**: ${e.firstSeen}
**Last-Seen**: ${e.lastSeen}
**Status**: ${e.status}${e.promotedSkillName ? `\n**Promoted-Skill**: ${e.promotedSkillName}` : ''}

### Description
${e.description}

### Evidence
${e.evidence.map(ev => `- ${ev}`).join('\n')}
`);

  fs.writeFileSync(filePath, header + blocks.join('\n'), 'utf-8');
}
