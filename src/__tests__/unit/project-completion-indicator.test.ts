import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectGroupHeader } from '../../components/layout/ProjectGroupHeader';

// tsx uses the repository's preserve JSX setting for client component imports.
Object.assign(globalThis, { React });

const baseProps = {
  workingDirectory: '/project',
  displayName: 'Project',
  isCollapsed: true,
  isFolderHovered: false,
  isWorkspace: false,
  onToggle() {},
  onMouseEnter() {},
  onMouseLeave() {},
  onCreateSession() {},
};

test('sidebar defaults to five recent sessions while retaining the active-session exception', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/components/layout/ChatListPanel.tsx'), 'utf8');
  assert.match(source, /SESSION_TRUNCATE_LIMIT = 5;/);
  assert.match(source, /truncated\.push\(activeSession\)/);
  assert.match(source, /hasUnreadCompletion=\{hasUnreadCompletion\}/);
  assert.match(source, /group\.sessions\.some\(\(s\) => unreadCompletions\.has\(s\.id\)\)/);
});

for (const isWorkspace of [false, true]) {
  test(`collapsed ${isWorkspace ? 'workspace' : 'project'} shows unread blue completion alongside running green activity`, () => {
    const html = renderToStaticMarkup(React.createElement(ProjectGroupHeader, {
      ...baseProps, isWorkspace, hasRunningSession: true, hasUnreadCompletion: true,
    }));
    assert.match(html, /aria-label="chatList.projectCompletedUnread"/);
    assert.match(html, /bg-status-info/);
    assert.match(html, /aria-label="chatList.projectRunning"/);
    assert.match(html, /bg-status-success/);
  });

  test(`expanded ${isWorkspace ? 'workspace' : 'project'} hides its completion indicator`, () => {
    const html = renderToStaticMarkup(React.createElement(ProjectGroupHeader, {
      ...baseProps, isWorkspace, isCollapsed: false, hasUnreadCompletion: true,
    }));
    assert.doesNotMatch(html, /aria-label="chatList.projectCompletedUnread"/);
  });
}

test('project completion indicator disappears once its unread state is cleared', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectGroupHeader, {
    ...baseProps, hasUnreadCompletion: false,
  }));
  assert.doesNotMatch(html, /aria-label="chatList.projectCompletedUnread"/);
});
