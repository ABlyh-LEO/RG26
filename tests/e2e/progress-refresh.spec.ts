import { expect, test } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

test('晋级默认当前阶段和已公布轮次，排名显示队名，手机不强制大图', async ({ page }) => {
  let snapshot = audienceSnapshot('before');
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00+08:00'));
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto('./#/progress'); await waitForData(page);
  await expect(page.getByRole('button', { name: '排位赛', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.bracket')).toHaveCount(0);
  snapshot = audienceSnapshot('swiss');
  await page.getByRole('button', { name: '立即刷新' }).click();
  await expect(page.getByRole('button', { name: '立即刷新' })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '瑞士轮', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'R2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.table').first()).toContainText('Uniforest队');
  expect(await page.locator('main').innerText()).not.toMatch(/competitive-\d+/);
});

test('更新结果保留晋级筛选、评分展开和滚动位置，并显示具体摘要', async ({ page }) => {
  const before = audienceSnapshot('swiss'); let snapshot = before;
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto('./#/progress?view=swiss&round=2&group=1-0'); await waitForData(page);
  await page.getByRole('button', { name: '展开评分明细' }).click();
  await page.evaluate(() => window.scrollTo(0, 300));
  const scroll = await page.evaluate(() => window.scrollY);
  snapshot = structuredClone(before); snapshot.revision = 'test-swiss-update';
  snapshot.data.qualification.runs[0]!.rawResult = '裁判补充原始成绩';
  const url = page.url();
  // 用 DOM 点击避免测试本身先把页面滚动到顶部。
  await page.getByRole('button', { name: '立即刷新' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('status')).toContainText('1 场成绩');
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('button', { name: '收起评分明细' })).toHaveAttribute('aria-expanded', 'true');
  expect(Math.abs(await page.evaluate(() => window.scrollY) - scroll)).toBeLessThan(3);
});

test('完整晋级图可定位阶段并高亮队伍真实参赛路径', async ({ page }) => {
  const snapshot = audienceSnapshot('bo3');
  const team = snapshot.data.finals.series.find(s => s.id === 'F-QUAL')!.participantSnapshot![0];
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto(`./#/progress?view=journey&team=${team}`); await waitForData(page);
  await expect(page.locator('.bracket__node.is-highlighted')).not.toHaveCount(0);
  await expect(page.locator('.bracket__link.is-highlighted')).not.toHaveCount(0);
  await page.getByRole('group', { name: '定位晋级图阶段' }).getByRole('button', { name: '总决赛', exact: true }).click();
  await expect.poll(() => page.locator('.bracket__scroller').evaluate(element => element.scrollLeft)).toBeGreaterThan(500);
  await page.getByRole('button', { name: '返回轮次视图' }).click();
  await expect(page.locator('.bracket')).toHaveCount(0);
  await expect(page.getByLabel('定位队伍')).toHaveValue(team);
});
