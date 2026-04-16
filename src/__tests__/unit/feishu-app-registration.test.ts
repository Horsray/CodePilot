/**
 * Unit tests for Feishu App Registration state machine.
 */

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-feishu-reg-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

let feishuReg: typeof import('../../lib/bridge/feishu-app-registration');
let getSetting: typeof import('../../lib/db').getSetting;
let closeDb: typeof import('../../lib/db').closeDb;

const originalFetch = globalThis.fetch;

type MockResponse = { status: number; body: Record<string, unknown> };

function mockFetch(responses: Map<string, MockResponse[]>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const target = new URL(url);
    const key = `${target.origin}${target.pathname}`;
    const queue = responses.get(key);
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected fetch call: ${url}`);
    }
    const resp = queue.shift()!;
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

const FEISHU_REG_URL = 'https://accounts.feishu.cn/oauth/v1/app/registration';
const LARK_REG_URL = 'https://accounts.larksuite.com/oauth/v1/app/registration';

before(async () => {
  feishuReg = await import('../../lib/bridge/feishu-app-registration');
  ({ getSetting, closeDb } = await import('../../lib/db'));
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('startRegistration', () => {
  it('returns session_id and verification_url on success', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          device_code: 'dc_abc',
          user_code: 'XYZW-1234',
          verification_uri: 'https://open.feishu.cn/page/openclaw',
          verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=XYZW-1234',
          expires_in: 300,
          interval: 5,
        },
      }]],
    ]));

    const result = await feishuReg.startRegistration();
    assert.match(result.sessionId, /^feishu_reg_/);
    assert.equal(result.verificationUrl, 'https://open.feishu.cn/page/openclaw?user_code=XYZW-1234');

    const session = feishuReg.getRegistrationSession(result.sessionId);
    assert.ok(session);
    assert.equal(session!.deviceCode, 'dc_abc');
    assert.equal(session!.status, 'waiting');
    assert.equal(session!.interval, 5000);
  });

  it('throws if response is missing device_code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 200, body: { user_code: 'xxx' } }]],
    ]));
    await assert.rejects(() => feishuReg.startRegistration(), /missing device_code/i);
  });
});

describe('pollRegistration', () => {
  let sessionId: string;

  beforeEach(async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          device_code: 'dc_test',
          user_code: 'AAAA-1111',
          verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=AAAA-1111',
          expires_in: 300,
          interval: 5,
        },
      }]],
    ]));
    const r = await feishuReg.startRegistration();
    sessionId = r.sessionId;
  });

  it('stays waiting on authorization_pending', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'authorization_pending' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'waiting');
    assert.equal(session.errorCode, undefined);
  });

  it('increases interval on slow_down', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'slow_down' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'waiting');
    assert.equal(session.interval, 10000);
  });

  it('maps access_denied to user_denied error code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'access_denied' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'failed');
    assert.equal(session.errorCode, 'user_denied');
  });

  it('maps expired_token to timeout error code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'expired_token' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'expired');
    assert.equal(session.errorCode, 'timeout');
  });

  it('writes credentials to DB on successful completion', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_abc123',
          client_secret: 'secret_xyz',
          user_info: { open_id: 'ou_test', tenant_brand: 'feishu' },
        },
      }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'completed');
    assert.equal(session.appId, 'cli_abc123');
    assert.equal(session.appSecret, 'secret_xyz');
    assert.equal(session.domain, 'feishu');
    assert.equal(getSetting('bridge_feishu_app_id'), 'cli_abc123');
    assert.equal(getSetting('bridge_feishu_app_secret'), 'secret_xyz');
    assert.equal(getSetting('bridge_feishu_domain'), 'feishu');
  });

  it('maps empty credentials to empty_credentials error code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: '',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'feishu' },
        },
      }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'failed');
    assert.equal(session.errorCode, 'empty_credentials');
  });

  it('throws on invalid session_id', async () => {
    await assert.rejects(() => feishuReg.pollRegistration('nonexistent'), /Session not found/);
  });
});

describe('pollRegistration — Lark fallback', () => {
  let sessionId: string;

  beforeEach(async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          device_code: 'dc_lark',
          user_code: 'LARK-0001',
          verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=LARK-0001',
          expires_in: 300,
          interval: 5,
        },
      }]],
    ]));
    const r = await feishuReg.startRegistration();
    sessionId = r.sessionId;
  });

  it('switches to lark endpoint when tenant_brand=lark and retries successfully', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
      [LARK_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: 'lark_secret',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
    ]));

    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'completed');
    assert.equal(session.domain, 'lark');
    assert.equal(session.appSecret, 'lark_secret');
    assert.equal(getSetting('bridge_feishu_domain'), 'lark');
  });

  it('returns waiting when lark retry still says authorization_pending', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
      [LARK_REG_URL, [{
        status: 400,
        body: { error: 'authorization_pending' },
      }]],
    ]));

    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'waiting');
  });

  it('maps missing lark credentials to lark_empty_credentials', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
      [LARK_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
    ]));

    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'failed');
    assert.equal(session.errorCode, 'lark_empty_credentials');
  });
});

describe('cancelRegistration', () => {
  it('removes the session from memory', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          device_code: 'dc_cancel',
          user_code: 'CANCEL-1',
          verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=CANCEL-1',
          expires_in: 300,
          interval: 5,
        },
      }]],
    ]));

    const { sessionId } = await feishuReg.startRegistration();
    assert.ok(feishuReg.getRegistrationSession(sessionId));
    feishuReg.cancelRegistration(sessionId);
    assert.equal(feishuReg.getRegistrationSession(sessionId), null);
  });
});
