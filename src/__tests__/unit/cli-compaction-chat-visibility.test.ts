import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const chatView = fs.readFileSync(
  path.join(process.cwd(), 'src/components/chat/ChatView.tsx'),
  'utf8',
);

describe('CLI compaction visibility in ChatView', () => {
  it('marks the conversation as compressing when the CLI lifecycle starts', () => {
    const handlerStart = chatView.indexOf("window.addEventListener('context-compressing', handler)");
    assert.ok(handlerStart >= 0, 'ChatView must listen for CLI compaction start events');

    const handler = chatView.slice(
      chatView.lastIndexOf('useEffect(() => {', handlerStart),
      handlerStart,
    );

    assert.match(
      handler,
      /detail\?\.sessionId === sessionId[\s\S]*setIsCompressing\(true\)/,
      'a CLI compaction start must activate the in-chat loading divider',
    );
  });
});
