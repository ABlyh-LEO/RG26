import { expect, test, type Page } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { treeGeometryProblems, type MeasuredBoard } from '../support/bracket-geometry';
import { refreshSnapshot, waitForData } from './helpers';

async function geometryProblems(page: Page): Promise<string[]> {
  const boards: MeasuredBoard[] = await page.locator('[data-bracket-zone] .bracket__board').evaluateAll(elements => elements.map(board => {
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
  const issues = boards.flatMap(treeGeometryProblems);
  if (boards.length !== 3) issues.push('胜者组、败者组和冠军争夺应有三个画布');
  if (boards.reduce((sum, board) => sum + board.paths.length, 0) !== 11) issues.push('必须绘制全部十一条区内真实晋级关系');
  if (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth > 1)) issues.push('页面本体横向溢出');
  return issues;
}

async function expectCleanTree(page: Page) {
  await expect.poll(() => geometryProblems(page), { timeout: 15_000, message: '决赛晋级线应在共同汇点合并，不出现十字交叉、偏移端口或多余折返' }).toEqual([]);
}

for (const scenario of ['before', 'bo3', 'after'] as const) {
  test(`决赛${scenario}在桌面、平板和手机汇入线无十字交叉`, async ({ page }) => {
    await page.route('**/data/event.json', route => route.fulfill({ json: audienceSnapshot(scenario) }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('./#/progress?view=finals&mode=bracket');
    await waitForData(page);
    await expect(page.locator('.bracket__link')).toHaveCount(11);
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expectCleanTree(page);
    }
  });
}

test('手机晋级线旋转、横滑、字体放大及赛果刷新后仍正确汇合', async ({ page }, testInfo) => {
  let snapshot = audienceSnapshot('before');
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/progress?view=journey');
  await waitForData(page);
  await expectCleanTree(page);
  for (const [width, height] of [[844, 390], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expectCleanTree(page);
  }
  await page.locator('[data-bracket-zone] .bracket__scroller').evaluateAll(elements => elements.forEach(element => { element.scrollLeft = element.scrollWidth; }));
  await expectCleanTree(page);
  await page.addStyleTag({ content: '.bracket-card__team { font-size: 22px !important; line-height: 1.7 !important; }' });
  await expectCleanTree(page);
  snapshot = audienceSnapshot('after');
  await refreshSnapshot(page, snapshot.revision);
  await expect(page.locator('[data-node-id="F-GF"] .bracket-card--done')).toHaveCount(1, { timeout: 15_000 });
  await expectCleanTree(page);
  await page.locator('[data-bracket-zone] .bracket__scroller').evaluateAll(elements => elements.forEach(element => { element.scrollLeft = 0; }));
  await testInfo.attach('finals-merged-connectors-mobile-large-text', { body: await page.locator('[data-bracket-zone="winners"]').screenshot(), contentType: 'image/png' });
});
