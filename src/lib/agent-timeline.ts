import type {
  MessageContentBlock,
  TimelineFileChange,
  TimelineStep,
  TimelineStepStatus,
  TokenUsage,
  ToolResultInfo,
  ToolUseInfo,
} from '@/types';

interface TimelineAccumulatorState {
  steps: TimelineStep[];
  activeStepId: string | null;
  nextStepIndex: number;
  lastCompletedStepId: string | null;
}

interface StepCompletePayload {
  subtype?: string;
  step?: number;
  usage?: TokenUsage | null;
  finishReason?: string;
  toolsUsed?: string[];
  model?: string;
  agent?: string;
  providerId?: string;
  providerName?: string;
  requestedAgent?: string;
  orchestrationProfileName?: string;
}

function makeStepTitle(index: number): string {
  return `步骤 ${index}`;
}

function formatToolTitle(toolName: string, input: unknown): string {
  const normalized = toolName.toLowerCase();
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const filePath = String(data.file_path ?? data.path ?? data.filePath ?? '').trim();
  const fileName = shortenPath(filePath);

  if (['read', 'readfile', 'read_file'].includes(normalized)) {
    return fileName ? `读取 ${fileName}` : '读取文件';
  }
  if (['write', 'writefile', 'write_file', 'create_file', 'createfile'].includes(normalized)) {
    return fileName ? `新建 ${fileName}` : '创建文件';
  }
  if (['edit', 'notebookedit', 'notebook_edit'].includes(normalized)) {
    return fileName ? `修改 ${fileName}` : '修改文件';
  }
  if (['grep', 'searchcodebase', 'glob', 'ls'].includes(normalized)) {
    return `检索 ${toolName}`;
  }
  if (['runcommand', 'bash', 'terminal'].includes(normalized)) {
    return '执行命令';
  }
  return toolName;
}

function formatStepPreview(text: string, max = 48): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

function looksLikeErrorText(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return /\*\*(错误|Error):\*\*|unexpected error|timed out|自动中止|tool .* timed out|stream idle timeout/i.test(value);
}

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function createStep(index: number, now: number, dependency?: string | null): TimelineStep {
  return {
    id: `timeline-step-${index}-${now}`,
    index,
    title: makeStepTitle(index),
    status: 'running',
    startedAt: now,
    completedAt: null,
    reasoning: '',
    output: '',
    summary: '',
    dependencies: dependency ? [dependency] : [],
    toolCalls: [],
    fileChanges: [],
    events: [],
    usage: null,
    error: null,
    retryCount: 0,
  };
}

function getStepById(state: TimelineAccumulatorState, stepId: string | null): TimelineStep | null {
  if (!stepId) return null;
  return state.steps.find((step) => step.id === stepId) || null;
}

function findStepByToolId(state: TimelineAccumulatorState, toolUseId: string): TimelineStep | null {
  return state.steps.find((step) => step.toolCalls.some((tool) => tool.id === toolUseId)) || null;
}

function ensureActiveStep(state: TimelineAccumulatorState, now: number): TimelineStep {
  const current = getStepById(state, state.activeStepId);
  if (current) return current;
  const step = createStep(state.nextStepIndex, now, state.lastCompletedStepId);
  state.steps.push(step);
  state.activeStepId = step.id;
  state.nextStepIndex += 1;
  return step;
}

function makeUnifiedDiff(beforeText: string, afterText: string): string {
  const beforeLines = beforeText ? beforeText.replace(/\r\n/g, '\n').split('\n') : [];
  const afterLines = afterText ? afterText.replace(/\r\n/g, '\n').split('\n') : [];
  const body = [
    ...beforeLines.map((line) => `- ${line}`),
    ...afterLines.map((line) => `+ ${line}`),
  ];
  return body.join('\n').trim();
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r\n/g, '\n').split('\n').length;
}

