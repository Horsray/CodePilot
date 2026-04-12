import type { FileAttachment, CollaborationDecision } from '@/types';

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function buildExecutionPhases(params: {
  suggestedRoles: CollaborationDecision['suggestedRoles'];
  shouldEscalateToExpert: boolean;
  hasKnowledgeWork: boolean;
  hasVisionWork: boolean;
  hasExecutionWork: boolean;
  hasQualityWork: boolean;
}): CollaborationDecision['phases'] {
  const { suggestedRoles, shouldEscalateToExpert, hasKnowledgeWork, hasVisionWork, hasExecutionWork, hasQualityWork } = params;
  if (!suggestedRoles.includes('team-leader')) return [];

  const phases: NonNullable<CollaborationDecision['phases']> = [
    {
      id: 'lead-plan',
      name: '总指挥规划',
      roles: ['team-leader'],
      parallel: false,
      objective: '总指挥先拆解任务、确认依赖关系，并决定哪些角色需要参与。',
    },
  ];

  const researchRoles = [
    hasKnowledgeWork && suggestedRoles.includes('knowledge-searcher') ? 'knowledge-searcher' : null,
    hasVisionWork && suggestedRoles.includes('vision-understanding') ? 'vision-understanding' : null,
  ].filter(Boolean) as Array<'knowledge-searcher' | 'vision-understanding'>;

  if (researchRoles.length > 0) {
    phases.push({
      id: 'parallel-research',
      name: researchRoles.length > 1 ? '并行取证' : '前置取证',
      roles: researchRoles,
      dependsOn: ['lead-plan'],
      parallel: researchRoles.length > 1,
      objective: researchRoles.length > 1
        ? '知识检索与视觉理解可并行进行，分别产出外部资料和视觉证据。'
        : '为后续执行准备必要的前置结论。',
    });
  }

  if (hasExecutionWork && suggestedRoles.includes('worker-executor')) {
    phases.push({
      id: 'execution',
      name: '工作执行',
      roles: ['worker-executor'],
      dependsOn: phases.length > 1 ? [phases[phases.length - 1].id] : ['lead-plan'],
      parallel: false,
      objective: '工作执行必须消费前置结论后再落地，避免在缺失上下文时盲改。',
    });
  }

  if (hasQualityWork && suggestedRoles.includes('quality-inspector')) {
    phases.push({
      id: 'quality',
      name: '质量检验',
      roles: ['quality-inspector'],
      dependsOn: phases.some((phase) => phase.id === 'execution') ? ['execution'] : [phases[phases.length - 1].id],
      parallel: false,
      objective: '质量检验在执行完成后进行，负责测试、验证和回归确认。',
    });
  }

  if (shouldEscalateToExpert && suggestedRoles.includes('expert-consultant')) {
    phases.push({
      id: 'expert-escalation',
      name: '专家升级',
      roles: ['expert-consultant'],
      dependsOn: [phases[phases.length - 1].id],
      parallel: false,
      objective: '当已有尝试失败、证据冲突或用户连续反馈无效时，再升级给专家顾问做最终判断。',
    });
  }

  return phases;
}

/**
 * 中文注释：功能名称「协作判定器」。
 * 用法：根据任务复杂度、信息缺口和风险判断是否真正启用团队协作，以及需要哪些角色参与。
 */
