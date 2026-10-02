import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { PublicSnapshot } from '../../src/domain/schema';

async function loaded(page: Page) {
  // Initialization performs real source, draft and Git checks before opening the editor.
  await expect(page.getByRole('heading', { name: '赛事工作台', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.operator-item').first()).toBeVisible();
}
async function saved(page: Page) {
  await expect(page.locator('.operator-save-status')).toHaveText('草稿已自动保存', { timeout: 15_000 });
}
test.beforeEach(async ({ request, page }) => {
  await request.post('/__test/reset');
  await page.goto('/operator.html'); await loaded(page);
});

test('按场次保存未完成输入，切换、刷新与服务重启都恢复', async ({ page, request }, testInfo) => {
  const rows = page.locator('.operator-item');
  await rows.nth(0).click(); await page.getByLabel('积分', { exact: true }).fill('7'); await saved(page);
  await rows.nth(1).click(); await expect(page.getByLabel('积分', { exact: true })).toHaveValue('');
  await page.getByLabel('积分', { exact: true }).fill('11'); await saved(page);
  await rows.nth(0).click(); await expect(page.getByLabel('积分', { exact: true })).toHaveValue('7');
  await page.reload(); await loaded(page); await expect(page.getByLabel('积分', { exact: true })).toHaveValue('7');
  await request.post('/__test/restart'); await page.reload(); await loaded(page);
  await expect(page.getByLabel('积分', { exact: true })).toHaveValue('7');
  await rows.nth(1).click(); await expect(page.getByLabel('积分', { exact: true })).toHaveValue('11');
  let releasePoll!: () => void;
  let capturedPoll!: () => void;
  let completedPoll!: () => void;
  const captured = new Promise<void>((resolve) => { capturedPoll = resolve; });
  const completed = new Promise<void>((resolve) => { completedPoll = resolve; });
  const hold = new Promise<void>((resolve) => { releasePoll = resolve; });
  await page.route('**/api/operator/state', async (route) => {
    const response = await route.fetch(); const stale = await response.json(); capturedPoll();
    await hold; await route.fulfill({ response, json: stale }); completedPoll();
  }, { times: 1 });
  await captured;
  await page.getByLabel('积分', { exact: true }).fill('13'); await saved(page);
  releasePoll(); await completed;
  await expect(page.getByLabel('积分', { exact: true })).toHaveValue('13');
  await mkdir('.tmp-operator-screenshots', { recursive: true });
  await page.screenshot({ path: `.tmp-operator-screenshots/${testInfo.project.name}-workbench.png`, fullPage: true });
});

test('第二窗口只读，显式接管后原窗口停止编辑', async ({ context, page }) => {
  await page.getByLabel('积分', { exact: true }).fill('8'); await saved(page);
  const second = await context.newPage(); await second.goto('/operator.html'); await loaded(second);
  await expect(second.getByText('另一个窗口正在维护赛事，本窗口为只读')).toBeVisible();
  await expect(second.getByLabel('积分', { exact: true })).toBeDisabled();
  await second.getByRole('button', { name: '接管编辑', exact: true }).click();
  await expect(second.getByLabel('积分', { exact: true })).toBeEnabled();
  await expect(second.getByLabel('积分', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('积分', { exact: true })).toBeDisabled({ timeout: 15_000 });
  await second.close();
});

test('校验定位缺失字段，预览不改变正式文件、暂存区和提交', async ({ page, request }, testInfo) => {
  const before = await (await request.get('/__test/state')).json();
  await page.getByRole('button', { name: '保存并确认结果', exact: true }).click();
  await expect(page.getByLabel('成绩文字')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('成绩文字').fill('完成'); await page.getByLabel('积分', { exact: true }).fill('16');
  await page.getByLabel('到达最终分时间（秒）', { exact: true }).fill('88');
  await page.getByRole('button', { name: '保存并确认结果', exact: true }).click(); await saved(page);
  await page.getByRole('button', { name: '预览与发布', exact: true }).click();
  await page.getByRole('button', { name: '核对累计变更', exact: true }).click();
  await expect(page.locator('.operator-changes').first()).toContainText('16');
  await page.getByRole('button', { name: '生成观众预览', exact: true }).click();
  const frame = page.frameLocator('iframe[title="本地草稿观众预览"]');
  await expect(frame.getByText('本地草稿预览 · 尚未发布')).toBeVisible();
  await expect(frame.getByRole('heading', { level: 1 })).toBeVisible();
  const after = await (await request.get('/__test/state')).json(); expect(after).toEqual(before);
  await testInfo.attach('operator-preview.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await mkdir('.tmp-operator-screenshots', { recursive: true });
  await page.screenshot({ path: `.tmp-operator-screenshots/${testInfo.project.name}-preview.png`, fullPage: true });
});

test('BO3 各局固定同队同色且输入互不串用，确认胜局后可继续下一局', async ({ page, request }, testInfo) => {
  const snapshot = await (await request.get('/public-test/data/event.json')).json() as PublicSnapshot;
  const series = snapshot.data.finals.series.find(series => series.id === 'F-QUAL')!;
  const names = series.participantSnapshot!.map(id => snapshot.data.teams.find(team => team.id === id)!.name);
  const fixedSides = async () => {
    for (const [index, color] of ['blue', 'red'].entries()) {
      const heading = page.locator(`.operator-score-side--${color} h3`);
      await expect(heading).toContainText(names[index]!);
      await expect(heading.locator('span')).toHaveText(index === 0 ? '蓝方' : '红方');
    }
  };
  await page.getByLabel('搜索队伍或比赛').fill('总决赛名额');
  await page.locator('.operator-item').first().click();
  await expect(page.locator('.operator-games')).toContainText('全系列赛不换边');
  await fixedSides();
  await page.locator('#result-homeScore').fill('16'); await page.locator('#result-awayScore').fill('7');
  await page.locator('#result-homeSeconds').fill('90'); await page.locator('#result-awaySeconds').fill('200');
  await saved(page);
  await page.getByRole('button', { name: '第 2 局', exact: true }).click();
  await fixedSides();
  await expect(page.locator('#result-homeScore')).toHaveValue('');
  await page.locator('#result-homeScore').fill('8'); await saved(page);
  await mkdir('.tmp-operator-screenshots', { recursive: true });
  await page.screenshot({ path: `.tmp-operator-screenshots/${testInfo.project.name}-bo3-game2.png`, fullPage: true });
  await page.getByRole('button', { name: '第 3 局', exact: true }).click();
  await fixedSides();
  await expect(page.locator('#result-homeScore')).toHaveValue('');
  await page.locator('#result-homeScore').fill('11'); await saved(page);
  await page.getByRole('button', { name: '第 1 局', exact: true }).click();
  await fixedSides();
  await expect(page.locator('#result-homeScore')).toHaveValue('16');
  await page.locator('.operator-winner button').first().click();
  await page.getByRole('button', { name: '保存并录入下一场', exact: true }).click();
  await expect(page.getByText('系列赛比分 1 : 0')).toBeVisible();
  await fixedSides();
  await expect(page.locator('#result-homeScore')).toHaveValue('8'); await saved(page);
  await page.getByRole('button', { name: '第 3 局', exact: true }).click();
  await fixedSides();
  await expect(page.locator('#result-homeScore')).toHaveValue('11');
});

test('公告与改期使用北京时间输入，并保存为独立修订字段', async ({ page }) => {
  await page.getByRole('button', { name: '公告与日程', exact: true }).click();
  await page.getByLabel('日程项', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('修订后开始时间（北京时间）').fill('2026-10-03T09:10');
  await page.getByLabel('调整说明').fill('现场设备准备延后十分钟');
  await page.getByRole('button', { name: '保存调整', exact: true }).click(); await saved(page);
  await page.getByRole('button', { name: '预览与发布', exact: true }).click();
  await page.getByRole('button', { name: '核对累计变更', exact: true }).click();
  await expect(page.locator('.operator-changes')).toContainText('2026-10-03T09:10:00+08:00');
  await expect(page.locator('.operator-changes')).toContainText('现场设备准备延后十分钟');
});

test('旧浏览器草稿导入后必须核对差异，不能直接预览发布', async ({ page, request }) => {
  await page.getByLabel('积分', { exact: true }).fill('5'); await saved(page);
  const clientId = await page.evaluate(() => sessionStorage.getItem('rg26.operator.session'));
  const response = await request.post('/api/operator/session', { headers: { Origin: 'http://127.0.0.1:5399' }, data: { clientId } });
  const state = await response.json();
  state.draft.event.notices.push({ id: 'legacy-test', at: '2026-10-02T12:00:00+08:00', title: '旧草稿公告', body: '需要明确核对', severity: 'info' });
  await page.evaluate((event) => localStorage.setItem('rg26.operator.draft.v1', JSON.stringify(event)), state.draft.event);
  await page.reload(); await loaded(page);
  await expect(page.getByRole('button', { name: '导入旧草稿并核对差异', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '允许旧草稿替换当前本地版本，导入前会下载包含未完成输入的完整备份', exact: true }).check();
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: '导入旧草稿并核对差异', exact: true }).click();
  const original = await page.evaluate(async (url) => (await fetch(url)).json(), (await backup).url());
  expect(original.formInputs).toMatchObject({ 'result:qualification:qual-r1-rank01:1': { homeScore: '5' } });
  await expect(page.getByRole('heading', { name: '旧草稿需要核对基础版本' })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成观众预览', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '核对累计变更', exact: true }).click();
  await expect(page.locator('.operator-changes')).toContainText('旧草稿公告');
  await page.getByRole('checkbox', { name: '我已对照当前正式数据核对全部变更', exact: true }).check();
  await page.getByRole('button', { name: '确认基础版本核对完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成观众预览', exact: true })).toBeEnabled();
});

test('完整草稿导出再导入保留未完成输入，并进入基础版本核对', async ({ page, request, browserName }, testInfo) => {
  await page.getByLabel('积分', { exact: true }).fill('12'); await saved(page);
  await page.getByRole('button', { name: '预览与发布', exact: true }).click();
  await page.getByText('交接、同步与应急工具', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整本地草稿', exact: true }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/^rg26-local-draft-.*\.json$/);
  const content = await page.evaluate(async (url) => (await fetch(url)).text(), exported.url());
  expect(JSON.parse(content).formInputs).toMatchObject({ 'result:qualification:qual-r1-rank01:1': { homeScore: '12' } });
  const failure = await exported.failure();
  let file: string | { name: string; mimeType: string; buffer: Buffer } = testInfo.outputPath('handoff-draft.json');
  if (failure === 'canceled' && browserName === 'chromium' && process.platform === 'win32') {
    // This Windows Chromium installation also cancels a minimal about:blank Blob download.
    // Verify the emitted download and exact Blob bytes, then exercise the real file-import path.
    testInfo.annotations.push({ type: 'environment', description: 'Windows Chromium download directory unavailable; exported Blob bytes verified and imported directly.' });
    file = { name: exported.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(content) };
  } else {
    expect(failure).toBeNull(); await exported.saveAs(file);
  }
  await request.post('/__test/reset'); await page.reload(); await loaded(page);
  await expect(page.getByLabel('积分', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '预览与发布', exact: true }).click();
  await page.getByText('交接、同步与应急工具', { exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole('heading', { name: '旧草稿需要核对基础版本' })).toBeVisible();
  await page.getByRole('button', { name: '赛事工作台', exact: true }).click();
  await expect(page.getByLabel('积分', { exact: true })).toHaveValue('12');
});

test('发布任务完成提交、推送，并按公开版本确认观众可见', async ({ page, request }, testInfo) => {
  const before = await (await request.get('/__test/state')).json();
  await page.getByRole('button', { name: '公告与日程', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('测试公告'); await page.getByLabel('内容', { exact: true }).fill('本公告仅存在于临时验收仓库。');
  await page.getByRole('button', { name: '添加公告', exact: true }).click(); await saved(page);
  await page.getByRole('button', { name: '预览与发布', exact: true }).click();
  await page.getByRole('button', { name: '生成观众预览', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('checkbox', { name: /已核对 .* 项变更和观众预览/ }).check();
  await page.getByRole('button', { name: /^确认发布 \d+ 项变更$/ }).click();
  await expect(page.locator('.operator-job')).toContainText('观众已可见', { timeout: 30_000 });
  const after = await (await request.get('/__test/state')).json(); expect(after.head).not.toBe(before.head);
  await testInfo.attach('operator-published.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await mkdir('.tmp-operator-screenshots', { recursive: true });
  await page.screenshot({ path: `.tmp-operator-screenshots/${testInfo.project.name}-published.png`, fullPage: true });
});
