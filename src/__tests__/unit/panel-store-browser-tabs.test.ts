import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { usePanelStore } from '../../store/usePanelStore';

describe('Panel store browser tabs', () => {
  beforeEach(() => {
    usePanelStore.setState({
      workspaceTabs: [],
      activeWorkspaceTabId: null,
      previewOpen: false,
    });
  });

  it('opens distinct browser URLs in separate workspace tabs by default', () => {
    const store = usePanelStore.getState();

    store.openBrowserTab('http://localhost:3000', 'App');
    store.openBrowserTab('http://localhost:3001', 'Docs');

    const state = usePanelStore.getState();
    assert.equal(state.workspaceTabs.length, 2);
    assert.equal(state.workspaceTabs[0].url, 'http://localhost:3000');
    assert.equal(state.workspaceTabs[1].url, 'http://localhost:3001');
    assert.equal(state.activeWorkspaceTabId, state.workspaceTabs[1].id);
    assert.equal(state.previewOpen, true);
  });

  it('reuses an existing browser tab when newTab is false', () => {
    const store = usePanelStore.getState();

    store.openBrowserTab('http://localhost:3000', 'App');
    store.openBrowserTab('http://localhost:3001', 'Docs', { newTab: false });

    const state = usePanelStore.getState();
    assert.equal(state.workspaceTabs.length, 1);
    assert.equal(state.workspaceTabs[0].url, 'http://localhost:3001');
    assert.equal(state.workspaceTabs[0].title, 'Docs');
  });

  it('activates an existing tab for the same URL instead of duplicating it', () => {
    const store = usePanelStore.getState();

    store.openBrowserTab('http://localhost:3000', 'App');
    const firstTabId = usePanelStore.getState().activeWorkspaceTabId;
    store.openBrowserTab('http://localhost:3000', 'App');

    const state = usePanelStore.getState();
    assert.equal(state.workspaceTabs.length, 1);
    assert.equal(state.activeWorkspaceTabId, firstTabId);
  });
});