function shortenPath(filePath: string): string {
  if (!filePath) return '';
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

function extractFileChange(tool: Pick<ToolUseInfo, 'name' | 'input'>): TimelineFileChange | null {
  if (!tool.input || typeof tool.input !== 'object') return null;
  const input = tool.input as Record<string, unknown>;
  const toolName = tool.name.toLowerCase();
  const filePath = String(input.file_path ?? input.path ?? input.filePath ?? '');
  if (!filePath) return null;

  const oldText = typeof input.old_string === 'string'
    ? input.old_string
    : typeof input.oldText === 'string'
      ? input.oldText
      : typeof input.previous === 'string'
        ? input.previous
        : '';
  const newText = typeof input.new_string === 'string'
    ? input.new_string
    : typeof input.newText === 'string'
      ? input.newText
      : '';
  const content = typeof input.content === 'string' ? input.content : '';

  const isCreate = ['write', 'writefile', 'write_file', 'create_file', 'createfile'].includes(toolName)
    && !!content
    && !oldText
    && !newText;
  const isEdit = ['edit', 'notebookedit', 'notebook_edit'].includes(toolName) || (!!oldText || !!newText);
  if (!isCreate && !isEdit) return null;

  const beforeText = isCreate ? '' : oldText;
  const afterText = isCreate ? content : newText;

  return {
    path: filePath,
    fileName: shortenPath(filePath),
    operation: isCreate ? 'create' : 'edit',
    addedLines: countLines(afterText),
    removedLines: isCreate ? 0 : countLines(beforeText),
    beforeText,
    afterText,
    diffText: makeUnifiedDiff(beforeText, afterText),
  };
}

function refreshStepMetadata(step: TimelineStep): void {
  const firstTool = step.toolCalls[0];
  if (firstTool) {
    step.title = formatToolTitle(firstTool.name, firstTool.input);
  } else if (step.reasoning.trim()) {
    step.title = formatStepPreview(step.reasoning) || makeStepTitle(step.index);
  } else if (step.output.trim()) {
    step.title = formatStepPreview(step.output) || makeStepTitle(step.index);
  } else {
    step.title = makeStepTitle(step.index);
  }

  const toolSummary = step.toolCalls.length > 0
    ? step.toolCalls.map((tool) => formatToolTitle(tool.name, tool.input)).join(', ')
    : '';
  const textSummary = step.output.trim().slice(0, 120);
  const reasoningSummary = formatStepPreview(step.reasoning, 120);
  const titleLabel = normalizeLabel(step.title);
  const summaryCandidates = [toolSummary, textSummary, reasoningSummary]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => normalizeLabel(item) !== titleLabel);

  step.summary = summaryCandidates[0] || '';
}

function appendToolFileChange(step: TimelineStep, tool: Pick<ToolUseInfo, 'name' | 'input'>): void {
  const change = extractFileChange(tool);
  if (!change) return;
  if (step.fileChanges.some((item) => item.path === change.path && item.operation === change.operation)) return;
  step.fileChanges.push(change);
}

export function createTimelineAccumulator(now = Date.now()): TimelineAccumulatorState {
  const firstStep = createStep(1, now, null);
  return {
    steps: [firstStep],
    activeStepId: firstStep.id,
    nextStepIndex: 2,
    lastCompletedStepId: null,
  };
}

export function cloneTimelineSteps(state: TimelineAccumulatorState): TimelineStep[] {
  return state.steps.map((step) => ({
    ...step,
    dependencies: [...step.dependencies],
    toolCalls: step.toolCalls.map((tool) => ({ ...tool })),
    fileChanges: step.fileChanges.map((file) => ({ ...file })),
    events: step.events?.map((event) => ({ ...event })),
  }));
}

