import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { summarizeChanges } from '../../scripts/operator/storage';

describe('维护者变更摘要', () => {
  it('成绩显示队名与轮次，状态使用中文，排名包含实际队名和名次', () => {
    const before = buildSeedEvent('2026-10-02T12:00:00+08:00'); const after = structuredClone(before);
    const run = after.qualification.runs[0]!;
    run.score = '17'; run.resultStatus = 'confirmed';
    after.qualification.ranking.orderedTeamIds = after.teams.filter((team) => team.division === 'competitive').map((team) => team.id).reverse();
    const changes = summarizeChanges(before, after);
    const score = changes.find((change) => change.path.endsWith('.score'))!;
    expect(score.label).toContain(after.teams.find((team) => team.id === run.teamId)!.name);
    expect(score.label).toContain('排位赛第 1 轮'); expect(score.after).toBe('17');
    expect(changes.find((change) => change.path.endsWith('.resultStatus'))).toMatchObject({ before: '未录入', after: '已确认' });
    const order = changes.find((change) => change.path.endsWith('.orderedTeamIds'))!;
    expect(order.after).toMatch(/^1\. /); expect(order.after).not.toContain('competitive-');
  });
  it('新增公告与BO3小局给出字段差异，不把整条记录当作原始JSON', () => {
    const before = buildSeedEvent('2026-10-02T12:00:00+08:00'); const after = structuredClone(before);
    after.notices.push({ id: 'notice-new', title: '开始检录', body: '请准备下一场', severity: 'info', at: '2026-10-02T05:00:00Z' });
    const game = after.finals.series.find((series) => series.format === 'BO3')!.games[0]!;
    game.homeScore = '15';
    const changes = summarizeChanges(before, after);
    expect(changes.find((change) => change.path.endsWith('.body'))).toMatchObject({ label: '开始检录 / 公告内容', after: '请准备下一场' });
    const score = changes.find((change) => change.path.endsWith('.homeScore'))!;
    expect(score.label).toContain('第 1 局'); expect(score.after).toBe('15');
    expect(changes.some((change) => change.after.includes('"homeScore"'))).toBe(false);
  });
});
