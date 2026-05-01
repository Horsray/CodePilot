/**
 * skill-nudge.ts — Three-layer knowledge evolution orchestrator.
 *
 * Layer 1: Learning  — always record observations (low friction)
 * Layer 2: Pattern   — track recurrence, evaluate promotion readiness
 * Layer 3: Skill     — crystallize proven patterns into reusable skills
 *
 * This module decides WHEN to trigger each layer, replaces the old
 * simple threshold heuristic with multi-signal intelligence.
 */

import { recordLearning, type LearningCategory, type LearningEntry } from './learning-store';
import { evaluatePromotions, upsertPattern, markPromoted } from './pattern-tracker';

// ── Types ───────────────────────────────────────────────────────

export interface AgentRunStats {
  step: number;
  distinctTools: ReadonlySet<string>;
  /** Whether any tool call resulted in an error */
  hasErrors: boolean;
  /** Tool names that were called */
  toolNames: string[];
  /** File paths touched during the run */
  touchedFiles?: Set<string>;
  /** Whether the user corrected the AI during the run */
  hadUserCorrection?: boolean;
  /** The full conversation messages for context extraction */
  messages?: Array<{ role: string; content: unknown }>;
}

export interface NudgeDecision {
  /** Should we record a learning? */
  recordLearning: boolean;
  /** Should we evaluate patterns for promotion? */
  evaluatePatterns: boolean;
  /** Should we attempt skill crystallization? */
  crystallizeSkill: boolean;
  /** Reason for the decision */
  reason: string;
  /** Extracted learning if applicable */
  learning?: LearningEntry;
}

// ── Signal Detection ────────────────────────────────────────────

/**
 * Detect meaningful signals from the agent run that indicate
 * something worth learning occurred.
 */
function detectSignals(stats: AgentRunStats): {
  hadFailure: boolean;
  hadComplexWorkflow: boolean;
  hadDiverseTools: boolean;
  wasSearchOnly: boolean;
  hadUserFeedback: boolean;
} {
  const toolSet = stats.toolNames.map(t => t.toLowerCase());
  const searchTools = new Set(['read', 'grep', 'glob', 'readfile', 'search']);
  const mutateTools = new Set(['edit', 'write', 'bash', 'editfile', 'writefile']);

  return {
    hadFailure: stats.hasErrors,
    hadComplexWorkflow: stats.step >= 3,
    hadDiverseTools: stats.distinctTools.size >= 3,
    wasSearchOnly: toolSet.every(t => searchTools.has(t)),
    hadUserFeedback: stats.hadUserCorrection || false,
  };
}

// ── Decision Engine ─────────────────────────────────────────────

/**
 * Decide what actions to take based on the run signals.
 *
 * Layer 1 (Learning): Triggered when ANY meaningful signal is detected.
 *   - Tool failure, user correction, complex workflow with diverse tools.
 *   - Pure search-only sessions are excluded (not worth learning).
 *
 * Layer 2 (Pattern): Triggered when Layer 1 records an entry.
 *   - Automatically checks if the pattern-key has enough recurrence.
 *
 * Layer 3 (Skill): Triggered when a pattern meets promotion criteria.
 *   - Requires: recurrence >= 3, resolved status, not project-specific.
 */
export function decideNudge(stats: AgentRunStats): NudgeDecision {
  const signals = detectSignals(stats);

  // Gate: pure search-only sessions are never worth learning
  if (signals.wasSearchOnly && !signals.hadFailure && !signals.hadUserFeedback) {
    return {
      recordLearning: false,
      evaluatePatterns: false,
      crystallizeSkill: false,
      reason: 'Search-only session — nothing to learn',
    };
  }

  // Gate: too trivial (fewer than 3 steps, only 1 tool)
  if (stats.step < 3 && stats.distinctTools.size < 2 && !signals.hadFailure) {
    return {
      recordLearning: false,
      evaluatePatterns: false,
      crystallizeSkill: false,
      reason: 'Too trivial for learning',
    };
  }

  // Layer 1 is always triggered when signals are present
  const shouldRecord = signals.hadFailure || signals.hadUserFeedback ||
    (signals.hadComplexWorkflow && signals.hadDiverseTools);

  if (!shouldRecord) {
    return {
      recordLearning: false,
      evaluatePatterns: false,
      crystallizeSkill: false,
      reason: 'No meaningful signals detected',
    };
  }

  return {
    recordLearning: true,
    evaluatePatterns: true,   // always check after recording
    crystallizeSkill: false,  // only if pattern evaluation finds candidates
    reason: buildReason(signals),
  };
}

