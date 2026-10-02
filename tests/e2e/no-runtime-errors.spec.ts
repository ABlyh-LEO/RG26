/**
 * 运行时残留错误检查：所有页面在任何阶段场景下都不得产生
 * 控制台报错、未捕获异常或同源资源加载失败。
 *
 * 这是"开赛前不留错误信息"的自动化防线：页面能渲染不代表没有报错——
 * 例如某个字段缺失时组件抛错被 React 捕获、或图标/数据请求 404，
 * 用户看不到但控制台里全是红的。这里把它们变成断言。
 */
import { expect, test, type Page } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

/** 场景 → 期望渲染的固定时间（与 fixture 内容对应）。 */
const SCENARIOS = [
  { phase: 'before', now: '2026-10-03T08:00:00+08:00' },
  { phase: 'qualification', now: '2026-10-03T16:10:00+08:00' },
  { phase: 'swiss', now: '2026-10-03T21:20:00+08:00' },
  { phase: 'bo3', now: '2026-10-04T16:25:00+08:00' },
  { phase: 'after', now: '2026-10-04T19:00:00+08:00' },
  { phase: 'rescheduled', now: '2026-10-03T13:30:00+08:00' },
] as const;

const ROUTES = [
  '#/',
  '#/schedule',
  '#/progress',
  '#/teams',
  '#/rules',
  '#/matches/swiss-r1-00-1',
  '#/matches/F-GF',
  '#/matches/showcase-final-1',
] as const;

interface Collected {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/** 监听并收集各类错误信息。 */
function collect(page: Page): Collected {
  const collected: Collected = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // favicon 等浏览器自发的 404 不属于页面缺陷。
    if (/favicon/i.test(text)) return;
    collected.consoleErrors.push(text);
  });
  page.on('pageerror', (error) => collected.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.ok()) return;
    const url = response.url();
    if (/favicon/i.test(url)) return;
    // 其它源的失败（例如外部字体）不计入：这里只保证本站资源可加载。
    if (!url.startsWith('http://127.0.0.1:4173')) return;
    collected.failedRequests.push(`${response.status()} ${url}`);
  });
  return collected;
}

test.describe('运行时无残留错误', () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.phase} 场景下所有页面无控制台报错`, async ({ page }) => {
      const snapshot = audienceSnapshot(scenario.phase);
      await page.clock.setFixedTime(new Date(scenario.now));
      await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));
      const collected = collect(page);

      for (const route of ROUTES) {
        await page.goto(`./${route}`);
        await waitForData(page);
        // 让派生渲染与异步数据请求（团队徽标、详情懒加载）走完。
        await page.waitForTimeout(120);
      }

      expect(collected.pageErrors, `未捕获异常：${collected.pageErrors.join(' | ')}`).toEqual([]);
      expect(collected.consoleErrors, `控制台报错：${collected.consoleErrors.join(' | ')}`).toEqual([]);
      expect(
        collected.failedRequests,
        `同源资源加载失败：${collected.failedRequests.join(' | ')}`,
      ).toEqual([]);
    });
  }

  test('真实正式数据（赛前状态）所有页面无报错', async ({ page }) => {
    // 不拦截数据：直接看 data/event.json 的真实内容，即开赛当天的初始状态。
    const collected = collect(page);
    for (const route of ROUTES) {
      await page.goto(`./${route}`);
      await waitForData(page);
      await page.waitForTimeout(120);
    }
    expect(collected.pageErrors, `未捕获异常：${collected.pageErrors.join(' | ')}`).toEqual([]);
    expect(collected.consoleErrors, `控制台报错：${collected.consoleErrors.join(' | ')}`).toEqual([]);
    expect(
      collected.failedRequests,
      `同源资源加载失败：${collected.failedRequests.join(' | ')}`,
    ).toEqual([]);
  });

  test('未知路由与非法 id 优雅回退，不产生报错', async ({ page }) => {
    const collected = collect(page);
    for (const route of ['#/不存在的页面', '#/teams/不存在的队伍', '#/matches/不存在的比赛']) {
      await page.goto(`./${route}`);
      await waitForData(page);
      await page.waitForTimeout(120);
    }
    expect(collected.pageErrors, `未捕获异常：${collected.pageErrors.join(' | ')}`).toEqual([]);
    expect(collected.consoleErrors, `控制台报错：${collected.consoleErrors.join(' | ')}`).toEqual([]);
  });
});
