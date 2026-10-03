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
  return page.locator('.bracket__board').evaluateAll((boards) => {
    const issues: string[] = [];
    if (boards.length !== 3) issues.push('决赛应有三个独立画布，瑞士轮使用分组全景');
    for (const [boardIndex, board] of boards.entries()) {
      const bounds = board.getBoundingClientRect();
      const nodes = new Map([...board.querySelectorAll<HTMLElement>('[data-node-id]')]
        .map((node) => [node.dataset.nodeId!, node.getBoundingClientRect()]));
      const paths = [...board.querySelectorAll<SVGPathElement>('.bracket__link')];
      // 三个决赛区域必须实际绘制区内路径。
      if (board.closest('[data-bracket-zone]') && paths.length === 0) issues.push(`决赛画布${boardIndex}尚无连线`);
      for (const path of paths) {
        const from = nodes.get(path.dataset.fromId ?? '');
        const to = nodes.get(path.dataset.toId ?? '');
        if (!from || !to) { issues.push('连线跨越分区或缺少来源、目标卡片'); continue; }
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
        if (rect.bottom > bounds.bottom + 1 || rect.top < bounds.top - 1) issues.push(`${id}超出画布上下边界`);
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) issues.push(`${id}超出画布左右边界`);
      }
      const cards = [...nodes.entries()];
      for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) {
        const [aId, a] = cards[i]!, [bId, b] = cards[j]!;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push(`${aId}与${bId}卡片重叠`);
      }
    }
    if (document.documentElement.scrollWidth - document.documentElement.clientWidth > 1) issues.push('页面本体横向溢出');
    return issues;
  });
}

/**
 * 轮询到"卡片与连线完全对齐"。
 *
 * 几何检查要遍历决赛节点做两两重叠判定，在 CI/本机满并发（WebKit 与其它
 * 项目抢 CPU）时，默认 5 秒轮询会在布局稳定前超时，报出假红——而部署门禁
 * 正是这套 e2e。这里只放宽等待时间，判定条件一字不改。
 */
async function expectAligned(page: Page) {
  await expect.poll(() => geometryProblems(page), {
    message: '卡片和晋级连线必须在排版后对齐',
    timeout: 20_000,
  }).toEqual([]);
}

test('移动晋级图首次加载、横竖屏切换及横向滚动后保持对齐', async ({ page }, testInfo) => {
  await page.route('**/data/event.json', (route) => route.fulfill({ json: fixture(false) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  await expect(page.locator('.bracket__node')).toHaveCount(14);
  await expect(page.locator('.swiss-progress')).toBeVisible();
  await expectAligned(page);

  for (const [width, height] of [[844, 390], [360, 780], [1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expectAligned(page);
  }
  await page.locator('.bracket__scroller').evaluateAll((elements) => elements.forEach(element => { element.scrollLeft = element.scrollWidth; }));
  await expectAligned(page);
  await expect(page.locator('.bracket__node[data-node-id="F-GF"]')).toBeVisible();
  await testInfo.attach('mobile-finals-after-rotation', {
    body: await page.locator('[data-journey-stage="finals"]').screenshot(), contentType: 'image/png',
  });
});

test('移动晋级图收到成绩及长队名后重新测量，字体增大后仍不裁切', async ({ page }, testInfo) => {
  let snapshot = fixture(false);
  await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  await expect(page.locator('.bracket__node')).toHaveCount(14);
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
  await expect.poll(() => firstCard.evaluate((element) => element.getBoundingClientRect().height), {
    message: '字体增大后卡片应重新测量并变高',
    timeout: 20_000,
  }).toBeGreaterThan(previousHeight);
  await expectAligned(page);
  await testInfo.attach('mobile-results-large-text', {
    body: await page.locator('[data-journey-stage="finals"]').screenshot(), contentType: 'image/png',
  });
});
