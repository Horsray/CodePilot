import { NextRequest, NextResponse } from 'next/server';
import { getSessionCheckpointStack, clearCheckpoints, restoreCheckpoint } from '@/lib/file-checkpoint';
import { getSession, getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { computeDiff } from '@/lib/diff-utils';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const stack = getSessionCheckpointStack(sessionId);
  if (stack.length === 0) {
    return NextResponse.json({ modifiedFiles: [], totalAdded: 0, totalRemoved: 0 });
  }

  // Calculate stats for all modified files
  let totalAdded = 0;
  let totalRemoved = 0;
  const modifiedFiles = [];
  const wd = session.working_directory;

  // Fetch all modified files and their original state from DB
  const db = getDb();
  const rows = db.prepare(
    'SELECT file_path, original_content FROM file_checkpoints WHERE session_id = ?'
  ).all(sessionId) as Array<{ file_path: string; original_content: string }>;

  for (const row of rows) {
    const fullPath = path.isAbsolute(row.file_path) ? row.file_path : path.join(wd, row.file_path);
    let currentContent = '';
    try {
      if (fs.existsSync(fullPath)) {
        currentContent = fs.readFileSync(fullPath, 'utf-8');
      }
    } catch (err) {
      console.warn(`[review-api] Failed to read ${fullPath}:`, err);
    }

    const diffLines = computeDiff(row.original_content, currentContent);
    const added = diffLines.filter(l => l.type === 'added').length;
    const removed = diffLines.filter(l => l.type === 'removed').length;
    
    totalAdded += added;
    totalRemoved += removed;

    modifiedFiles.push({
      path: row.file_path,
      added,
      removed,
      originalContent: row.original_content,
      currentContent,
      diffLines // Pass computed diff to frontend
    });
  }

  return NextResponse.json({
    modifiedFiles,
    totalAdded,
    totalRemoved
  });
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, action } = await request.json();
    if (!sessionId || !action) return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });

    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    if (action === 'accept') {
      clearCheckpoints(sessionId);
      return NextResponse.json({ success: true });
    } else if (action === 'discard') {
      const stack = getSessionCheckpointStack(sessionId);
      if (stack.length === 0) return NextResponse.json({ success: true, restored: [] });
      
      const firstMessageId = stack[0].messageId;
      const restored = restoreCheckpoint(sessionId, firstMessageId, session.working_directory);
      
      return NextResponse.json({ success: true, restored });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e) {
    console.error('[api/chat/review] POST failed:', e);
    return NextResponse.json({ error: 'Failed to process review action' }, { status: 500 });
  }
}
