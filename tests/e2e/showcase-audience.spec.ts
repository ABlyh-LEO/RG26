import { expect, test, type Page } from '@playwright/test';
import type { PublicSnapshot } from '../../src/domain/schema';
import { applyShowcaseDraw, updateShowcaseStatus } from '../../src/operator/draft';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

async function prepare(page: Page, snapshot: PublicSnapshot) {
  await page.clock.setFixedTime(new Date('2026-10-04T13:00:00+08:00'));
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
}

test('展示组未抽签时卡片和详情只显示待定单队演出', async ({ page }) => {
  await prepare(page, audienceSnapshot('before'));
  await page.goto('./#/schedule?date=2026-10-04&stage=showcase');
  await waitForData(page);
  const card = page.locator('[data-match-id="showcase-final-1"]');
  await expect(card).toContainText('演出队伍待抽签');
  await expect(card).toContainText('单队展示');
  await expect(card.locator('.match-side')).toHaveCount(1);
  await expect(card).not.toContainText(/BO2|不适用|系列赛/);
  await card.getByRole('link', { name: /查看演出详情/ }).click();
  await waitForData(page);
  await expect(page.getByRole('heading', { name: '演出队伍', exact: true })).toBeVisible();
  await expect(page.locator('.detail-scoreboard')).toContainText('演出队伍待抽签');
  await expect(page.locator('.scoreboard-row')).toHaveCount(1);
  await expect(page.locator('.scoreboard-value')).toHaveCount(0);
  await expect(page.locator('.side-badge')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/BO2|不适用|八强双败|系列赛比分/);
});

test('展示组抽签后显示实际队伍，队伍筛选与演出详情对应', async ({ page }) => {
  const snapshot = audienceSnapshot('before');
  const teams = snapshot.data.teams.filter(team => team.division === 'showcase').reverse();
  const draw = applyShowcaseDraw(snapshot.data, teams.map(team => team.id));
  expect(draw.ok).toBe(true);
  snapshot.data = draw.event;
  const performer = teams[0]!;
  await prepare(page, snapshot);
  await page.goto(`./#/schedule?date=2026-10-04&stage=showcase&team=${performer.id}`);
  await waitForData(page);
  await expect(page.locator('.match-card')).toHaveCount(1);
  const card = page.locator('[data-match-id="showcase-final-1"]');
  await expect(card.locator('.team-name')).toHaveText(performer.name);
  await expect(card.locator('.match-side')).toHaveCount(1);
  await card.getByRole('link', { name: /查看演出详情/ }).click();
  await waitForData(page);
  await expect(page.locator('.detail-scoreboard .team-name')).toHaveText(performer.name);
  await expect(page.getByRole('link', { name: '查看展示组赛程', exact: true })).toHaveAttribute('href', new RegExp(`date=2026-10-04&team=${performer.id}`));
  await expect(page.locator('main')).not.toContainText(/BO2|不适用|系列赛比分/);
});

test('三队演出完成后首页、队伍、赛程和详情均显示完成，刷新后保持', async ({ page }) => {
  const snapshot = audienceSnapshot('after');
  const teams = snapshot.data.teams.filter(team => team.division === 'showcase');
  snapshot.data = applyShowcaseDraw(snapshot.data, teams.map(team => team.id)).event;
  for (const series of snapshot.data.finals.series.filter(entry => entry.stage === 'showcase')) {
    const result = updateShowcaseStatus(snapshot.data, series.scheduleItemId, 'finished');
    expect(result.ok).toBe(true);
    snapshot.data = result.event;
  }
  await prepare(page, snapshot);
  await page.clock.setFixedTime(new Date('2026-10-04T18:00:00+08:00'));
  await page.goto('./#/');
  await waitForData(page);
  await expect(page.locator('.event-hero__status')).toContainText('赛事已结束');
  await expect(page.locator('main')).not.toContainText('等待现场确认');
  const progress = page.getByRole('progressbar', { name: '展示组', exact: true });
  await expect(progress).toHaveAttribute('aria-valuenow', '3');
  await expect(progress).toHaveAttribute('aria-valuemax', '3');

  await page.goto('./#/teams?division=showcase');
  await waitForData(page);
  await expect(page.locator('.team-card')).toHaveCount(3);
  for (const name of teams.map(team => team.name)) {
    const card = page.locator('.team-card').filter({ hasText: name });
    await expect(card).toContainText('演出已完成');
    await expect(card).not.toContainText('下一场');
  }

  await page.goto('./#/schedule?date=2026-10-04&stage=showcase');
  await waitForData(page);
  await expect(page.locator('.match-card')).toHaveCount(3);
  for (const card of await page.locator('.match-card').all()) await expect(card).toContainText('已结束');
  await page.goto('./#/matches/showcase-final-1');
  await waitForData(page);
  await expect(page.locator('.detail-heading')).toContainText('已结束');
  await expect(page.locator('.detail-scoreboard .team-name')).toHaveText(teams[0]!.name);
  await expect(page.locator('.scoreboard-value')).toHaveCount(0);
  await page.reload();
  await waitForData(page);
  await expect(page.locator('.detail-heading')).toContainText('已结束');
  await page.goto(`./#/teams/${teams[0]!.id}`);
  await waitForData(page);
  await expect(page.locator('.detail-heading')).toContainText('演出已完成');
});

test('旧格式娱乐表演赛在时间线作为活动展示并保留详情入口', async ({ page }) => {
  const snapshot = audienceSnapshot('before');
  const series = snapshot.data.finals.series.find(entry => !entry.countsForStandings && entry.stage !== 'showcase' && entry.format === 'BO2' && entry.slots === null)!;
  const slot = snapshot.data.scheduleItems.find(item => item.id === series.scheduleItemId)!;
  await prepare(page, snapshot);
  await page.goto('./#/schedule?date=2026-10-04&stage=finals');
  await waitForData(page);
  await expect(page.locator(`[data-match-id="${series.id}"]`)).toHaveCount(0);
  const activity = page.locator('.activity-card').filter({ hasText: slot.title });
  await expect(activity).toContainText('表演活动');
  await expect(activity).not.toContainText(/BO2|不适用/);
  await activity.getByRole('link', { name: slot.title, exact: true }).click();
  await waitForData(page);
  await expect(page).toHaveURL(new RegExp(`/matches/${series.id}$`));
  await expect(page.locator('.detail-heading')).toContainText('BO2');
});
