/** 瑞士轮展示按战绩解释赛制，并用已公布对阵和有效成绩描述实际进度。 */
import { expect, test, type Page } from '@playwright/test';
import { applyBo1Entry } from '../../src/operator/draft';
import { audienceSnapshot, type AudienceScenario } from '../fixtures/audience-scenarios';
import { refreshSnapshot, waitForData } from './helpers';

async function openSwiss(page: Page, scenario: AudienceScenario = 'swiss-r4', query = 'view=swiss') {
  const snapshot = audienceSnapshot(scenario);
  await page.clock.setFixedTime(new Date('2026-10-04T09:00:00+08:00'));
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto(`./#/progress?${query}`);
  await waitForData(page);
  return snapshot;
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test('两个入口共用九个战绩组和真实晋级概览，返回后保留轮次与组', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSwiss(page, 'swiss-r4', 'view=swiss&round=4&group=2-1');
  const swiss = page.locator('.swiss-progress');
  const expectedGroups = ['1:0-0', '2:1-0', '2:0-1', '3:2-0', '3:1-1', '3:0-2', '4:2-1', '4:1-2', '5:2-2'];
  for (const [step, journey] of [false, true, false].entries()) {
    await expect(swiss).toHaveCount(1);
    await expect(swiss.locator('.swiss-map')).toBeVisible();
    expect(await swiss.locator('.swiss-map button[data-swiss-group]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.swissGroup))).toEqual(expectedGroups);
    await expect(swiss.getByRole('button', { name: /已晋级\s*2\s*\/\s*8/ })).toBeVisible();
    await expect(swiss.getByRole('button', { name: /仍在争夺\s*12/ })).toBeVisible();
    await expect(swiss.getByRole('button', { name: /已淘汰\s*2/ })).toBeVisible();
    await expect(swiss.getByRole('button', { name: 'R4', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(swiss.getByRole('button', { name: '2-1 组', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(3);
    await expect(page.locator('.bracket__board')).toHaveCount(journey ? 3 : 0);
    if (step === 0) {
      await page.getByRole('button', { name: '打开完整晋级图', exact: true }).click();
    } else if (step === 1) {
      await page.getByRole('button', { name: '返回轮次视图', exact: true }).click();
    }
  }
});

test('全景组可用键盘打开，深链刷新恢复选择，评分明细默认收起', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSwiss(page);
  const swiss = page.locator('.swiss-progress');
  const target = swiss.locator('button[data-swiss-group="2:1-0"]');
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(swiss.getByRole('button', { name: 'R2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(swiss.getByRole('button', { name: '1-0 组', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(4);
  await expect(page).toHaveURL(/round=2/);
  await expect(page).toHaveURL(/group=1-0/);
  await expect(swiss.getByRole('button', { name: '展开评分明细', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await waitForData(page);
  await expect(swiss.getByRole('button', { name: 'R2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(swiss.getByRole('button', { name: '1-0 组', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await swiss.getByRole('button', { name: '展开评分明细', exact: true }).click();
  await expect(swiss.getByRole('button', { name: '收起评分明细', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(swiss.locator('.swiss-round-details table')).toBeVisible();
  const next = swiss.locator('button[data-swiss-group="3:0-2"]');
  await next.focus();
  await page.keyboard.press('Space');
  await expect(swiss.getByRole('button', { name: 'R3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(2);
});

test('手机默认单轮，可切换全景选组，旋转后页面仍不横向溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSwiss(page);
  const swiss = page.locator('.swiss-progress');
  await expect(swiss.locator('.swiss-map')).not.toBeVisible();
  await expect(swiss.getByRole('button', { name: 'R4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(6);
  await swiss.getByRole('button', { name: '查看全景', exact: true }).click();
  await expect(swiss.locator('.swiss-map')).toBeVisible();
  await expect(swiss.locator('.swiss-map button[data-swiss-group]')).toHaveCount(9);
  const node = swiss.locator('button[data-swiss-group="3:2-0"]');
  const size = await node.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await node.click();
  await expect(swiss.getByRole('button', { name: 'R3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(2);
  await expectNoPageOverflow(page);
  await testInfo.attach('swiss-mobile-panorama', { body: await swiss.screenshot(), contentType: 'image/png' });
  await swiss.getByRole('button', { name: '按轮次查看', exact: true }).click();
  await expect(swiss.locator('.swiss-map')).not.toBeVisible();
  await expect(swiss.getByRole('button', { name: '2-0 组', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const [width, height] of [[844, 390], [360, 780], [768, 1024]] as const) {
    await page.setViewportSize({ width, height });
    await expectNoPageOverflow(page);
    await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(2);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // 一次读取所有实际字号后再逐一放大，避免父级继承造成反复翻倍。
  await swiss.evaluate(root => {
    const sizes = [root, ...root.querySelectorAll('*')].map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of sizes) (element as HTMLElement).style.fontSize = `${size * 2}px`;
  });
  await expect.poll(() => swiss.locator('.swiss-round-tabs').evaluate(element => element.scrollWidth - element.clientWidth), { message: '字体放大 200% 后，五个轮次按钮仍全部可达' }).toBeLessThanOrEqual(1);
  await swiss.getByRole('button', { name: 'R5', exact: true }).click();
  await expect(swiss.getByRole('button', { name: 'R5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(3);
  await expectNoPageOverflow(page);
});

test('从晋级名单选择队伍显示真实历程，所选组仍保留所有对阵和对手', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const snapshot = await openSwiss(page);
  const lastMatch = snapshot.data.swiss.matches.find(match => match.roundIndex === 3 && match.groupRecord === '2-0')!;
  const winnerId = lastMatch.attempts.find(attempt => attempt.id === lastMatch.effectiveAttemptId)!.winnerId!;
  const winner = snapshot.data.teams.find(team => team.id === winnerId)!;
  const swiss = page.locator('.swiss-progress');
  await swiss.getByRole('button', { name: /已晋级\s*2\s*\/\s*8/ }).click();
  await swiss.getByRole('button').filter({ hasText: winner.name }).first().click();
  await expect(page.getByLabel('定位队伍', { exact: true })).toHaveValue(winnerId);
  const journey = swiss.locator('.swiss-team-journey');
  await expect(journey).toContainText(winner.name);
  await expect(journey).toContainText(/晋级八强|已晋级/);
  for (const match of snapshot.data.swiss.matches.filter(match => match.participantSnapshot?.includes(winnerId))) {
    const opponentId = match.participantSnapshot!.find(id => id !== winnerId)!;
    const opponent = snapshot.data.teams.find(team => team.id === opponentId)!;
    await expect(journey).toContainText(opponent.name);
  }
  await swiss.getByRole('button', { name: 'R4', exact: true }).click();
  await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(6);
  await swiss.getByRole('button', { name: 'R3', exact: true }).click();
  const card = swiss.locator(`.match-card[data-match-id="${lastMatch.id}"]`);
  await expect(card.locator('.swiss-match__side')).toHaveCount(2);
  for (const teamId of lastMatch.participantSnapshot!) {
    await expect(card).toContainText(snapshot.data.teams.find(team => team.id === teamId)!.name);
  }
});

test('有效赛果刷新晋级人数与队伍历程，赛前组内排名不因本轮完赛丢失队伍', async ({ page }) => {
  let snapshot = audienceSnapshot('swiss-r4');
  const match = snapshot.data.swiss.matches.find(entry => entry.roundIndex === 4 && entry.groupRecord === '2-1')!;
  const winnerId = match.participantSnapshot![0];
  const winnerName = snapshot.data.teams.find(team => team.id === winnerId)!.name;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto(`./#/progress?view=swiss&round=4&group=2-1&team=${winnerId}`);
  await waitForData(page);
  const swiss = page.locator('.swiss-progress');
  await swiss.getByRole('button', { name: '展开评分明细', exact: true }).click();
  const table = swiss.locator('.swiss-round-details table').first();
  await expect(table.locator('tbody tr')).toHaveCount(6);
  const entriesBefore = await table.locator('tbody').innerText();
  const url = page.url();
  const result = applyBo1Entry(snapshot.data, { matchId: match.id, homeScore: '16', awayScore: '6', homeSeconds: '90', awaySeconds: '160', winnerId, resultKind: 'normal', note: null });
  expect(result.ok).toBe(true);
  snapshot = { ...snapshot, revision: 'test-swiss-r4-one-qualified', data: result.event };
  await refreshSnapshot(page, snapshot.revision);
  await expect(swiss.getByRole('button', { name: /已晋级\s*3\s*\/\s*8/ })).toBeVisible();
  await expect(swiss.getByRole('button', { name: /仍在争夺\s*11/ })).toBeVisible();
  await expect(swiss.getByRole('button', { name: /已淘汰\s*2/ })).toBeVisible();
  await expect(swiss.locator('.swiss-team-journey')).toContainText(/晋级八强|已晋级/);
  await expect(swiss.locator(`.match-card[data-match-id="${match.id}"] .swiss-match__side.is-winner`)).toContainText(winnerName);
  await expect(table.locator('tbody')).toHaveText(entriesBefore, { useInnerText: true });
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await expect(swiss.getByRole('button', { name: '收起评分明细', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(url);
});

test('草稿轮次即使残留参赛快照和赛果也不泄露对手、比分或实际路径', async ({ page }) => {
  const snapshot = audienceSnapshot('swiss');
  const match = snapshot.data.swiss.matches.find(entry => entry.roundIndex === 2)!;
  const [home, away] = match.participantSnapshot!;
  const result = applyBo1Entry(snapshot.data, { matchId: match.id, homeScore: '16', awayScore: '6', homeSeconds: '90', awaySeconds: '160', winnerId: home, resultKind: 'normal', note: null });
  expect(result.ok).toBe(true);
  snapshot.data = result.event;
  const round = snapshot.data.swiss.rounds.find(entry => entry.index === 2)!;
  round.publicationStatus = 'draft';
  round.publishedAt = null;
  snapshot.revision = 'test-swiss-draft-stale-participants';
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto(`./#/progress?view=swiss&round=2&team=${home}`);
  await waitForData(page);
  const swiss = page.locator('.swiss-progress');
  await expect(swiss.locator('.swiss-round-details .match-card')).toHaveCount(8);
  const cards = swiss.locator('.swiss-round-details .match-card');
  await expect(cards.locator('.swiss-match__side .side-badge, [aria-label="胜者"], .match-side__result strong')).toHaveCount(0);
  const text = (await cards.allInnerTexts()).join('\n');
  for (const team of snapshot.data.teams) expect(text).not.toContain(team.name);
  const opponentName = snapshot.data.teams.find(team => team.id === away)!.name;
  await expect(swiss.locator('.swiss-team-journey')).not.toContainText(opponentName);
  await expect(swiss.locator('.swiss-team-journey__steps li')).toHaveCount(1);
});