export function analyzeCollaborationNeed(params: {
  prompt: string;
  teamMode?: 'off' | 'on' | 'auto';
  orchestrationTier?: 'single' | 'multi';
  files?: FileAttachment[];
  conversationHistoryCount?: number;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): CollaborationDecision {
  const {
    prompt,
    teamMode = 'on',
    orchestrationTier = 'multi',
    files = [],
    conversationHistoryCount = 0,
    conversationHistory = [],
  } = params;

  const text = prompt.toLowerCase();
  const reasons: string[] = [];
  const roles = new Set<CollaborationDecision['suggestedRoles'][number]>(['team-leader']);

  const fileMentionCount = (prompt.match(/(@[^\s]+)|([\w/-]+\.(ts|tsx|js|jsx|py|go|rs|java|json|md))/gi) || []).length + files.length;
  const imageAttachmentCount = files.filter((file) => /image|png|jpg|jpeg|gif|webp/i.test(file.type || '') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(file.name || '')).length;
  const hasResearchSignal = includesAny(text, ['分析', '调研', '排查', '研究', '定位', 'investigate', 'analyze', 'search', 'why', '资料', '文档', '最新', '官网', '检索', '互联网']);
  const hasVisionSignal = includesAny(text, ['图片', '截图', '视觉', '界面', 'ocr', 'image', 'screenshot', 'vision', 'visual', 'ui']);
  const hasImplementationSignal = includesAny(text, ['实现', '修改', '修复', '增加', '接入', '开发', 'fix', 'implement', 'build', 'add']);
  const hasVerificationSignal = includesAny(text, ['验证', '测试', '检查', 'review', 'lint', '回归', 'verify', 'test']);
  const hasMultiStepSignal = includesAny(text, ['先', '然后', '最后', '步骤', '1.', '2.', '3.', 'first', 'then', 'finally']);
  const hasHighRiskSignal = includesAny(text, ['重构', '迁移', '核心', '架构', '大改', 'critical', 'migration', 'refactor']);
  const hasWebSignal = includesAny(text, ['官网', '文档', '最新', '互联网', '搜索', '检索', 'web', 'website', 'docs', 'documentation', 'latest']);
  const hasQaSignal = includesAny(text, ['为什么没生效', '为什么不对', '根因', 'root cause', '复现', '回归', '验收']);
  const hasEscalationSignal = includesAny(text, ['还是错', '还是不对', '无效', '没解决', '依旧', '仍然失败', '反复', '多次失败', '超出理解', '请教专家', '升级专家', 'still wrong', 'not working', 'invalid', 'failed again', 'escalate']);
  const recentUserFeedbacks = [...conversationHistory, { role: 'user' as const, content: prompt }]
    .filter((item) => item.role === 'user')
    .slice(-3);
  const consecutiveNegativeFeedbackCount = recentUserFeedbacks.filter((item) =>
    includesAny(item.content.toLowerCase(), ['还是错', '还是不对', '无效', '没解决', '依旧', '仍然失败', '反复', '多次失败', '没用', '错误', 'still wrong', 'not working', 'invalid', 'failed', 'useless', 'wrong'])
  ).length;
  const shouldEscalateToExpert = hasEscalationSignal || consecutiveNegativeFeedbackCount >= 3;

  if (fileMentionCount >= 2) reasons.push(`涉及 ${fileMentionCount} 个文件或附件上下文`);
  if (hasResearchSignal) reasons.push('任务包含知识检索信号');
  if (hasVisionSignal || imageAttachmentCount > 0) reasons.push('任务包含视觉理解信号');
  if (hasImplementationSignal) reasons.push('任务包含实现/修改信号');
  if (hasVerificationSignal || hasQaSignal) reasons.push('任务包含验证/测试信号');
  if (hasMultiStepSignal) reasons.push('任务是多阶段步骤型请求');
  if (hasHighRiskSignal) reasons.push('任务风险较高');
  if (conversationHistoryCount > 12) reasons.push('会话上下文较长，编排有助于降低主模型负担');
  if (shouldEscalateToExpert) reasons.push('最近多轮用户反馈无效或当前请求明确要求专家升级');

  if (hasResearchSignal || hasWebSignal || fileMentionCount >= 3) roles.add('knowledge-searcher');
  if (hasVisionSignal || imageAttachmentCount > 0) roles.add('vision-understanding');
  if (hasImplementationSignal || hasMultiStepSignal || hasHighRiskSignal || fileMentionCount >= 2) roles.add('worker-executor');
  if (hasVerificationSignal || hasQaSignal || hasImplementationSignal || hasHighRiskSignal || shouldEscalateToExpert) roles.add('quality-inspector');
  if (shouldEscalateToExpert) roles.add('expert-consultant');

  if (teamMode === 'off' || orchestrationTier === 'single') {
    return {
      shouldCollaborate: false,
      mode: 'direct',
      leadMayImplementDirectly: true,
      reasons: reasons.length > 0 ? reasons : ['当前模式为单模型直做'],
      suggestedRoles: ['team-leader'],
      summary: '当前任务允许主模型直接处理。',
    };
  }

  const nonLeadRoles = [...roles].filter((role) => role !== 'team-leader');
  const complexityScore = [
    fileMentionCount >= 2,
    hasResearchSignal,
    hasWebSignal,
    hasVisionSignal,
    imageAttachmentCount > 0,
    hasImplementationSignal,
    hasVerificationSignal,
    hasQaSignal,
    hasMultiStepSignal,
    hasHighRiskSignal,
  ].filter(Boolean).length;

  const shouldCollaborate = shouldEscalateToExpert || nonLeadRoles.length >= 2 || complexityScore >= 3;
  const suggestedRoles: CollaborationDecision['suggestedRoles'] = shouldCollaborate
    ? (['team-leader', ...nonLeadRoles] as CollaborationDecision['suggestedRoles'])
    : ['team-leader'];
  const phases = buildExecutionPhases({
    suggestedRoles,
    shouldEscalateToExpert,
    hasKnowledgeWork: hasResearchSignal || hasWebSignal || fileMentionCount >= 3,
    hasVisionWork: hasVisionSignal || imageAttachmentCount > 0,
    hasExecutionWork: hasImplementationSignal || hasMultiStepSignal || hasHighRiskSignal || fileMentionCount >= 2,
    hasQualityWork: hasVerificationSignal || hasQaSignal || hasImplementationSignal || hasHighRiskSignal || shouldEscalateToExpert,
  });

  return {
    shouldCollaborate,
    mode: shouldCollaborate ? 'team_workflow' : 'direct',
    leadMayImplementDirectly: !shouldCollaborate,
    reasons: reasons.length > 0 ? reasons : ['当前任务复杂度较低'],
    suggestedRoles,
    phases,
    summary: shouldCollaborate
      ? `多模型协作已触发：建议角色为 ${suggestedRoles.join('、')}。${shouldEscalateToExpert ? ' 已升级专家顾问参与。' : ''}`
      : '多模型已开启，但当前任务可由主模型直接完成，无需拉起完整团队。',
  };
}
