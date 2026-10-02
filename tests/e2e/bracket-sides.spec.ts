import { expect, test, type Page } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { treeGeometryProblems } from '../support/bracket-geometry';
import { refreshSnapshot, waitForData } from './helpers';

async function sideMatrix(page: Page, id: string) {
  return page.locator(`[data-node-id="${id}"] .bracket-card__game-sides tbody tr`).evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.querySelector('.side-badge')?.getAttribute('aria-label') ?? cell.textContent?.trim())));
}

async function expectMobileGeometry(page: Page) {
  await expect.poll(async () => {
    const boards = await page.locator('[data-bracket-zone] .bracket__board').evaluateAll(elements => elements.map(board => {
      const bounds = board.getBoundingClientRect();
      return {
        zone: board.closest<HTMLElement>('[data-bracket-zone]')!.dataset.bracketZone!,
        paths: [...board.querySelectorAll<SVGPathElement>('.bracket__link')].map(path => ({ from: path.dataset.fromId!, to: path.dataset.toId!, d: path.getAttribute('d')! })),
        nodes: [...board.querySelectorAll<HTMLElement>('[data-node-id]')].map(node => {
          const box = node.getBoundingClientRect();
          return { id: node.dataset.nodeId!, left: box.left - bounds.left, right: box.right - bounds.left, top: box.top - bounds.top, bottom: box.bottom - bounds.top };
        }),
      };
    }));
    return boards.flatMap(treeGeometryProblems);
  }, { message: '红蓝方说明改变卡片尺寸后，晋级线仍在正确汇点相接' }).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const overflow = await page.locator('.bracket-card__game-sides').evaluateAll(tables => tables.filter(table => {
    const card = table.closest('.bracket-card')!.getBoundingClientRect();
    const box = table.getBoundingClientRect();
    return box.left < card.left || box.right > card.right || table.scrollWidth - table.clientWidth > 1;
  }).length);
  expect(overflow, '手机逐局颜色表不得撑出比赛卡片').toBe(0);
}

test('待定队伍的决赛 BO1 标明蓝红席位，未公布瑞士轮只显示席位规则', async ({ page }) => {
  const snapshot = audienceSnapshot('before');
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  for (const series of snapshot.data.finals.series.filter(series => series.countsForStandings && series.format === 'BO1')) {
    const rows = page.locator(`[data-node-id="${series.id}"] .bracket-card__row`);
    await expect(rows).toHaveCount(2);
    expect(await rows.locator('.side-badge').evaluateAll(badges => badges.map(badge => badge.getAttribute('aria-label')))).toEqual(['蓝方', '红方']);
  }
  for (const roundIndex of [1, 2, 3, 4, 5]) {
    const match = snapshot.data.swiss.matches.find(match => match.roundIndex === roundIndex)!;
    const card = page.locator(`[data-node-id="${match.id}"] .bracket-card`);
    await expect(card.locator('.bracket-card__row')).toHaveCount(1);
    await expect(card.locator('.bracket-card__row .side-badge')).toHaveCount(0);
    const slots = card.locator('.bracket-card__slot-sides');
    await expect(slots).toContainText('第一席位');
    await expect(slots).toContainText('第二席位');
    expect(await slots.locator('.side-badge').evaluateAll(badges => badges.map(badge => badge.getAttribute('aria-label')))).toEqual(roundIndex % 2 ? ['蓝方', '红方'] : ['红方', '蓝方']);
  }
  const swissText = await page.locator('[data-journey-stage="swiss"]').innerText();
  for (const team of snapshot.data.teams) expect(swissText).not.toContain(team.name);
  await expect(page.locator('.bracket-card--done, .bracket-card__row.is-winner')).toHaveCount(0);
});

test('已公布瑞士轮按奇偶轮次把颜色标在正确的两支队伍旁', async ({ page }) => {
  const snapshot = audienceSnapshot('bo3');
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  const cards = await page.locator('[data-journey-stage="swiss"] [data-node-id]').evaluateAll(nodes => nodes.map(node => ({
    id: (node as HTMLElement).dataset.nodeId,
    rows: [...node.querySelectorAll('.bracket-card__row')].map(row => ({ team: row.querySelector('.bracket-card__team')?.textContent, side: row.querySelector('.side-badge')?.getAttribute('aria-label') })),
    pendingSlots: node.querySelectorAll('.bracket-card__slot-sides').length,
  })));
  expect(cards).toHaveLength(33);
  for (const card of cards) {
    const match = snapshot.data.swiss.matches.find(match => match.id === card.id)!;
    expect(card.rows.map(row => row.side)).toEqual(match.roundIndex % 2 ? ['蓝方', '红方'] : ['红方', '蓝方']);
    expect(card.pendingSlots).toBe(0);
    for (const [index, row] of card.rows.entries()) {
      const team = snapshot.data.teams.find(team => team.id === match.participantSnapshot![index])!;
      expect(row.team).toContain(team.name);
    }
  }
});

test('手机 BO3 明确逐局换边，2 比 0 后第三局免赛且连线仍无交叉', async ({ page }) => {
  let snapshot = audienceSnapshot('bo3');
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('./#/progress?view=finals&mode=bracket');
  await waitForData(page);
  for (const id of ['F-QUAL', 'F-GF']) {
    const card = page.locator(`[data-node-id="${id}"] .bracket-card`);
    await expect(card.locator('.bracket-card__row .side-badge')).toHaveCount(0);
    await expect(card.getByRole('table', { name: 'BO3 每局红蓝方' })).toHaveCount(1);
    expect(await sideMatrix(page, id)).toEqual([['蓝方', '红方', '蓝方'], ['红方', '蓝方', '红方']]);
  }
  await expect(page.locator('.bracket__link')).toHaveCount(11);
  await expectMobileGeometry(page);
  snapshot = audienceSnapshot('after');
  await refreshSnapshot(page, snapshot.revision);
  await expect(page.locator('[data-node-id="F-GF"] .bracket-card--done')).toHaveCount(1, { timeout: 15_000 });
  for (const id of ['F-QUAL', 'F-GF']) {
    const rows = await sideMatrix(page, id);
    expect(rows.map(row => row.slice(0, 2))).toEqual([['蓝方', '红方'], ['红方', '蓝方']]);
    const table = page.locator(`[data-node-id="${id}"] .bracket-card__game-sides`);
    await expect(table.locator('thead th').last()).toContainText('免赛');
    await expect(table.locator('tbody tr td:nth-of-type(3) [aria-label="不需要进行"]')).toHaveCount(2);
    await expect(table.locator('tbody tr td:nth-of-type(3) .side-badge')).toHaveCount(0);
  }
  await expectMobileGeometry(page);
});
