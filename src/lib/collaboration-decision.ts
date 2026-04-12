import type { FileAttachment, CollaborationDecision } from '@/types';

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

/**
 * 中文注释：功能名称「协作判定器」。
 * 用法：根据任务复杂度、信息缺口和风险判断是否真正启用团队协作，以及需要哪些角色参与。
 */
export function analyzeCollaborationNeed(params: {
  prompt: string;
  teamMode?: 'off' | 'on' | 'auto';
  orchestrationTier?: 'single' | 'dual' | 'multi';
  files?: FileAttachment[];
  conversationHistoryCount?: number;
}): CollaborationDecision {
  const {
    prompt,
    teamMode = 'on',
    orchestrationTier = 'multi',
    files = [],
    conversationHistoryCount = 0,
  } = params;

  const text = prompt.toLowerCase();
  const reasons: string[] = [];
  const roles = new Set<CollaborationDecision['suggestedRoles'][number]>(['lead']);

  const fileMentionCount = (prompt.match(/(@[^\s]+)|([\w/-]+\.(ts|tsx|js|jsx|py|go|rs|java|json|md))/gi) || []).length + files.length;
  const hasDesignSignal = includesAny(text, ['设计', '架构', '方案', '重构', 'refactor', 'design', 'architecture']);
  const hasResearchSignal = includesAny(text, ['分析', '调研', '排查', '研究', '定位', 'investigate', 'analyze', 'search', 'why']);
  const hasImplementationSignal = includesAny(text, ['实现', '修改', '修复', '增加', '接入', '开发', 'fix', 'implement', 'build', 'add']);
  const hasVerificationSignal = includesAny(text, ['验证', '测试', '检查', 'review', 'lint', '回归', 'verify', 'test']);
  const hasMultiStepSignal = includesAny(text, ['先', '然后', '最后', '步骤', '1.', '2.', '3.', 'first', 'then', 'finally']);
  const hasHighRiskSignal = includesAny(text, ['重构', '迁移', '核心', '架构', '大改', 'critical', 'migration', 'refactor']);

  if (fileMentionCount >= 2) reasons.push(`涉及 ${fileMentionCount} 个文件或附件上下文`);
  if (hasDesignSignal) reasons.push('任务包含设计/架构信号');
  if (hasResearchSignal) reasons.push('任务包含分析/调研信号');
  if (hasImplementationSignal) reasons.push('任务包含实现/修改信号');
  if (hasVerificationSignal) reasons.push('任务包含验证/测试信号');
  if (hasMultiStepSignal) reasons.push('任务是多阶段步骤型请求');
  if (hasHighRiskSignal) reasons.push('任务风险较高');
  if (conversationHistoryCount > 12) reasons.push('会话上下文较长，编排有助于降低主模型负担');

  if (hasResearchSignal || fileMentionCount >= 3) roles.add('researcher');
  if (hasDesignSignal || hasMultiStepSignal || hasHighRiskSignal) roles.add('architect');
  if (hasImplementationSignal) roles.add('executor');
  if (hasVerificationSignal || hasImplementationSignal || hasHighRiskSignal) roles.add('verifier');

  if (teamMode === 'off' || orchestrationTier === 'single') {
    return {
      shouldCollaborate: false,
      mode: 'direct',
      leadMayImplementDirectly: true,
      reasons: reasons.length > 0 ? reasons : ['当前模式为单模型直做'],
      suggestedRoles: ['lead'],
      summary: '当前任务允许主模型直接处理。',
    };
  }

  const nonLeadRoles = [...roles].filter((role) => role !== 'lead');
  const complexityScore = [
    fileMentionCount >= 2,
    hasDesignSignal,
    hasResearchSignal,
    hasImplementationSignal,
    hasVerificationSignal,
    hasMultiStepSignal,
    hasHighRiskSignal,
  ].filter(Boolean).length;

  if (orchestrationTier === 'dual') {
    const shouldCollaborate = complexityScore >= 2 || hasVerificationSignal || hasHighRiskSignal;
    return {
      shouldCollaborate,
      mode: shouldCollaborate ? 'lead_plus_verifier' : 'direct',
      leadMayImplementDirectly: true,
      reasons: reasons.length > 0 ? reasons : ['双模型下当前任务复杂度较低'],
      suggestedRoles: shouldCollaborate ? ['lead', 'verifier'] : ['lead'],
      summary: shouldCollaborate
        ? '双模型协作已触发：主模型负责推进，验证者负责最终复核。'
        : '双模型已开启，但当前任务仍以主模型直接处理为主。',
    };
  }

  const shouldCollaborate = nonLeadRoles.length >= 2 || complexityScore >= 3;
  const suggestedRoles: CollaborationDecision['suggestedRoles'] = shouldCollaborate
    ? (['lead', ...nonLeadRoles] as CollaborationDecision['suggestedRoles'])
    : ['lead'];

  return {
    shouldCollaborate,
    mode: shouldCollaborate ? 'team_workflow' : 'direct',
    leadMayImplementDirectly: !shouldCollaborate,
    reasons: reasons.length > 0 ? reasons : ['当前任务复杂度较低'],
    suggestedRoles,
    summary: shouldCollaborate
      ? `多模型协作已触发：建议角色为 ${suggestedRoles.join('、')}。`
      : '多模型已开启，但当前任务可由主模型直接完成，无需拉起完整团队。',
  };
}
