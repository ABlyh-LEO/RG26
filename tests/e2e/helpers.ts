import { expect, type Page } from '@playwright/test';

/** 元信息条在加载前就存在；等到真实数据时间出现后再检查派生页面。 */
export async function waitForData(page: Page): Promise<void> {
  await expect(page.locator('main[data-ready="true"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** 先确认本次快照已返回，再检查派生视图；不把网络与渲染挤进默认 5 秒断言。 */
export async function refreshSnapshot(page: Page, revision: string): Promise<void> {
  const refreshed = page.waitForResponse(async response =>
    /\/data\/event\.json(?:\?|$)/.test(response.url()) &&
    (await response.json()).revision === revision,
  );
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await refreshed;
}
