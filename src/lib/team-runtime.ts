import fs from 'fs';
import path from 'path';

export type TeamRuntimeStage =
  | 'team-plan'
  | 'team-exec'
  | 'team-verify'
  | 'team-fix'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type TeamRuntimeStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface TeamRuntimeTask {
  id: string;
  role: string;
  desc: string;
  dependsOn: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface TeamRuntimeState {
  jobId: string;
  goal: string;
  sessionId?: string;
  cwd: string;
  status: TeamRuntimeStatus;
  stage: TeamRuntimeStage;
  tasks: TeamRuntimeTask[];
  fixLoopCount: number;
  maxFixLoops: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  summary?: string;
  error?: string;
}

export interface TeamRuntimeHandle {
  jobId: string;
  rootDir: string;
  cwd: string;
}

type TeamEvent = {
  type: string;
  data?: unknown;
  at?: string;
};

const MAX_FIX_LOOPS = 2;

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';
}

function stateRoot(cwd: string): string {
  return path.join(cwd, '.omc', 'state', 'team-jobs');
}

function statePath(handle: TeamRuntimeHandle): string {
  return path.join(handle.rootDir, 'state.json');
}

function eventsPath(handle: TeamRuntimeHandle): string {
  return path.join(handle.rootDir, 'events.jsonl');
}

function handoffDir(handle: TeamRuntimeHandle): string {
  return path.join(handle.rootDir, 'handoffs');
}

function readState(handle: TeamRuntimeHandle): TeamRuntimeState {
  return JSON.parse(fs.readFileSync(statePath(handle), 'utf8')) as TeamRuntimeState;
}

function writeState(handle: TeamRuntimeHandle, state: TeamRuntimeState): void {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statePath(handle), JSON.stringify(state, null, 2));
}

export function createTeamRuntime(options: {
  goal: string;
  cwd: string;
  sessionId?: string;
}): TeamRuntimeHandle {
  const now = new Date().toISOString();
  const jobId = `team-${Date.now()}-${sanitizeId(options.goal).slice(0, 16)}`;
  const rootDir = path.join(stateRoot(options.cwd), jobId);
  fs.mkdirSync(handoffDir({ jobId, rootDir, cwd: options.cwd }), { recursive: true });

  const handle: TeamRuntimeHandle = { jobId, rootDir, cwd: options.cwd };
  writeState(handle, {
    jobId,
    goal: options.goal,
    sessionId: options.sessionId,
    cwd: options.cwd,
    status: 'running',
    stage: 'team-plan',
    tasks: [],
    fixLoopCount: 0,
    maxFixLoops: MAX_FIX_LOOPS,
    createdAt: now,
    updatedAt: now,
  });
  appendTeamEvent(handle, { type: 'team_job_created', data: { jobId, goal: options.goal } });
  return handle;
}

export function appendTeamEvent(handle: TeamRuntimeHandle, event: TeamEvent): void {
  fs.mkdirSync(handle.rootDir, { recursive: true });
  fs.appendFileSync(eventsPath(handle), `${JSON.stringify({ ...event, at: event.at || new Date().toISOString() })}\n`);
}

export function updateTeamStage(handle: TeamRuntimeHandle, stage: TeamRuntimeStage): void {
  const state = readState(handle);
  state.stage = stage;
  if (stage === 'complete') state.status = 'completed';
  if (stage === 'failed') state.status = 'failed';
  if (stage === 'cancelled') state.status = 'cancelled';
  writeState(handle, state);
  appendTeamEvent(handle, { type: 'team_stage_changed', data: { stage } });
}

export function setTeamTasks(handle: TeamRuntimeHandle, tasks: TeamRuntimeTask[]): void {
  const state = readState(handle);
  state.tasks = tasks;
  writeState(handle, state);
  appendTeamEvent(handle, { type: 'team_tasks_ready', data: { tasks } });
}

export function updateTeamTask(
  handle: TeamRuntimeHandle,
  taskId: string,
  patch: Partial<TeamRuntimeTask>,
): void {
  const state = readState(handle);
  state.tasks = state.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task);
  writeState(handle, state);
  appendTeamEvent(handle, { type: 'team_task_updated', data: { taskId, patch } });
}

export function writeTeamHandoff(handle: TeamRuntimeHandle, stage: TeamRuntimeStage, content: string): string {
  const filePath = path.join(handoffDir(handle), `${stage}.md`);
  fs.writeFileSync(filePath, content.trim() + '\n');
  appendTeamEvent(handle, { type: 'team_handoff_written', data: { stage, filePath } });
  return filePath;
}

export function completeTeamRuntime(handle: TeamRuntimeHandle, summary: string, error?: string): void {
  const state = readState(handle);
  state.status = error ? 'failed' : 'completed';
  state.stage = error ? 'failed' : 'complete';
  state.completedAt = new Date().toISOString();
  state.summary = summary;
  state.error = error;
  writeState(handle, state);
  appendTeamEvent(handle, { type: 'team_job_completed', data: { status: state.status, summary, error } });
}

export function getTeamRuntimeState(handle: TeamRuntimeHandle): TeamRuntimeState {
  return readState(handle);
}

export function readTeamRuntimeState(cwd: string, jobId: string): TeamRuntimeState | null {
  const rootDir = path.join(stateRoot(cwd), jobId);
  const filePath = path.join(rootDir, 'state.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TeamRuntimeState;
}

export function readTeamRuntimeEvents(cwd: string, jobId: string): Array<Record<string, unknown>> {
  const filePath = path.join(stateRoot(cwd), jobId, 'events.jsonl');
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { type: 'malformed_event', raw: line };
      }
    });
}

export function listTeamRuntimeStates(cwd: string): TeamRuntimeState[] {
  const root = stateRoot(cwd);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readTeamRuntimeState(cwd, entry.name))
    .filter((state): state is TeamRuntimeState => !!state)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