export function appendTimelineReasoning(state: TimelineAccumulatorState, delta: string, now = Date.now()): void {
  if (!delta) return;
  const step = ensureActiveStep(state, now);
  step.reasoning += delta;
  const lastEvent = step.events?.[step.events.length - 1];
  if (lastEvent?.type === 'reasoning') {
    lastEvent.content += delta;
    lastEvent.timestamp = now;
  } else {
    step.events = [...(step.events || []), { type: 'reasoning', content: delta, timestamp: now }];
  }
  refreshStepMetadata(step);
}

export function appendTimelineOutput(state: TimelineAccumulatorState, delta: string, now = Date.now()): void {
  if (!delta) return;
  const current = getStepById(state, state.activeStepId);
  if (current && current.toolCalls.length > 0 && !current.output.trim()) {
    completeTimelineStep(state, undefined, now);
  }
  const step = ensureActiveStep(state, now);
  step.output += delta;
  if (looksLikeErrorText(step.output)) {
    step.status = 'failed';
    step.error = step.output.trim();
  }
  refreshStepMetadata(step);
}

export function appendTimelineToolUse(state: TimelineAccumulatorState, tool: ToolUseInfo, now = Date.now()): void {
  const current = getStepById(state, state.activeStepId);
  if (current && current.toolCalls.length > 0 && !current.toolCalls.some((item) => item.id === tool.id)) {
    completeTimelineStep(state, undefined, now);
  }
  const step = ensureActiveStep(state, now);
  if (!step.toolCalls.some((item) => item.id === tool.id)) {
    step.toolCalls.push({
      id: tool.id,
      name: tool.name,
      input: tool.input,
      status: 'running',
      startedAt: now,
      completedAt: null,
      result: undefined,
      isError: false,
    });
    step.events = [...(step.events || []), { type: 'tool', toolCallId: tool.id, timestamp: now }];
  }
  appendToolFileChange(step, tool);
  refreshStepMetadata(step);
}

export function appendTimelineToolResult(state: TimelineAccumulatorState, result: ToolResultInfo, now = Date.now()): void {
  const step = findStepByToolId(state, result.tool_use_id) || ensureActiveStep(state, now);
  let toolCall = step.toolCalls.find((item) => item.id === result.tool_use_id);
  if (!toolCall) {
    toolCall = {
      id: result.tool_use_id,
      name: 'tool_result',
      input: {},
      status: result.is_error ? 'failed' : 'completed',
      startedAt: now,
      completedAt: now,
      result: result.content,
      isError: !!result.is_error,
    };
    step.toolCalls.push(toolCall);
    step.events = [...(step.events || []), { type: 'tool', toolCallId: result.tool_use_id, timestamp: now }];
  } else {
    toolCall.result = result.content;
    toolCall.isError = !!result.is_error;
    toolCall.status = result.is_error ? 'failed' : 'completed';
    toolCall.completedAt = now;
  }
  if (result.is_error) {
    step.status = 'failed';
    step.error = result.content;
  }
  if (state.activeStepId === step.id && step.toolCalls.every((tool) => tool.status !== 'running')) {
    completeTimelineStep(state, undefined, now);
    return;
  }
  refreshStepMetadata(step);
}

/**
 * 更新时间线步骤的状态。
 * 用于在步骤开始或状态变更时（例如切换模型）更新 UI。
 */
export function updateTimelineStatus(
  state: TimelineAccumulatorState,
  payload: { message: string; step?: number; model?: string; agent?: string; providerId?: string; providerName?: string; requestedAgent?: string; orchestrationProfileName?: string },
  now = Date.now(),
): void {
  const step = ensureActiveStep(state, now);
  step.status = 'running';
  if (payload.model) step.model = payload.model;
  if (payload.agent) step.agent = payload.agent;
  if (payload.providerId) step.providerId = payload.providerId;
  if (payload.providerName) step.providerName = payload.providerName;
  if (payload.requestedAgent) step.requestedAgent = payload.requestedAgent;
  if (payload.orchestrationProfileName) step.orchestrationProfileName = payload.orchestrationProfileName;
}

