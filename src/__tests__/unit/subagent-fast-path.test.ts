import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('subagent fast path', () => {
  it('executes simple local code searches without starting a model loop', async () => {
    const { tryExecuteSubAgentFastPath } = await import('../../lib/subagent-fast-path');
    const toolCalls: string[] = [];
    const result = await tryExecuteSubAgentFastPath({
      agentId: 'search',
      prompt: '在项目中搜索 "tool_files" 关键字出现在哪些文件，并返回文件路径和代码片段',
      workingDirectory: '/repo',
      tools: {
        Grep: {
          execute: async () => {
            toolCalls.push('Grep');
            return 'src/lib/agent-loop.ts:12:const tool_files = []';
          },
        },
        Read: {
          execute: async () => {
            toolCalls.push('Read');
            return '10\tbefore\n11\tmiddle\n12\tconst tool_files = []\n13\tafter';
          },
        },
      } as any,
    });

    assert.ok(result);
    assert.equal(result?.kind, 'local_code_search');
    assert.match(result?.report || '', /src\/lib\/agent-loop\.ts/);
    assert.deepEqual(toolCalls, ['Grep', 'Read']);
  });

  it('executes simple web searches through the query-shaped search tool', async () => {
    const { tryExecuteSubAgentFastPath } = await import('../../lib/subagent-fast-path');
    const inputs: unknown[] = [];
    const result = await tryExecuteSubAgentFastPath({
      agentId: 'search',
      prompt: '联网搜索 OpenAI Responses API 最新官方文档',
      workingDirectory: '/repo',
      tools: {
        web_search: {
          execute: async (input: unknown) => {
            inputs.push(input);
            return 'https://platform.openai.com/docs/api-reference/responses';
          },
        },
      } as any,
    });

    assert.ok(result);
    assert.equal(result?.kind, 'web_search');
    assert.deepEqual(inputs[0], {
      query: 'OpenAI Responses API 最新官方文档',
      max_results: 5,
    });
    assert.match(result?.report || '', /platform\.openai\.com/);
  });

  it('does not fast-path complex analysis prompts even when they mention files and lookup verbs', async () => {
    const { tryExecuteSubAgentFastPath } = await import('../../lib/subagent-fast-path');
    const result = await tryExecuteSubAgentFastPath({
      agentId: 'search',
      prompt: '分析 src/lib/db.ts 中与 message 和 session 相关的数据库表定义：1. 找出 message 表的 CREATE TABLE 语句 2. 分析表结构和索引 3. 报告 schema 设计特点',
      workingDirectory: '/repo',
      tools: {
        Grep: {
          execute: async () => {
            throw new Error('Grep should not run for analysis prompts');
          },
        },
      } as any,
    });

    assert.equal(result, null);
  });
});
