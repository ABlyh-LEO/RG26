import { expect, test } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

/** 按本届正式赛程核对，不套用常规双败模板，也不增加重置决赛。 */
const expectedDependencies = [
  ['F-M1', 'F-W1A', 'winner'], ['F-M4', 'F-W1A', 'winner'],
  ['F-M2', 'F-W1B', 'winner'], ['F-M3', 'F-W1B', 'winner'],
  ['F-M1', 'F-L1A', 'loser'], ['F-M4', 'F-L1A', 'loser'],
  ['F-M2', 'F-L1B', 'loser'], ['F-M3', 'F-L1B', 'loser'],
  ['F-W1A', 'F-L2A', 'loser'], ['F-L1B', 'F-L2A', 'winner'],
  ['F-W1B', 'F-L2B', 'loser'], ['F-L1A', 'F-L2B', 'winner'],
  ['F-W1A', 'F-WSF', 'winner'], ['F-W1B', 'F-WSF', 'winner'],
  ['F-L2A', 'F-LSF', 'winner'], ['F-L2B', 'F-LSF', 'winner'],
  ['F-LSF', 'F-QUAL', 'winner'], ['F-WSF', 'F-QUAL', 'loser'],
  ['F-WSF', 'F-GF', 'winner'], ['F-QUAL', 'F-GF', 'winner'],
].map(parts => parts.join('|')).sort();

test('分区线与跨区引用共同表达完整的二十条真实依赖，没有伪造晋级或重置赛', async ({ page }) => {
  await page.route('**/data/event.json', route => route.fulfill({ json: audienceSnapshot('before') }));
  await page.goto('./#/progress?view=finals&mode=bracket');
  await waitForData(page);
  const relations = await page.evaluate(() => {
    const local = [...document.querySelectorAll<SVGPathElement>('.bracket__link')].map(link => `${link.dataset.fromId}|${link.dataset.toId}|winner`);
    const cross = [...document.querySelectorAll<HTMLElement>('.finals-transfer')].map(link => `${link.dataset.fromId}|${link.dataset.toId}|${link.dataset.via}`);
    return { local, cross: [...new Set(cross)] };
  });
  expect(relations.local).toHaveLength(11);
  expect(relations.cross).toHaveLength(9);
  expect([...relations.local, ...relations.cross].sort()).toEqual(expectedDependencies);
  await expect(page.locator('[data-node-id="F-GF"]')).toHaveCount(1);
  await expect(page.locator('.bracket__node')).toHaveCount(14);
});

test('桌面及手机完整图中胜者半决赛两个去向可分别定位名额争夺战与总决赛', async ({ page }) => {
  await page.route('**/data/event.json', route => route.fulfill({ json: audienceSnapshot('before') }));
  await page.goto('./#/progress?view=finals&mode=bracket');
  await waitForData(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [to, via] of [['F-QUAL', 'loser'], ['F-GF', 'winner']] as const) {
      const reference = page.locator(`[data-bracket-zone="winners"] .finals-transfer[data-from-id="F-WSF"][data-to-id="${to}"][data-via="${via}"]`);
      await reference.click();
      const target = page.locator(`.bracket__node[data-node-id="${to}"]`);
      await expect(target).toHaveClass(/is-focused/);
      await expect(target).toBeInViewport();
      const visible = await target.evaluate(node => {
        const card = node.getBoundingClientRect();
        const header = document.querySelector('.header')!.getBoundingClientRect();
        const bottom = document.querySelector('.tabbar')!.getBoundingClientRect();
        return { top: card.top, bottom: card.bottom, headerBottom: header.bottom, visibleBottom: bottom.height ? bottom.top : window.innerHeight };
      });
      expect(visible.top).toBeGreaterThanOrEqual(visible.headerBottom);
      expect(visible.bottom).toBeLessThanOrEqual(visible.visibleBottom);
    }
  }
  // 来源引用可返回原比赛，支持沿路径来回核对，不只是改变颜色。
  await page.locator('[data-bracket-zone="championship"] .finals-transfer[data-from-id="F-WSF"][data-to-id="F-GF"][data-via="winner"]').click();
  await expect(page.locator('.bracket__node[data-node-id="F-WSF"]')).toHaveClass(/is-focused/);
  await expect(page.locator('.bracket__node[data-node-id="F-WSF"]')).toBeInViewport();
});

