import { expect, test, type Page } from '@playwright/test';
import type { PublicSnapshot } from '../../src/domain/schema';
import { applyShowcaseDraw } from '../../src/operator/draft';
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
