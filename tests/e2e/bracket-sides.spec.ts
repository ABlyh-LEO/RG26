import { expect, test, type Page } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { applyBo3Game } from '../../src/operator/draft';
import { treeGeometryProblems } from '../support/bracket-geometry';
import { refreshSnapshot, waitForData } from './helpers';

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
  }, { message: '队伍旁标明红蓝方后，晋级线仍在正确汇点相接' }).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test('待定队伍的决赛标明固定蓝红席位，未公布瑞士轮不把颜色归给未知队伍', async ({ page }) => {
  const snapshot = audienceSnapshot('before');
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  for (const series of snapshot.data.finals.series.filter(series => series.countsForStandings)) {
    const rows = page.locator(`[data-node-id="${series.id}"] .bracket-card__row`);
    await expect(rows).toHaveCount(2);
    expect(await rows.locator('.side-badge').evaluateAll(badges => badges.map(badge => badge.getAttribute('aria-label')))).toEqual(['蓝方', '红方']);
    if (series.format === 'BO3') {
      const card = page.locator(`[data-node-id="${series.id}"] .bracket-card`);
      await expect(card.locator('.side-badge')).toHaveCount(2);
      await expect(card.getByRole('table')).toHaveCount(0);
    }
  }
  const swiss = page.locator('[data-journey-stage="swiss"]');
  const seen = new Set<string>();
  for (const roundIndex of [1, 2, 3, 4, 5]) {
    await swiss.getByRole('button', { name: `R${roundIndex}`, exact: true }).click();
    const matches = snapshot.data.swiss.matches.filter(match => match.roundIndex === roundIndex);
    await expect(swiss.locator('.match-card')).toHaveCount(matches.length);
    for (const match of matches) {
      const card = swiss.locator(`.match-card[data-match-id="${match.id}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator('.swiss-match__side .side-badge, [aria-label="胜者"], .match-side__result strong')).toHaveCount(0);
      const slots = card.locator('.swiss-match__slot-sides');
      await expect(slots).toContainText('第一席位');
      await expect(slots).toContainText('第二席位');
      expect(await slots.locator('.side-badge').evaluateAll(badges => badges.map(badge => badge.getAttribute('aria-label')))).toEqual(roundIndex % 2 ? ['蓝方', '红方'] : ['红方', '蓝方']);
      const text = await card.innerText();
      for (const team of snapshot.data.teams) expect(text).not.toContain(team.name);
      seen.add(match.id);
    }
  }
  expect(seen.size).toBe(33);
  const swissText = await swiss.innerText();
  for (const team of snapshot.data.teams) expect(swissText).not.toContain(team.name);
  await expect(page.locator('.bracket-card--done, .bracket-card__row.is-winner')).toHaveCount(0);
});

test('已公布瑞士轮按奇偶轮次把颜色标在正确的两支队伍旁', async ({ page }) => {
  const snapshot = audienceSnapshot('bo3');
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  const swiss = page.locator('[data-journey-stage="swiss"]');
  const seen = new Set<string>();
  for (const roundIndex of [1, 2, 3, 4, 5]) {
    await swiss.getByRole('button', { name: `R${roundIndex}`, exact: true }).click();
    const expected = snapshot.data.swiss.matches.filter(match => match.roundIndex === roundIndex);
    await expect(swiss.locator('.match-card')).toHaveCount(expected.length);
    const cards = await swiss.locator('.match-card').evaluateAll(nodes => nodes.map(node => ({
      id: (node as HTMLElement).dataset.matchId!,
      rows: [...node.querySelectorAll('.swiss-match__side')].map(row => ({ team: row.querySelector('.team-name')?.textContent, side: row.querySelector('.side-badge')?.getAttribute('aria-label') })),
    })));
    for (const card of cards) {
      const match = expected.find(match => match.id === card.id)!;
      expect(card.rows.map(row => row.side)).toEqual(roundIndex % 2 ? ['蓝方', '红方'] : ['红方', '蓝方']);
      for (const [index, row] of card.rows.entries()) {
        const team = snapshot.data.teams.find(team => team.id === match.participantSnapshot![index])!;
        expect(row.team).toContain(team.name);
      }
      seen.add(card.id);
    }
  }
  expect(seen.size).toBe(33);
});

test('手机 BO3 仅在队伍旁标明固定颜色，2 比 0 后提示第三局免赛且连线无交叉', async ({ page }) => {
  let snapshot = audienceSnapshot('bo3');
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('./#/progress?view=finals&mode=bracket');
  await waitForData(page);
  for (const id of ['F-QUAL', 'F-GF']) {
    const card = page.locator(`[data-node-id="${id}"] .bracket-card`);
    expect(await card.locator('.bracket-card__row .side-badge').evaluateAll(badges => badges.map(badge => badge.getAttribute('aria-label')))).toEqual(['蓝方', '红方']);
    await expect(card.locator('.side-badge')).toHaveCount(2);
    await expect(card.getByRole('table')).toHaveCount(0);
    const series = snapshot.data.finals.series.find(series => series.id === id)!;
    if (series.participantSnapshot) {
      for (const [index, teamId] of series.participantSnapshot.entries()) {
        const name = snapshot.data.teams.find(team => team.id === teamId)!.name;
        await expect(card.locator('.bracket-card__team').nth(index)).toHaveText(name);
      }
    }
  }
  await expect(page.locator('.bracket__link')).toHaveCount(11);
  await expectMobileGeometry(page);
  snapshot = audienceSnapshot('after');
  await refreshSnapshot(page, snapshot.revision);
  await expect(page.locator('[data-node-id="F-GF"] .bracket-card--done')).toHaveCount(1, { timeout: 15_000 });
  for (const id of ['F-QUAL', 'F-GF']) {
    const card = page.locator(`[data-node-id="${id}"] .bracket-card`);
    expect(await card.locator('.bracket-card__row .side-badge').evaluateAll(badges => badges.map(badge => badge.getAttribute('aria-label')))).toEqual(['蓝方', '红方']);
    await expect(card.locator('.side-badge')).toHaveCount(2);
    await expect(card.getByRole('table')).toHaveCount(0);
    await expect(card).toContainText(/系列赛\s*2\s*:\s*0/);
    await expect(card).toContainText('第 3 局不需要进行');
    await expect(card.locator('.bracket-card__row.is-winner .side-badge')).toHaveAttribute('aria-label', '蓝方');
    const series = snapshot.data.finals.series.find(series => series.id === id)!;
    for (const [index, teamId] of series.participantSnapshot!.entries()) {
      const name = snapshot.data.teams.find(team => team.id === teamId)!.name;
      await expect(card.locator('.bracket-card__team').nth(index)).toContainText(name);
    }
  }
  await expectMobileGeometry(page);
});

test('BO3 第二局赛果与队伍颜色在详情、赛程卡和轮次卡一致，第三局继续沿用', async ({ page }) => {
  const snapshot = audienceSnapshot('bo3');
  const qualifier = snapshot.data.finals.series.find(series => series.id === 'F-QUAL')!;
  const [home, away] = qualifier.participantSnapshot!;
  const result = applyBo3Game(snapshot.data, {
    seriesId: qualifier.id, gameIndex: 2, homeTeamId: home, awayTeamId: away,
    homeScore: '9', awayScore: '16', homeReachedSeconds: '180', awayReachedSeconds: '80',
    winnerId: away, resultKind: 'normal',
  });
  expect(result.ok).toBe(true);
  snapshot.data = result.event;
  snapshot.revision = 'test-bo3-one-all-fixed-sides';
  const names = [home, away].map(id => snapshot.data.teams.find(team => team.id === id)!.name);
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto('./#/matches/F-QUAL');
  await waitForData(page);
  const scoreboard = page.getByRole('region', { name: '对阵与比分' });
  await expect(scoreboard).toContainText('全系列赛不换边');
  await expect(scoreboard).toContainText(/系列赛比分\s*1\s*:\s*1/);
  for (const [index, color] of ['蓝方', '红方'].entries()) {
    const row = scoreboard.locator('.scoreboard-row').nth(index);
    await expect(row.getByLabel(color, { exact: true })).toBeVisible();
    await expect(row.locator('.team-name')).toHaveText(names[index]!);
  }
  const games = page.locator('section').filter({ has: page.getByRole('heading', { name: '小局记录', exact: true }) }).locator('article');
  await expect(games).toHaveCount(3);
  for (const [index, game] of (await games.all()).entries()) {
    for (const [teamIndex, color] of ['蓝方', '红方'].entries()) {
      const row = game.locator('.match-side').filter({ has: page.getByLabel(color, { exact: true }) });
      await expect(row.locator('.team-name')).toHaveText(names[teamIndex]!);
      const expectedScores = [['16', '7'], ['9', '16'], ['—', '—']];
      await expect(row.locator('.match-side__result strong')).toHaveText(expectedScores[index]![teamIndex]!);
    }
  }
  await expect(games.nth(1).locator('.match-side--winner .team-name')).toHaveText(names[1]!);
  await expect(games.nth(1).locator('.match-side--winner .side-badge')).toHaveAttribute('aria-label', '红方');

  const schedule = snapshot.data.scheduleItems.find(item => item.id === qualifier.scheduleItemId)!;
  const date = (schedule.revisedStart ?? schedule.plannedStart).slice(0, 10);
  for (const route of [`/schedule?date=${date}&stage=finals`, '/progress?view=finals&finalsRound=f-qual']) {
    await page.goto(`./#${route}`);
    await waitForData(page);
    const card = page.locator('[data-match-id="F-QUAL"]');
    await expect(card).toContainText(/系列赛\s*1\s*:\s*1/);
    for (const [index, color] of ['蓝方', '红方'].entries()) {
      const row = card.locator('.match-card__sides .match-side').nth(index);
      await expect(row.locator('.team-name')).toHaveText(names[index]!);
      await expect(row.getByLabel(color, { exact: true })).toBeVisible();
    }
  }
});
