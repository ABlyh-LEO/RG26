/**
 * 组委会人工微调过的瑞士轮对阵在观众端的呈现。
 *
 * 用户需求：特殊情况出现时，实际对阵要能在自动生成的对阵表上微调。
 * 微调必须**落到数据**（观众看到的就是实际对阵），并且观众能看到"本轮经过修订"
 * 这个事实与原因 —— 否则观众会以为对阵是系统算错了。
 */
import { expect, test } from '@playwright/test';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

const APP_BASE = './';

test('微调后的对阵被正式采用：观众看到实际对手，并看到修订原因', async ({ page }) => {
  const snapshot = audienceSnapshot('swiss-adjusted');
  const order = snapshot.data.qualification.ranking.orderedTeamIds.slice(0, 16);
  const round1 = snapshot.data.swiss.matches.filter((match) => match.roundIndex === 1);
  const nameOf = (teamId: string) => snapshot.data.teams.find((team) => team.id === teamId)!.name;

  /*
   * 数据层先说清"微调确实写进去了"：自动配对是
   * 第 1 场 order[0] vs order[8]、第 2 场 order[1] vs order[9]，
   * 微调交换两场的第二席位后应当反过来。如果发布时忽略了调整，这里先失败。
   */
  expect(round1[0]!.participantSnapshot).toEqual([order[0], order[9]]);
  expect(round1[1]!.participantSnapshot).toEqual([order[1], order[8]]);
  expect(order[8]).not.toBe(order[9]);
  const round = snapshot.data.swiss.rounds.find((item) => item.index === 1)!;
  expect(round.revisionNote).toContain('交换对手');
  // 微调不改变场次数与时间槽：仍然是 8 场。
  expect(round1).toHaveLength(8);

  await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));
  await page.goto(`${APP_BASE}#/progress?view=swiss&round=1`);
  await waitForData(page);

  const main = page.locator('main');
  await expect(main).toContainText('组委会修订');
  await expect(main).toContainText('交换对手');

  const first = page.locator('.match-card[data-match-id="swiss-r1-00-1"]');
  const second = page.locator('.match-card[data-match-id="swiss-r1-00-2"]');
  await expect(first).toContainText(nameOf(order[0]!));
  await expect(first).toContainText(nameOf(order[9]!));
  await expect(first).not.toContainText(nameOf(order[8]!));
  await expect(second).toContainText(nameOf(order[8]!));
  await expect(second).toContainText(nameOf(order[1]!));
  // 全局比赛编号不受微调影响：第 1 场仍然排在第 45 场。
  await expect(first).toContainText('第 45 场');
});
