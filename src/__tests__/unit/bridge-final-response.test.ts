import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  detectIncompleteTurn,
  extractFinalResponseText,
  trimTrailingIntent,
} from '@/lib/bridge/conversation-engine';
import type { MessageContentBlock } from '@/types';

// 中文注释：构造器——让用例只表达"块的排布"，不淹没在类型字段里。
const t = (text: string): MessageContentBlock => ({ type: 'text', text });
const think = (text: string): MessageContentBlock => ({ type: 'thinking', thinking: text });
const tool = (id: string): MessageContentBlock => ({ type: 'tool_use', id, name: 'Bash', input: {} });
const result = (id: string): MessageContentBlock => ({
  type: 'tool_result',
  tool_use_id: id,
  content: 'ok',
  is_error: false,
});

// 中文注释：真实样本。取自 2026-10-07 微信桥接实测的一轮 query——模型把
// "让我查一下…"这类工具前解说词当成 text 块输出，整轮拼接后手机端收到的
// 就是一串过程叙述，并以冒号半句收尾（deepseek 中转模型提前 end_turn）。
const REAL_TURN: MessageContentBlock[] = [
  think('The user is saying the search returns empty - no data.'),
  t('让我直接在服务器上查一下 MySQL 和环境配置：'),
  tool('c1'),
  result('c1'),
  think('Now let me check the actual environment variables.'),
  t('看到了！服务器上的 user-700244.db 有 65536 字节，不是空的！让我直接在服务器上查 SQLite：'),
  tool('c2'),
  result('c2'),
  t('SQLite 库里没有 horsray 用户！users 表存在但查不到。让我看看这个管理系统是不是有 MySQL 配置但没开：'),
];

describe('extractFinalResponseText — 只发最终结论', () => {
  it('丢弃工具调用之间的过程叙述，只留最后一次工具动作之后的结论', () => {
    const out = extractFinalResponseText(REAL_TURN);

    assert.match(out, /^SQLite 库里没有 `?horsray`? 用户|^SQLite 库里没有 horsray 用户/);
    // 前面的"让我查一下…"解说词必须被丢掉
    assert.doesNotMatch(out, /让我直接在服务器上查一下 MySQL/);
    assert.doesNotMatch(out, /让我直接在服务器上查 SQLite/);
    // thinking 永远不进回复
    assert.doesNotMatch(out, /The user is saying/);
  });

  it('纯对话（无工具调用）时保留全部文本', () => {
    const out = extractFinalResponseText([think('随便想想'), t('你好呀！'), t('在的～')]);
    assert.equal(out, '你好呀！\n\n在的～');
  });

  it('末尾有一整段连续文本时全部保留', () => {
    const out = extractFinalResponseText([t('我先看看'), tool('c1'), result('c1'), t('第一段'), t('第二段')]);
    assert.equal(out, '第一段\n\n第二段');
  });

  it('末尾没有文本时回退到最后一个非空文本块（不空发）', () => {
    const out = extractFinalResponseText([t('我先看看'), tool('c1'), result('c1')]);
    assert.equal(out, '我先看看');
  });

  it('只有 thinking 时返回空串', () => {
    assert.equal(extractFinalResponseText([think('a'), think('b')]), '');
  });
});

describe('detectIncompleteTurn — 未完成轮次检测', () => {
  it('工具调用悬空（有 tool_use 无 tool_result）判定为未完成', () => {
    const check = detectIncompleteTurn([t('开始查：'), tool('c1')]);
    assert.equal(check.incomplete, true);
    assert.equal(check.reason, 'dangling_tool_use');
  });

  it('以「让我…：」这类前瞻句收尾判定为未完成', () => {
    const check = detectIncompleteTurn(REAL_TURN);
    assert.equal(check.incomplete, true);
    assert.equal(check.reason, 'trailing_intent');
  });

  it('正常给出结论时不误判', () => {
    const check = detectIncompleteTurn([
      t('让我查一下：'),
      tool('c1'),
      result('c1'),
      t('查到了，horsray 属于花生国风空间，space_key=700244。'),
    ]);
    assert.equal(check.incomplete, false);
    assert.equal(check.reason, undefined);
  });

  it('以冒号收尾但没有前瞻词时不误判（如下一步是列表）', () => {
    const check = detectIncompleteTurn([t('查询结果如下：')]);
    assert.equal(check.incomplete, false);
  });
});

describe('trimTrailingIntent — 裁掉前瞻尾巴', () => {
  // 中文注释：真实样本的后半段。结论本身有信息量，但后面还挂着两段
  // "让我确认…："式的宣言句，直接发出去用户仍会觉得"又是过程"。
  const REAL_TAIL = [
    'SQLite 库里**没有 `horsray` 用户**！users 表存在但查不到。',
    '这就解释了问题：**MySQL 里有 `horsray` 在 `space_key=700244`，但服务器上的用户管理系统用的是 SQLite 库**。',
    '让我确认一下服务器上的用户管理系统实际用的是 MySQL 还是 SQLite：',
    '从进程信息看，`python server.py` 是另一个项目，不是用户管理系统。让我看看这个管理系统是不是有 MySQL 配置但没开：',
  ].join('\n\n');

  it('逐段裁掉末尾的前瞻句，保留真正的结论', () => {
    const out = trimTrailingIntent(REAL_TAIL);
    assert.match(out, /SQLite 库里\*\*没有 `horsray` 用户\*\*/);
    assert.match(out, /这就解释了问题/);
    assert.doesNotMatch(out, /让我确认一下/);
    assert.doesNotMatch(out, /让我看看这个管理系统/);
  });

  it('正常结论原样返回', () => {
    assert.equal(trimTrailingIntent('查到了，horsray 属于花生国风空间。'), '查到了，horsray 属于花生国风空间。');
  });

  it('只剩一段时不裁，避免把回复裁空', () => {
    const only = '让我看看这个管理系统是不是有 MySQL 配置但没开：';
    assert.equal(trimTrailingIntent(only), only);
  });
});
