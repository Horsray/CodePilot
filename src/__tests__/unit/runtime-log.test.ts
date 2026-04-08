import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearLogs, getRecentLogs, initRuntimeLog } from '../../lib/runtime-log';

describe('runtime-log', () => {
  beforeEach(() => {
    initRuntimeLog();
    clearLogs();
  });

  afterEach(() => {
    clearLogs();
  });

  it('captures all supported console levels', () => {
    console.log('runtime-log-log');
    console.info('runtime-log-info');
    console.warn('runtime-log-warn');
    console.error('runtime-log-error');
    console.debug('runtime-log-debug');

    const logs = getRecentLogs();
    assert.equal(logs.length, 5);
    assert.deepEqual(
      logs.map((entry) => entry.level),
      ['log', 'info', 'warn', 'error', 'debug'],
    );
    assert.deepEqual(
      logs.map((entry) => entry.message),
      [
        'runtime-log-log',
        'runtime-log-info',
        'runtime-log-warn',
        'runtime-log-error',
        'runtime-log-debug',
      ],
    );
  });
});
