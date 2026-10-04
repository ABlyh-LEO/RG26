import { expect, test } from '@playwright/test';
import { deriveEvent } from '../../src/data/view-model';
import { audienceSnapshot } from '../fixtures/audience-scenarios';
import { waitForData } from './helpers';

function luminance(color: string): number {
  const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
    const component = value / 255;
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}

test('七种奖项使用不同且可读的颜色，列表、详情、总览和晋级页一致', async ({ page }) => {
  const snapshot = audienceSnapshot('after');
  const { awards } = deriveEvent(snapshot.data);
  const entries = [
    { kind: 'champion', label: '冠军', id: awards.champion },
    { kind: 'runnerUp', label: '亚军', id: awards.runnerUp },
    { kind: 'third', label: '季军', id: awards.third },
    { kind: 'topFour', label: '四强', id: awards.topFour[0] },
    { kind: 'topEight', label: '八强', id: awards.topEight[0] },
    { kind: 'topSixteen', label: '十六强', id: awards.topSixteen[0] },
    { kind: 'honorableMention', label: '优秀奖', id: awards.honorableMention[0] },
  ];
  await page.clock.setFixedTime(new Date('2026-10-04T18:00:00+08:00'));
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto('./#/teams?division=competitive');
  await waitForData(page);
  const styles = new Map<string, { color: string; background: string }>();
  for (const entry of entries) {
    expect(entry.id).toBeTruthy();
    const card = page.locator('.team-card').filter({ has: page.locator(`a[href$="/teams/${entry.id}"]`) });
    const badge = card.locator(`[data-award="${entry.kind}"]`);
    await expect(badge).toHaveText(entry.label);
    const style = await badge.evaluate(element => {
      const css = getComputedStyle(element);
      return { color: css.color, background: css.backgroundColor };
    });
    styles.set(entry.kind, style);
    const values = [luminance(style.color), luminance(style.background)].sort((a, b) => b - a);
    expect((values[0]! + 0.05) / (values[1]! + 0.05), `${entry.label} label contrast`).toBeGreaterThanOrEqual(4.5);
  }
  expect(new Set([...styles.values()].map(style => style.background)).size).toBe(7);
  for (const entry of entries) {
    await page.goto(`./#/teams/${entry.id}`);
    await waitForData(page);
    const badge = page.locator(`.detail-heading [data-award="${entry.kind}"]`);
    await expect(badge).toHaveText(entry.label);
    await expect(badge).toHaveCSS('background-color', styles.get(entry.kind)!.background);
    await expect(badge).toHaveCSS('color', styles.get(entry.kind)!.color);
  }
  await page.goto('./#/');
  await waitForData(page);
  await page.getByText('其余获奖队伍', { exact: true }).click();
  for (const entry of entries) {
    await expect(page.locator(`[data-award="${entry.kind}"]`).first()).toHaveCSS('background-color', styles.get(entry.kind)!.background);
  }
  await page.goto('./#/progress?view=finals');
  await waitForData(page);
  for (const entry of entries) {
    await expect(page.locator(`[data-award="${entry.kind}"]`).first()).toHaveCSS('background-color', styles.get(entry.kind)!.background);
  }
});

test('提前晋级与展示组不会被标成已结算竞技奖项', async ({ page }) => {
  const snapshot = audienceSnapshot('swiss-r4');
  const { standings } = deriveEvent(snapshot.data);
  const advanced = [...standings.byTeam.values()].find(team => team.wins === 3)!;
  await page.route('**/data/event.json', route => route.fulfill({ json: snapshot }));
  await page.goto(`./#/teams/${advanced.teamId}`);
  await waitForData(page);
  await expect(page.locator('.detail-heading')).toContainText('晋级八强');
  await expect(page.locator('.detail-heading [data-award]')).toHaveCount(0);
  await page.goto('./#/teams?division=showcase');
  await waitForData(page);
  await expect(page.locator('.team-card')).toHaveCount(3);
  await expect(page.locator('.team-card [data-award]')).toHaveCount(0);
});
