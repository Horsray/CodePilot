import type { ToolSet } from 'ai';
import { getAgent } from './agent-registry';
import { runAgentLoop } from './agent-loop';
import { assembleTools } from './agent-tools';

export type TeamRunnerContext = {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  permissionMode?: string;
  parentSessionId?: string;
  emitSSE?: (event: { type: string; data: string }) => void;
  abortSignal?: AbortSignal;
};

function filterTools(
  allTools: ToolSet,
  allowedTools?: string[],
  disallowedTools?: string[],
): ToolSet {
  if (allowedTools && allowedTools.length > 0) {
    const filtered: ToolSet = {};
    for (const name of allowedTools) {
      if (allTools[name]) filtered[name] = allTools[name];
    }
    return filtered;
  }
  if (disallowedTools && disallowedTools.length > 0) {
    const filtered: ToolSet = {};
    const blocked = new Set(disallowedTools);
    for (const [name, t] of Object.entries(allTools)) {
      if (!blocked.has(name)) filtered[name] = t;
    }
    return filtered;
  }
  return allTools;
}

function getToolSummary(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return name;
  const lower = name.toLowerCase();
  if (['bash', 'execute', 'run', 'shell', 'execute_command'].includes(lower)) {
    const cmd = (inp.command || inp.cmd || '') as string;
    return cmd ? (cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd) : 'bash';
  }
  const filePath = (inp.file_path || inp.path || inp.filePath || '') as string;
  if (['read', 'readfile', 'read_file', 'read_multiple_files', 'read_text_file'].includes(lower)) {
    return filePath ? `Read ${filePath}` : 'Read';
  }
  if (['write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'apply_patch'].includes(lower) || lower.endsWith('__edit_file') || lower.endsWith('__write_file')) {
    return filePath ? `Edit ${filePath}` : 'Edit';
  }
  if (['glob', 'grep', 'searchcodebase', 'find_files', 'search_files', 'websearch', 'web_search'].some(k => lower.includes(k))) {
    const pattern = (inp.pattern || inp.query || inp.glob || '') as string;
    return pattern ? `${name} "${pattern.length > 60 ? pattern.slice(0, 57) + '...' : pattern}"` : name;
  }
  return name;
}

async function runSubAgent(params: {
  agentId: string;
  prompt: string;
  ctx: TeamRunnerContext;
}): Promise<string> {
  const { agentId, prompt, ctx } = params;
  const agentDef = getAgent(agentId);
  if (!agentDef) return `Error: Unknown agent "${agentId}".`;

  const permissionContext = (ctx.parentSessionId && ctx.emitSSE && ctx.permissionMode)
    ? {
        sessionId: ctx.parentSessionId,
        permissionMode: (ctx.permissionMode || 'trust') as import('./permission-checker').PermissionMode,
        emitSSE: ctx.emitSSE,
        abortSignal: ctx.abortSignal,
      }
    : undefined;

  const { tools: allTools } = assembleTools({
    workingDirectory: ctx.workingDirectory,
    providerId: ctx.providerId,
    sessionProviderId: ctx.sessionProviderId,
    model: ctx.parentModel,
    permissionContext,
  });

  const subTools = filterTools(allTools, agentDef.allowedTools, agentDef.disallowedTools);
  const model = agentDef.model || ctx.parentModel;

  const systemPrompt = (agentDef.prompt || `You are a helpful sub-agent.`) +
    `\n\nWorking directory: ${ctx.workingDirectory}\n\nIMPORTANT RULE: You are a sub-agent. Your text responses are the ONLY output sent back to the parent agent. You MUST provide a clear, final summary of your findings, answers, or completed actions before you finish. Do not just output your internal thoughts. Use tools instead of guessing.`;

  ctx.emitSSE?.({ type: 'tool_output', data: `[team:${agentId}] start` });

  const stream = runAgentLoop({
    prompt,
    sessionId: `team-${agentId}-${Date.now()}`,
    providerId: ctx.providerId,
    sessionProviderId: ctx.sessionProviderId,
    model,
    systemPrompt,
    workingDirectory: ctx.workingDirectory,
    tools: subTools,
    maxSteps: agentDef.maxSteps || 30,
    permissionMode: ctx.permissionMode,
  });

  const reader = stream.getReader();
  const textParts: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const lines = value.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'text') {
            textParts.push(event.data);
          } else if (event.type === 'permission_request') {
            ctx.emitSSE?.(event);
          } else if (event.type === 'tool_use') {
            try {
              const t = JSON.parse(event.data);
              const summary = getToolSummary(t.name, t.input);
              ctx.emitSSE?.({ type: 'tool_output', data: `[team:${agentId}] > ${summary}` });
            } catch { }
          } else if (event.type === 'tool_result') {
            try {
              const r = JSON.parse(event.data);
              const status = r.is_error ? 'x' : '+';
              ctx.emitSSE?.({ type: 'tool_output', data: `[team:${agentId}] [${status}] done` });
            } catch { }
          }
        } catch { }
      }
    }
  } finally {
    reader.releaseLock();
  }

  ctx.emitSSE?.({ type: 'tool_output', data: `[team:${agentId}] done` });
  return textParts.join('') || `(Sub-agent "${agentId}" produced no text output)`;
}

export async function runTeamPipeline(params: { goal: string; ctx: TeamRunnerContext }): Promise<string> {
  const { goal, ctx } = params;
  const cleanedGoal = goal.trim();

  ctx.emitSSE?.({ type: 'tool_output', data: `[team] goal: ${cleanedGoal}` });

  const [explore, search] = await Promise.all([
    runSubAgent({
      agentId: 'explore',
      prompt: `Task: Explore the codebase for: ${cleanedGoal}\nReturn:\n- Key file paths (absolute or repo-relative)\n- 1-2 bullets per file why it matters\n- Any important entry points / exports`,
      ctx,
    }),
    runSubAgent({
      agentId: 'search',
      prompt: `Task: Deep search the codebase for: ${cleanedGoal}\nReturn:\n- Best search keywords\n- Matched file list\n- For top 3 matches, include the most relevant line ranges and why`,
      ctx,
    }),
  ]);

  const plan = await runSubAgent({
    agentId: 'planner',
    prompt: `Goal: ${cleanedGoal}\n\nContext from explore:\n${explore}\n\nContext from search:\n${search}\n\nCreate a concise implementation plan with ordered steps and what to verify at the end.`,
    ctx,
  });

  const execution = await runSubAgent({
    agentId: 'executor',
    prompt: `Goal: ${cleanedGoal}\n\nPlan:\n${plan}\n\nContext:\n- Explore findings:\n${explore}\n\n- Search findings:\n${search}\n\nExecute the plan. Make required code changes. Run checks if needed. Provide a final summary of changes and where they are.`,
    ctx,
  });

  const verification = await runSubAgent({
    agentId: 'verifier',
    prompt: `Verify the work for goal: ${cleanedGoal}\n\nExecutor report:\n${execution}\n\nDo:\n- Identify which files changed and sanity check key logic\n- Suggest commands/tests to run (and run them if you can)\n- Report pass/fail with concrete evidence`,
    ctx,
  });

  const out = [
    `# Team Result`,
    ``,
    `## Goal`,
    cleanedGoal,
    ``,
    `## Explore`,
    explore.trim(),
    ``,
    `## Search`,
    search.trim(),
    ``,
    `## Plan`,
    plan.trim(),
    ``,
    `## Execution`,
    execution.trim(),
    ``,
    `## Verification`,
    verification.trim(),
  ].join('\n');

  return out;
}

