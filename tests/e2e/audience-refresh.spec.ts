import { expect, test, type Page } from '@playwright/test';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema, publicSnapshotSchema } from '../../src/domain/schema';
import { audienceSnapshot, type AudienceScenario } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

function fixture() {
  return publicSnapshotSchema.parse({
    schemaVersion: 1, revision: 'audience-refresh', builtAt: '2026-10-02T01:00:00Z', sourceCommit: null,
    data: eventFileSchema.parse(buildSeedEvent('2026-10-02T09:00:00+08:00')),
  });
}

async function prepare(page: Page, snapshot = fixture()) {
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00+08:00'));
  await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 390, height: 844 });
}

test('观众首页手机首屏完整展示下一场，完整大图使用专门入口', async ({ page }) => {
  await prepare(page);
  await page.goto('./#/');
  await waitForData(page);
  await expect(page.getByRole('heading', { level: 1, name: '赛场动态' })).toBeVisible();
  const first = page.locator('.match-card').first();
  await expect(first).toBeVisible();
  const bounds = await first.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThan(780);
  await expect(page.locator('.bracket__board')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '完整晋级图', exact: true })).toHaveAttribute('href', /progress\?view=journey/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('关注队伍在列表、详情、首页与另一标签页保持同步', async ({ page, context }) => {
  const snapshot = fixture();
  const team = snapshot.data.teams.find((entry) => entry.division === 'competitive')!;
  await prepare(page, snapshot);
  await page.goto('./#/teams');
  await waitForData(page);
  await page.getByRole('button', { name: `关注${team.name}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `取消关注${team.name}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'RoboGame2026 赛事首页', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我关注的队伍' })).toBeVisible();
  await expect(page.locator('.followed-team')).toContainText(team.name);

  const other = await context.newPage();
  await prepare(other, snapshot);
  await other.goto(`./#/teams/${team.id}`);
  await waitForData(other);
  await expect(other.getByRole('button', { name: '取消关注该队', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await other.getByRole('button', { name: '取消关注该队', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我关注的队伍' })).toHaveCount(0);
  await other.close();
});

test('筛选面板支持键盘关闭，筛选深链刷新后保留', async ({ page }) => {
  await prepare(page);
  await page.goto('./#/schedule');
  await waitForData(page);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '筛选赛程' })).toBeVisible();
  await page.getByLabel('选择赛段', { exact: true }).selectOption('swiss');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '筛选赛程' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '筛选 1', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/stage=swiss/);
  await expect(page.locator('.filter-chip')).toContainText('瑞士轮');
  await page.reload();
  await waitForData(page);
  await expect(page.locator('.filter-chip')).toContainText('瑞士轮');
  await expect(page.locator('.match-card').first()).toContainText('瑞士轮');
});

test('从赛程进入队伍详情后返回保留日期筛选和滚动位置', async ({ page }) => {
  await prepare(page);
  await page.goto('./#/schedule?date=2026-10-03&stage=qualification');
  await waitForData(page);
  const card = page.locator('.match-card').nth(10);
  await card.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => window.scrollY);
  await card.locator('.match-card__open').click();
  await expect(page).toHaveURL(/teams\//);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: '返回队伍', exact: true }).click();
  await expect(page).toHaveURL(/schedule\?date=2026-10-03&stage=qualification/);
  await expect.poll(() => page.evaluate((expected) => Math.abs(window.scrollY - expected), position)).toBeLessThanOrEqual(4);
});

test('改期在赛程和队伍下一场展示同一有效时间并保留原时间', async ({ page }) => {
  const snapshot = fixture();
  const run = snapshot.data.qualification.runs[0]!;
  const item = snapshot.data.scheduleItems.find((entry) => entry.id === run.scheduleItemId)!;
  item.revisedStart = '2026-10-03T09:07:00+08:00';
  item.adjustmentNote = '场地准备顺延 7 分钟';
  await prepare(page, snapshot);
  await page.goto('./#/schedule?date=2026-10-03&stage=qualification');
  await waitForData(page);
  const card = page.locator(`[data-match-id="${run.id}"]`);
  await expect(card.locator('time')).toHaveText('09:07');
  await expect(card.locator('s')).toHaveText('09:00');
  await expect(card).toContainText('场地准备顺延');
  await card.locator('.match-card__open').click();
  await expect(page.locator('.match-card').first().locator('time')).toHaveText('09:07');
  await expect(page.locator('.match-card').first().locator('s')).toHaveText('09:00');
});

test('跨日改期移到实际日期，新增日期可切换且原日不重复出现', async ({ page }) => {
  const snapshot = fixture();
  const run = snapshot.data.qualification.runs[0]!;
  const item = snapshot.data.scheduleItems.find((entry) => entry.id === run.scheduleItemId)!;
  item.revisedStart = '2026-10-05T09:07:00+08:00';
  item.adjustmentNote = '场地维护，改至次日补赛';
  await prepare(page, snapshot);
  await page.goto('./#/schedule?date=2026-10-03&stage=qualification');
  await waitForData(page);
  await expect(page.locator(`[data-match-id="${run.id}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: /DAY 3/ }).click();
  await expect(page).toHaveURL(/date=2026-10-05/);
  await expect(page.locator(`[data-match-id="${run.id}"] time`)).toHaveText('09:07');
  await expect(page.locator(`[data-match-id="${run.id}"] s`)).toContainText('10月3日');
});

for (const scenario of ['before', 'qualification', 'swiss', 'bo3', 'after', 'rescheduled'] as AudienceScenario[]) {
  test(`各赛事阶段显示真实赛况并保持移动布局：${scenario}`, async ({ page }, testInfo) => {
    await prepare(page, audienceSnapshot(scenario));
    await page.clock.setFixedTime(new Date(scenario === 'before' ? '2026-10-02T12:00:00+08:00' : scenario === 'qualification' ? '2026-10-03T09:01:00+08:00' : scenario === 'swiss' ? '2026-10-03T18:01:00+08:00' : '2026-10-04T17:00:00+08:00'));
    await page.goto('./#/');
    await waitForData(page);
    if (scenario === 'qualification' || scenario === 'swiss') {
      await expect(page.getByRole('heading', { name: '正在进行', exact: true })).toBeVisible();
      await expect(page.locator('.match-card--live').first()).toBeVisible();
    }
    if (scenario === 'after') {
      await expect(page.getByRole('heading', { name: '最终结果', exact: true })).toBeVisible();
      await expect(page.locator('.podium__place').first()).not.toContainText('待公布');
      await expect(page.locator('.match-card--live')).toHaveCount(0);
    }
    if (scenario === 'bo3') {
      await page.goto('./#/matches/F-QUAL');
      await waitForData(page);
      await expect(page.getByRole('heading', { name: '小局记录', exact: true })).toBeVisible();
      await expect(page.locator('.detail-scoreboard')).toContainText('1 : 0');
      await expect(page.locator('.detail-scoreboard')).not.toContainText('0 : 0');
    }
    if (scenario === 'rescheduled') {
      const run = audienceSnapshot(scenario).data.qualification.runs[0]!;
      await page.goto(`./#/schedule?date=2026-10-03&team=${run.teamId}`);
      await waitForData(page);
      const rescheduled = page.locator(`[data-match-id="${run.id}"]`);
      await expect(rescheduled.locator('time')).toHaveText('15:30');
      await expect(rescheduled.locator('s')).toHaveText('09:00');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const mobilePath = testInfo.outputPath(`audience-${scenario}-mobile.png`);
    await page.screenshot({ path: mobilePath });
    await testInfo.attach(`audience-${scenario}-mobile`, { path: mobilePath, contentType: 'image/png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const desktopPath = testInfo.outputPath(`audience-${scenario}-desktop.png`);
    await page.screenshot({ path: desktopPath, fullPage: true });
    await testInfo.attach(`audience-${scenario}-desktop`, { path: desktopPath, contentType: 'image/png' });
  });
}
