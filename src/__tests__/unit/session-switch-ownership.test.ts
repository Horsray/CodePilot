import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('new-session warmup does not transfer another chat session into the shared pool', () => {
  const warmupRoute = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/chat/warmup/route.ts'),
    'utf8',
  );
  const persistentSessions = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/persistent-claude-session.ts'),
    'utf8',
  );

  assert.doesNotMatch(warmupRoute, /poolIncompatibleEntries\(signature, warmupSessionId\)/);
  assert.match(persistentSessions, /function claimFromPool\(signature: string, ownerSessionId: string\)/);
  assert.match(persistentSessions, /v\.entry\.codepilotSessionId !== ownerSessionId/);
});