export function completeTimelineStep(
  state: TimelineAccumulatorState,
  payload?: StepCompletePayload,
  now = Date.now(),
): void {
  const step = ensureActiveStep(state, now);
  const hasToolError = step.toolCalls.some((tool) => tool.isError);
  const hasError = hasToolError || !!step.error || looksLikeErrorText(step.output);
  step.status = hasError ? 'failed' : 'completed';
  step.completedAt = now;
  step.usage = payload?.usage || step.usage || null;
  if (payload?.model) step.model = payload.model;
  if (payload?.agent) step.agent = payload.agent;
  if (payload?.providerId) step.providerId = payload.providerId;
  if (payload?.providerName) step.providerName = payload.providerName;
  if (payload?.requestedAgent) step.requestedAgent = payload.requestedAgent;
  if (payload?.orchestrationProfileName) step.orchestrationProfileName = payload.orchestrationProfileName;
  if (payload?.finishReason && !step.summary) step.summary = payload.finishReason;
  if (payload?.toolsUsed && payload.toolsUsed.length > 0 && !step.summary) step.summary = payload.toolsUsed.join(', ');
  refreshStepMetadata(step);
  state.lastCompletedStepId = step.id;
  state.activeStepId = null;
}

export function failTimelineStep(
  state: TimelineAccumulatorState,
  error: string,
  now = Date.now(),
  markRetryable = false,
): void {
  const step = ensureActiveStep(state, now);
  step.status = markRetryable ? 'retrying' : 'failed';
  step.completedAt = now;
  step.error = error;
  if (markRetryable) step.retryCount += 1;
  refreshStepMetadata(step);
}

export function applyTimelineStatusPayload(
  state: TimelineAccumulatorState,
  payload: Record<string, unknown>,
  now = Date.now(),
): void {
  const subtype = typeof payload.subtype === 'string' ? payload.subtype : '';
  if (subtype === 'step_complete') completeTimelineStep(state, payload as StepCompletePayload, now);
}

export function finalizeTimelineSteps(
  state: TimelineAccumulatorState,
  finalStatus: TimelineStepStatus,
  now = Date.now(),
): TimelineStep[] {
  const active = getStepById(state, state.activeStepId);
  if (active) {
    const hasError = !!active.error || active.toolCalls.some((tool) => tool.isError) || looksLikeErrorText(active.output);
    active.status = hasError ? 'failed' : finalStatus;
    active.completedAt = active.completedAt ?? now;
    refreshStepMetadata(active);
    state.lastCompletedStepId = active.id;
    state.activeStepId = null;
  }
  return cloneTimelineSteps(state).filter((step) => {
    return step.reasoning.trim()
      || step.output.trim()
      || step.toolCalls.length > 0
      || step.fileChanges.length > 0
      || step.error
      || step.status !== 'running';
  });
}

export function extractTimelineStepsFromBlocks(blocks: MessageContentBlock[]): TimelineStep[] {
  const embedded = blocks.find((block) => block.type === 'timeline');
  if (embedded && embedded.type === 'timeline') return embedded.steps;

  const state = createTimelineAccumulator(0);
  const hasAgentActivity = blocks.some((block) => (
    block.type === 'thinking' || block.type === 'tool_use' || block.type === 'tool_result'
  ));
  for (const block of blocks) {
    switch (block.type) {
      case 'thinking':
        appendTimelineReasoning(state, block.thinking, 0);
        break;
      case 'text':
        if (!hasAgentActivity) {
          appendTimelineOutput(state, block.text, 0);
        }
        break;
      case 'tool_use':
        appendTimelineToolUse(state, { id: block.id, name: block.name, input: block.input }, 0);
        break;
      case 'tool_result':
        appendTimelineToolResult(
          state,
          { tool_use_id: block.tool_use_id, content: block.content, is_error: block.is_error, media: block.media },
          0,
        );
        break;
      default:
        break;
    }
  }
  return finalizeTimelineSteps(state, 'completed', 0);
}