test('手机轮次卡清楚区分胜败者组，点击去向切换轮次并定位，可从来源返回', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/data/event.json', route => route.fulfill({ json: audienceSnapshot('bo3') }));
  await page.goto('./#/progress?view=finals&finalsRound=f-semi');
  await waitForData(page);
  await expect(page.locator('.bracket')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '按轮次查看', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /胜者组/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /败者组/ }).first()).toBeVisible();
  await page.locator('[data-final-match="F-WSF"] .finals-round-transfer[data-to-id="F-QUAL"][data-via="loser"]').click();
  const target = page.locator('[data-final-match="F-QUAL"]');
  await expect(target).toHaveClass(/is-focused/);
  await expect(target).toBeInViewport();
  await expect(page).toHaveURL(/focusMatch=F-QUAL/);
  await expect(target).toContainText('BO3');
  const visible = await target.evaluate(node => {
    const card = node.querySelector('.match-card')?.getBoundingClientRect() ?? node.getBoundingClientRect();
    return { top: card.top, bottom: card.bottom, headerBottom: document.querySelector('.header')!.getBoundingClientRect().bottom, navigationTop: document.querySelector('.tabbar')!.getBoundingClientRect().top };
  });
  expect(visible.top).toBeGreaterThanOrEqual(visible.headerBottom);
  expect(visible.bottom).toBeLessThanOrEqual(visible.navigationTop);
  await target.locator('.finals-round-transfer[data-from-id="F-WSF"][data-via="loser"]').click();
  await expect(page.locator('[data-final-match="F-WSF"]')).toHaveClass(/is-focused/);
  await expect(page.locator('[data-final-match="F-WSF"]')).toBeInViewport();
});

test('BO3 图卡显示系列赛局数，未决出两胜时不标已完成，赛果刷新后正确结算', async ({ page }) => {
  let snapshot = audienceSnapshot('bo3');
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto('./#/progress?view=finals&mode=bracket');
  await waitForData(page);
  const qualifier = page.locator('[data-node-id="F-QUAL"]');
  await expect(qualifier).toContainText(/系列赛\s*1\s*:\s*0/);
  await expect(qualifier.locator('.bracket-card--done')).toHaveCount(0);
  expect((await qualifier.locator('.bracket-card__team').allInnerTexts()).join(' ')).not.toMatch(/16\s*分|7\s*分/);
  snapshot = audienceSnapshot('after');
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(qualifier).toContainText(/系列赛\s*2\s*:\s*0/);
  await expect(qualifier.locator('.bracket-card--done')).toHaveCount(1);
  const final = page.locator('[data-node-id="F-GF"]');
  await expect(final).toContainText(/系列赛\s*2\s*:\s*0/);
  await expect(final).toContainText('第 3 局不需要进行');
  await expect(final.locator('.bracket-card--done')).toHaveCount(1);
});

test('轮次视图在手机到桌面均无页面横向溢出，手机路径和轮次触点足够大', async ({ page }) => {
  await page.route('**/data/event.json', route => route.fulfill({ json: audienceSnapshot('before') }));
  await page.goto('./#/progress?view=finals&finalsRound=f-semi');
  await waitForData(page);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${width}px 页面不应横向溢出` }).toBeLessThanOrEqual(1);
    if (width > 390) continue;
    const controls = page.locator('.finals-round-transfer, [aria-label="选择决赛轮次"] button');
    expect(await controls.count()).toBeGreaterThan(6);
    const tooSmall = await controls.evaluateAll(elements => elements.map(element => ({ text: element.textContent, rect: element.getBoundingClientRect() })).filter(({ rect }) => rect.width < 43.9 || rect.height < 43.9).map(({ text }) => text));
    expect(tooSmall, `${width}px 关联比赛与轮次按钮至少 44px`).toEqual([]);
    const card = page.locator('[data-final-match="F-WSF"]');
    expect((await card.boundingBox())!.width).toBeGreaterThan(width - 80);
  }
});

test('晋级图保留未开始、延迟等执行状态，只有已结束未确认的场次提示等待赛果', async ({ page }) => {
  const snapshot = audienceSnapshot('before');
  const states = [
    ['F-M1', 'scheduled', '未开始'], ['F-M2', 'ready', '准备中'],
    ['F-M3', 'delayed', '延迟'], ['F-M4', 'cancelled', '已取消'],
    ['F-W1A', 'finished', '待赛果确认'], ['F-W1B', 'not-needed', '不需要进行'],
  ] as const;
  for (const [id, status] of states) snapshot.data.finals.series.find(series => series.id === id)!.executionStatus = status;
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto('./#/progress?view=finals&mode=bracket');
  await waitForData(page);
  for (const [id, , label] of states) {
    await expect(page.locator(`[data-node-id="${id}"] .bracket-card__meta`)).toContainText(label);
    await expect(page.locator(`[data-node-id="${id}"] .bracket-card--done`)).toHaveCount(0);
  }
});
