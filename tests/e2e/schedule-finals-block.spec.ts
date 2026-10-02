/**
 * 赛程页的收尾时段必须逐场错开。
 *
 * 用户报告：「最后两场比赛的时间异常重合」。数据侧已按手册定为
 * 16:35–17:05（名额争夺战）、17:05–17:35（总决赛）、17:35–17:50（表演赛）；
 * 这里守住界面：三场必须落在三个不同的时间分组，且当天没有任何
 * 「同时进行」的分组（排位赛并行批次才允许出现该标记，10 月 4 日全是逐场）。
 */
import { expect, test } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

test('决赛当天每场时间互不重合，收尾三场各自成组', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-04T13:00:00+08:00'));
  await page.route('**/data/event.json', (route) => route.fulfill({ json: audienceSnapshot('before') }));
  await page.goto('./#/schedule?date=2026-10-04');
  await waitForData(page);

  const groupAt = (label: string) =>
    page.locator('.time-group').filter({ has: page.locator('.time-group__label', { hasText: label }) });

  await expect(groupAt('16:35').locator('[data-match-id="F-QUAL"]')).toHaveCount(1);
  await expect(groupAt('17:05').locator('[data-match-id="F-GF"]')).toHaveCount(1);
  // 表演赛不计正式排名，按活动卡片呈现（不是对阵卡）。
  await expect(groupAt('17:35')).toContainText('表演赛');

  // 三场不能挤在同一个时间分组里
  await expect(groupAt('16:35').locator('[data-match-id="F-GF"]')).toHaveCount(0);
  await expect(groupAt('16:35')).not.toContainText('表演赛');
  await expect(groupAt('17:05').locator('[data-match-id="F-QUAL"]')).toHaveCount(0);

  // 当天不应出现"同时进行"；主舞台一次只进行一场
  await expect(page.locator('.time-group').filter({ hasText: '同时进行' })).toHaveCount(0);
});
