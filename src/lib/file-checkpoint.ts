/**
 * file-checkpoint.ts — File state checkpointing for native rewind.
 *
 * Before writing/editing files, captures a snapshot of the original file content.
 * On rewind, restores files to their pre-modification state using the snapshot,
 * preserving any uncommitted changes that existed before the session started.
 *
 * Key safety invariant: restoreCheckpoint NEVER uses `git checkout HEAD` because
 * that would destroy pre-session uncommitted changes. Instead it restores from
 * the in-memory snapshot captured before the first modification.
 */

import fs from 'fs';
import path from 'path';
import { getDb } from './db';

interface FileSnapshot {
  /** File content before modification (null = file didn't exist, should be deleted on restore) */
  content: string | null;
}

interface Checkpoint {
  /** Message ID this checkpoint corresponds to */
  messageId: string;
  /** Session ID */
  sessionId: string;
  /** Files modified after this checkpoint (relative paths) */
  modifiedFiles: string[];
  /** Pre-modification snapshots keyed by relative file path */
  snapshots: Map<string, FileSnapshot>;
  /** Timestamp */
  createdAt: number;
}

/**
 * Create a checkpoint before a file-modifying operation.
 */
export function createCheckpoint(sessionId: string, messageId: string, _cwd: string): void {
  // Legacy in-memory logic kept for temporary session tracking
}

/**
 * Record that a file is about to be modified.
 * Captures a snapshot of the file's current content BEFORE the modification and saves to DB.
 */
export function recordFileModification(sessionId: string, filePath: string, cwd?: string): void {
  if (!sessionId) return;
  const db = getDb();

  // Check if we already have a checkpoint for this file in this session
  const existing = db.prepare(
    'SELECT id FROM file_checkpoints WHERE session_id = ? AND file_path = ? LIMIT 1'
  ).get(sessionId, filePath);

  if (existing) return;

  const absPath = cwd ? path.resolve(cwd, filePath) : path.resolve(filePath);
  let content: string | null = null;
  try {
    if (fs.existsSync(absPath)) {
      content = fs.readFileSync(absPath, 'utf-8');
    }
  } catch (e) {
    console.error(`[file-checkpoint] Failed to read ${absPath}:`, e);
  }

  db.prepare(
    'INSERT INTO file_checkpoints (session_id, message_id, file_path, original_content) VALUES (?, ?, ?, ?)'
  ).run(sessionId, 'session-wide', filePath, content);

  console.log(`[file-checkpoint] Persisted original state for ${filePath} in session ${sessionId}`);
}

/**
 * Restore files from checkpoints for a session.
 */
export function restoreCheckpoint(sessionId: string, _messageId: string, workingDirectory: string): string[] {
  const db = getDb();
  const records = db.prepare(
    'SELECT file_path, original_content FROM file_checkpoints WHERE session_id = ?'
  ).all(sessionId) as Array<{ file_path: string; original_content: string | null }>;

  const restored: string[] = [];
  for (const record of records) {
    const fullPath = path.resolve(workingDirectory, record.file_path);
    try {
      if (record.original_content === null) {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } else {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, record.original_content, 'utf-8');
      }
      restored.push(record.file_path);
    } catch (e) {
      console.error(`[file-checkpoint] Failed to restore ${fullPath}:`, e);
    }
  }

  clearCheckpoints(sessionId);
  return restored;
}

/**
 * Clear all checkpoints for a session.
 */
export function clearCheckpoints(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM file_checkpoints WHERE session_id = ?').run(sessionId);
}

/**
 * Get the original content of a file from the session checkpoint.
 */
export function getOriginalContent(sessionId: string, filePath: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT original_content FROM file_checkpoints WHERE session_id = ? AND file_path = ? LIMIT 1'
  ).get(sessionId, filePath) as { original_content: string | null } | undefined;
  
  return row ? row.original_content : null;
}

/**
 * Get the checkpoint stack for a session (Legacy compatibility).
 */
export function getSessionCheckpointStack(sessionId: string): Checkpoint[] {
  const db = getDb();
  const files = db.prepare(
    'SELECT file_path FROM file_checkpoints WHERE session_id = ?'
  ).all(sessionId) as Array<{ file_path: string }>;
  
  if (files.length === 0) return [];
  
  return [{
    messageId: 'session-wide',
    sessionId,
    modifiedFiles: files.map(f => f.file_path),
    snapshots: new Map(),
    createdAt: Date.now()
  }];
}


