import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendTeamEvent,
  completeTeamRuntime,
  createTeamRuntime,
  listTeamRuntimeStates,
  readTeamRuntimeEvents,
  readTeamRuntimeState,
  setTeamTasks,
  updateTeamStage,
  updateTeamTask,
  writeTeamHandoff,
} from '../../lib/team-runtime';

describe('team runtime persistence', () => {
  it('persists state, events, tasks, and handoffs under .omc/state/team-jobs', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-team-runtime-'));
    const runtime = createTeamRuntime({ goal: 'test multi agent flow', cwd, sessionId: 's1' });

    setTeamTasks(runtime, [
      { id: 't1', role: 'explore', desc: 'find files', dependsOn: [], status: 'pending' },
    ]);
    updateTeamStage(runtime, 'team-exec');
    updateTeamTask(runtime, 't1', { status: 'completed', completedAt: '2026-04-25T00:00:00.000Z' });
    appendTeamEvent(runtime, { type: 'custom_event', data: { ok: true } });
    const handoffPath = writeTeamHandoff(runtime, 'team-exec', '## Handoff\n- Done: t1');
    completeTeamRuntime(runtime, 'done');

    const state = readTeamRuntimeState(cwd, runtime.jobId);
    assert.equal(state?.status, 'completed');
    assert.equal(state?.stage, 'complete');
    assert.equal(state?.tasks[0].status, 'completed');
    assert.ok(fs.existsSync(handoffPath));

    const events = readTeamRuntimeEvents(cwd, runtime.jobId);
    assert.ok(events.some((event) => event.type === 'team_job_created'));
    assert.ok(events.some((event) => event.type === 'custom_event'));
    assert.equal(listTeamRuntimeStates(cwd).length, 1);
  });
});
