/**
 * 排位赛成绩不完整时的观众端行为。
 *
 * 用户要求（决策 ③）：**可以显示实时排行榜，但必须标注这是"当前排行"，
 * 且不能据此断言谁会晋级。**
 *
 * 这些用例同时守住反面：定榜后（成绩完整 + 显式定榜）必须回到原来的
 * 「正式排名 + 晋级状态」，不能因为加了门禁而丢功能。
 */
import { expect, test } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

const EVENT_START = new Date('2026-10-02T12:00:00+08:00');

test('部分成绩：只显示「当前排行」，不出现晋级结论，且不落库', async ({ page }) => {
  const snapshot = audienceSnapshot('qualification-partial');

  // 数据层：实时排行是派生的，正式名次依旧是空的。
  expect(snapshot.data.qualification.ranking.status).toBe('none');
  expect(snapshot.data.qualification.ranking.orderedTeamIds).toEqual([]);

  await page.clock.setFixedTime(EVENT_START);
  await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));
  await page.goto('./#/progress');
  await waitForData(page);

  const ranking = page.locator('.card').filter({ has: page.locator('.card__title', { hasText: '当前排行' }) });
  await expect(ranking).toHaveCount(1);
  await expect(ranking).toContainText('实时 · 成绩不完整');
  await expect(ranking).toContainText('不作为晋级依据');
  await expect(ranking).toContainText('无成绩');
  // 数据状态必须逐行说清：没有成绩 / 只录到一轮 / 并列，不能静默排成确定位次。
  await expect(ranking).toContainText('仅一轮');
  await expect(ranking).toContainText('并列');
  // 表头是「当前位次」，不是「名次」；且整列没有「晋级状态」。
  await expect(ranking).toContainText('当前位次');
  await expect(ranking).not.toContainText('晋级状态');
  await expect(ranking).not.toContainText('晋级十六强');
  await expect(ranking).not.toContainText('优秀奖');

  const main = page.locator('main');
  await expect(main).not.toContainText('晋级十六强');
  await expect(main).not.toContainText('优秀奖');
  await expect(main).not.toContainText('正式名次');
});

test('队伍列表与详情页在未定榜时只说「当前第 N 位」', async ({ page }) => {
  const snapshot = audienceSnapshot('qualification-partial');
  const scored = snapshot.data.qualification.runs.find((run) => run.resultStatus === 'confirmed')!.teamId;
  const playedTeamIds = new Set(
    snapshot.data.qualification.runs.filter((run) => run.resultStatus === 'confirmed').map((run) => run.teamId),
  );
  const unscored = snapshot.data.teams.find(
    (team) => team.division === 'competitive' && !playedTeamIds.has(team.id),
  )!.id;

  await page.clock.setFixedTime(EVENT_START);
  await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));

  await page.goto('./#/teams');
  await waitForData(page);
  const list = page.locator('main');
  await expect(list).toContainText('当前第');
  await expect(list).not.toContainText('晋级十六强');
  await expect(list).not.toContainText('优秀奖');

  await page.goto(`./#/teams/${scored}`);
  await waitForData(page);
  const scoredMain = page.locator('main');
  await expect(scoredMain).toContainText('当前排行（未确认）');
  await expect(scoredMain).not.toContainText('排位赛正式名次');
  await expect(scoredMain).not.toContainText('优秀奖');

  await page.goto(`./#/teams/${unscored}`);
  await waitForData(page);
  const unscoredMain = page.locator('main');
  await expect(unscoredMain).not.toContainText('优秀奖');
  await expect(unscoredMain).not.toContainText('排位赛正式名次');
  await expect(unscoredMain).not.toContainText('当前第');
});

test('定榜后回到「正式排名 + 晋级状态」', async ({ page }) => {
  // swiss 场景：44 条成绩全部录入并显式定榜。
  const snapshot = audienceSnapshot('swiss');
  expect(snapshot.data.qualification.ranking.status).toBe('confirmed');
  expect(snapshot.data.qualification.ranking.orderedTeamIds).toHaveLength(22);

  await page.clock.setFixedTime(EVENT_START);
  await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));
  await page.goto('./#/progress');
  await waitForData(page);
  await page.getByRole('button', { name: '排位赛', exact: true }).click();

  const ranking = page.locator('.card').filter({ has: page.locator('.card__title', { hasText: '正式排名' }) });
  await expect(ranking).toHaveCount(1);
  await expect(ranking).toContainText('晋级状态');
  await expect(ranking).toContainText('晋级十六强');
  await expect(ranking).toContainText('优秀奖');
  await expect(ranking).not.toContainText('实时 · 成绩不完整');
});
