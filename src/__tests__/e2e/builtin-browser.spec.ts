import { test, expect } from '@playwright/test';
import {
  collectConsoleErrors,
  filterCriticalErrors,
  goToChat,
} from '../helpers';

test.describe('Built-in browser tabs', () => {
  test('opens browser preview requests as workspace tabs', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToChat(page);

    const urls = await page.evaluate(() => ({
      firstUrl: `${window.location.origin}/api/setup?browser-e2e=one`,
      secondUrl: `${window.location.origin}/api/setup?browser-e2e=two`,
    }));

    await page.evaluate((firstUrl) => {
      window.dispatchEvent(new CustomEvent('action:open-browser-panel', {
        detail: { url: firstUrl, title: 'Preview One' },
      }));
    }, urls.firstUrl);
    await expect(page.locator('[role="tab"]').first()).toBeVisible();

    await page.evaluate((secondUrl) => {
      window.dispatchEvent(new CustomEvent('browser-navigate', {
        detail: { url: secondUrl, title: 'Preview Two' },
      }));
    }, urls.secondUrl);

    await expect(page.locator('[role="tab"]')).toHaveCount(2);
    await expect(page.locator('iframe').first()).toHaveAttribute('src', urls.secondUrl);
    const tabTexts = await page.locator('[role="tab"]').evaluateAll((tabs) =>
      tabs.map((tab) => tab.textContent?.trim() || ''),
    );
    expect(tabTexts).toContain('Preview One');
    expect(tabTexts).toContain(urls.secondUrl);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });
});
