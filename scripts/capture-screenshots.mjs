/**
 * 生成验收截图（docs/IMPLEMENTATION_PLAN.md 第 13.3 节）。
 *
 * 需要的截图：总览、长队名列表、R3 首日晚间赛程、瑞士轮详情、完整决赛图、手机纵向决赛。
 * 用法：先启动 preview 服务器，再运行 node scripts/capture-screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4173';
const OUT = resolve(import.meta.dirname, '..', 'docs', 'acceptance', 'screenshots');
const CHANNEL = process.env.E2E_CHROMIUM_CHANNEL ?? undefined;

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

const SHOTS = [
  { name: 'upgrade-01-overview-desktop', route: '/', viewport: DESKTOP },
  { name: 'upgrade-02-overview-mobile', route: '/', viewport: MOBILE },
  { name: 'upgrade-03-schedule-swiss-day1', route: '/schedule?date=2026-10-03&stage=swiss', viewport: DESKTOP },
  { name: 'upgrade-04-schedule-swiss-day2-mobile', route: '/schedule?date=2026-10-04&stage=swiss', viewport: MOBILE },
  { name: 'upgrade-05-teams-long-names-mobile', route: '/teams', viewport: MOBILE },
  { name: 'upgrade-06-progress-qualification', route: '/progress?view=qualification', viewport: DESKTOP },
  { name: 'upgrade-07-progress-swiss', route: '/progress?view=swiss&round=1', viewport: DESKTOP },
  { name: 'upgrade-08-progress-swiss-mobile', route: '/progress?view=swiss&round=1', viewport: MOBILE },
  { name: 'upgrade-09-finals-bracket', route: '/progress?view=finals&mode=bracket', viewport: DESKTOP },
  { name: 'upgrade-10-finals-mobile-vertical', route: '/progress?view=finals&mode=list', viewport: MOBILE },
  { name: 'upgrade-11-team-detail-longname-mobile', route: '/teams/competitive-13', viewport: MOBILE },
  { name: 'upgrade-12-rules-desktop', route: '/rules', viewport: DESKTOP },
  { name: 'upgrade-13-match-detail', route: '/matches/swiss-r1-00-1', viewport: DESKTOP },
  { name: 'upgrade-14-progress-journey-desktop', route: '/progress?view=journey', viewport: DESKTOP },
  { name: 'upgrade-15-progress-journey-mobile', route: '/progress?view=journey', viewport: MOBILE },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: CHANNEL });
const results = [];

for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/#${shot.route}`, { waitUntil: 'networkidle' });
  // 等元信息条（数据就绪）
  await page.waitForSelector('main[data-ready="true"]', { timeout: 20_000 });
  await page.waitForTimeout(600);

  // 检查横向溢出
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });

  const file = resolve(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file, fullPage: shot.viewport === MOBILE ? false : true });

  results.push({
    name: shot.name,
    route: shot.route,
    viewport: `${shot.viewport.width}x${shot.viewport.height}`,
    overflowPx: overflow.scrollWidth - overflow.clientWidth,
    file,
  });

  await context.close();
}

await browser.close();

console.log('截图已生成：');
for (const r of results) {
  const flag = r.overflowPx > 1 ? '  ← 存在横向溢出！' : '';
  console.log(`  ${r.name}  ${r.viewport}  溢出 ${r.overflowPx}px${flag}`);
}
const bad = results.filter((r) => r.overflowPx > 1);
if (bad.length > 0) {
  console.error(`\n${bad.length} 个截图存在横向溢出。`);
  process.exit(1);
}
console.log('\n全部截图无横向溢出。');
