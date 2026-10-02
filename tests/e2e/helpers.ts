import { expect, type Page } from '@playwright/test';

/** 元信息条在加载前就存在；等到真实数据时间出现后再检查派生页面。 */
export async function waitForData(page: Page): Promise<void> {
  await expect(page.locator('main[data-ready="true"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
