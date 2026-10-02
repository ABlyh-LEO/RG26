/** 晋级图必须在首次加载、屏幕旋转和赛果刷新后保持卡片与连线对齐。 */
import { expect, test, type Page } from '@playwright/test';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema, publicSnapshotSchema } from '../../src/domain/schema';
import { waitForData } from './helpers';

function fixture(withResult: boolean) {
  const event = eventFileSchema.parse(buildSeedEvent('2026-10-02T09:00:00+08:00'));
  if (withResult) {
    const ids = event.teams.filter((team) => team.division === 'competitive').slice(0, 8).map((team) => team.id);
    const seeds = Object.fromEntries(['W1', 'W2', 'W3', 'W4', 'L1', 'L2', 'L3', 'L4'].map((seed, i) => [seed, ids[i]]));
    event.finals.seeding = {
      seeds, version: 1, publicationStatus: 'published',
      publishedAt: '2026-10-04T12:00:00+08:00', basisNote: '仅浏览器布局回归测试使用的合成种子',
    };
    const series = event.finals.series.find((entry) => entry.id === 'F-M1')!;
    const [home, away] = [seeds.W1!, seeds.L1!];
    series.participantSnapshot = [home, away];
    series.executionStatus = 'finished';
    Object.assign(series.games[0]!, {
      homeTeamId: home, awayTeamId: away, homeScore: '16', awayScore: '10',
      homeReachedSeconds: '121', awayReachedSeconds: '233',
      winnerId: home, resultStatus: 'confirmed', confirmedAt: '2026-10-04T14:40:00+08:00',
    });
    event.teams.find((team) => team.id === home)!.name = '名字够长就一定会有人看队';
  }
  return publicSnapshotSchema.parse({
    schemaVersion: 1, revision: withResult ? 'layout-result' : 'layout-empty',
    builtAt: '2026-10-02T01:00:00Z', sourceCommit: null, data: event,
  });
}

async function geometryProblems(page: Page) {
  return page.locator('.bracket__board').evaluate((board) => {
    const issues: string[] = [];
    const bounds = board.getBoundingClientRect();
    const nodes = new Map([...board.querySelectorAll<HTMLElement>('[data-node-id]')]
      .map((node) => [node.dataset.nodeId!, node.getBoundingClientRect()]));
    const paths = [...board.querySelectorAll<SVGPathElement>('.bracket__link')];
    if (paths.length === 0) issues.push('尚无连线');
    for (const path of paths) {
      const from = nodes.get(path.dataset.fromId ?? '');
      const to = nodes.get(path.dataset.toId ?? '');
      if (!from || !to) { issues.push('连线缺少来源或目标卡片'); continue; }
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(path.getTotalLength());
      for (const [label, point, rect, edge] of [
        ['起点', start, from, from.right], ['终点', end, to, to.left],
      ] as const) {
        const x = point.x + bounds.left;
        const y = point.y + bounds.top;
        if (Math.abs(x - edge) > 2 || y < rect.top - 2 || y > rect.bottom + 2) {
          issues.push(`${path.dataset.fromId}→${path.dataset.toId} ${label}离开卡片边缘`);
        }
      }
    }
    for (const [id, rect] of nodes) {
      if (rect.bottom > bounds.bottom + 1) issues.push(`${id}超出画布底边`);
    }
    for (const column of board.querySelectorAll('.bracket__column')) {
      const cards = [...column.querySelectorAll('[data-node-id]')]
        .map((node) => node.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      for (let i = 1; i < cards.length; i += 1) {
        if (cards[i]!.top < cards[i - 1]!.bottom - 1) issues.push('同一列卡片重叠');
      }
    }
    return issues;
  });
}

async function expectAligned(page: Page) {
  await expect.poll(() => geometryProblems(page), { message: '卡片和晋级连线必须在排版后对齐' }).toEqual([]);
}

test('移动晋级图首次加载、横竖屏切换及横向滚动后保持对齐', async ({ page }, testInfo) => {
  await page.route('**/data/event.json', (route) => route.fulfill({ json: fixture(false) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  await expect(page.locator('.bracket__node')).toHaveCount(47);
  await expectAligned(page);

  for (const [width, height] of [[844, 390], [360, 780], [1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expectAligned(page);
  }
  await page.locator('.bracket__scroller').evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expectAligned(page);
  await expect(page.locator('.bracket__node[data-node-id="F-GF"]')).toBeVisible();
  await testInfo.attach('mobile-finals-after-rotation', {
    body: await page.locator('.bracket').screenshot(), contentType: 'image/png',
  });
});

test('移动晋级图收到成绩及长队名后重新测量，字体增大后仍不裁切', async ({ page }, testInfo) => {
  let snapshot = fixture(false);
  await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  await expect(page.locator('.bracket__node')).toHaveCount(47);
  await expectAligned(page);

  snapshot = fixture(true);
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(page.locator('[data-node-id="F-M1"] .bracket-card--done')).toHaveCount(1);
  await expect(page.locator('[data-node-id="F-M1"]')).toContainText('名字够长就一定会有人看队');
  await expectAligned(page);

  // 模拟移动端字体设置/字体晚加载，只变内容尺寸，不触发 window.resize。
  const firstCard = page.locator('.bracket-card').first();
  const previousHeight = await firstCard.evaluate((element) => element.getBoundingClientRect().height);
  await page.addStyleTag({ content: '.bracket-card__team { font-size: 22px !important; line-height: 1.7 !important; }' });
  await expect.poll(() => firstCard.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(previousHeight);
  await expectAligned(page);
  await testInfo.attach('mobile-results-large-text', {
    body: await page.locator('.bracket').screenshot(), contentType: 'image/png',
  });
});
