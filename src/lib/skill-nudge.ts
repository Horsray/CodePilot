/**
 * skill-nudge.ts
 *
 * Heuristic for suggesting when a multi-step flow should be saved
 * as a reusable Skill.
 */

export interface AgentRunStats {
  step: number;
  distinctTools: ReadonlySet<string>;
}

export const SKILL_NUDGE_STEP_THRESHOLD = 8;
export const SKILL_NUDGE_DISTINCT_TOOL_THRESHOLD = 3;

export function shouldSuggestSkill(stats: AgentRunStats): boolean {
  if (stats.step < SKILL_NUDGE_STEP_THRESHOLD) return false;
  if (stats.distinctTools.size < SKILL_NUDGE_DISTINCT_TOOL_THRESHOLD) return false;
  return true;
}

export interface SkillNudgePayload {
  type: 'skill_nudge';
  message: string;
  reason: {
    step: number;
    distinctToolCount: number;
    toolNames: string[];
  };
}

export function buildSkillNudgePayload(stats: AgentRunStats): SkillNudgePayload {
  const toolNames = [...stats.distinctTools].sort();
  return {
    type: 'skill_nudge',
    message:
      `This workflow involved ${stats.step} agent steps across ${toolNames.length} ` +
      `distinct tools. If you expect to repeat it, save it as a Skill for one-click replay.`,
    reason: {
      step: stats.step,
      distinctToolCount: toolNames.length,
      toolNames,
    },
  };
}

export interface SkillNudgeStatusEvent {
  notification: true;
  message: string;
  subtype: 'skill_nudge';
  payload: SkillNudgePayload;
}

export function buildSkillNudgeStatusEvent(stats: AgentRunStats): SkillNudgeStatusEvent {
  const payload = buildSkillNudgePayload(stats);
  return {
    notification: true,
    message: payload.message,
    subtype: 'skill_nudge',
    payload,
  };
}

