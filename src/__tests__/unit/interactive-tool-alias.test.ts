import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkPermission, isAlwaysAskTool, isAskUserQuestionTool } from '@/lib/permission-checker';

describe('interactive MCP tool aliases', () => {
  it('keeps AskUserQuestion interactive when the SDK reports its MCP-qualified name', () => {
    const toolName = 'mcp__codepilot-ask-user__AskUserQuestion';

    assert.equal(isAskUserQuestionTool(toolName), true);
    assert.equal(isAlwaysAskTool(toolName), true);
    assert.equal(checkPermission(toolName, { questions: [] }, 'trust').action, 'ask');
  });

  it('does not classify an unrelated MCP tool as interactive', () => {
    assert.equal(isAskUserQuestionTool('mcp__codepilot-todo__TodoWrite'), false);
    assert.equal(isAlwaysAskTool('mcp__codepilot-todo__TodoWrite'), false);
    assert.equal(isAskUserQuestionTool('mcp__third-party__AskUserQuestion'), false);
    assert.equal(isAlwaysAskTool('mcp__third-party__AskUserQuestion'), false);
  });
});