function buildReason(signals: ReturnType<typeof detectSignals>): string {
  const parts: string[] = [];
  if (signals.hadFailure) parts.push('tool failure detected');
  if (signals.hadUserFeedback) parts.push('user correction');
  if (signals.hadComplexWorkflow) parts.push(`${signals.hadDiverseTools ? 'complex' : 'moderate'} workflow`);
  return `Signals: ${parts.join(', ')}`;
}

// ── Learning Extraction (uses AI) ───────────────────────────────

/**
 * Build the prompt for the AI to extract a learning from conversation context.
 * The AI should identify: what happened, why it's notable, and what the
 * reusable pattern is.
 */
export function buildLearningExtractionPrompt(stats: AgentRunStats): string {
  const toolSummary = [...stats.distinctTools].join(', ');
  return `分析以下对话上下文，提取一条值得记录的学习观察。

要求：
1. 判断类别（failure/correction/better-way/non-obvious/api-behavior/architecture/workflow）
2. 生成 pattern-key，格式为 "领域.具体模式"（如 "build.electron.rebuild"、"debug.css.purge"）
3. 用一句话总结关键发现
4. 描述具体细节
5. 提出可操作的改进建议
6. 判断优先级（low/medium/high）

严格按 JSON 格式输出，不要包裹在代码块中：
{
  "category": "类别",
  "patternKey": "领域.具体模式",
  "summary": "一句话总结",
  "details": "具体细节",
  "suggestedAction": "改进建议",
  "priority": "medium",
  "area": "涉及的领域"
}

上下文信息：
- 步骤数: ${stats.step}
- 使用工具: ${toolSummary}
- 有错误: ${stats.hasErrors}
- 用户纠正: ${stats.hadUserCorrection || false}`;
}

// ── Skill Crystallization (uses AI) ─────────────────────────────

/**
 * Build the prompt for the AI to crystallize a pattern into a skill.
 * Only called when a pattern meets promotion criteria.
 */
export function buildCrystallizationPrompt(
  pattern: { patternKey: string; description: string; evidence: string[] },
  recentHistory: string
): string {
  return `你是一个技能结晶助手。基于以下反复出现的模式，提炼一个可复用的 Skill。

**模式**: ${pattern.patternKey}
**描述**: ${pattern.description}
**历史证据**:
${pattern.evidence.map(e => `- ${e}`).join('\n')}

**最近的对话上下文**:
${recentHistory}

要求：
1. 提炼的是通用流程，不是特定实例
2. 去除项目特定路径、硬编码值
3. 包含明确的触发条件和前置条件
4. 步骤清晰、可执行

严格按 JSON 格式输出，不要包裹在代码块中：
{
  "name": "英文小写连字符名称",
  "description": "一句话中文描述",
  "whenToUse": "当用户需要...时使用",
  "content": "Markdown 格式的完整 Skill 内容"
}

Skill 内容必须包含以下结构：
## 触发条件
什么场景下该调用

## 前置条件
执行前需要满足什么

## 工作流步骤
1. 第一步
2. 第二步
...

## 预期结果
成功后应该看到什么

## 不适用场景
不该用的情况`;
}

// ── SSE Event Builders ──────────────────────────────────────────

export interface SkillNudgePayload {
  type: 'skill_nudge';
  message: string;
  reason: {
    step: number;
    distinctToolCount: number;
    toolNames: string[];
    layer: 'learning' | 'pattern' | 'skill';
  };
}

export function buildSkillNudgePayload(
  stats: AgentRunStats,
  layer: 'learning' | 'pattern' | 'skill',
  message: string
): SkillNudgePayload {
  const toolNames = [...stats.distinctTools].sort();
  return {
    type: 'skill_nudge',
    message,
    reason: {
      step: stats.step,
      distinctToolCount: toolNames.length,
      toolNames,
      layer,
    },
  };
}

export interface SkillNudgeStatusEvent {
  notification: true;
  message: string;
  subtype: 'skill_nudge';
  payload: SkillNudgePayload;
}

export function buildSkillNudgeStatusEvent(
  stats: AgentRunStats,
  layer: 'learning' | 'pattern' | 'skill' = 'learning',
  message?: string
): SkillNudgeStatusEvent {
  const defaultMsg = `检测到可学习的工作流（${stats.step} 步，${stats.distinctTools.size} 种工具），已记录观察。`;
  const payload = buildSkillNudgePayload(stats, layer, message || defaultMsg);
  return {
    notification: true,
    message: payload.message,
    subtype: 'skill_nudge',
    payload,
  };
}
