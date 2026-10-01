/**
 * 排位赛名次计算测试。
 *
 * 口径（组委会确认）：**积分高者优；积分相同时到达最终分时间早者优**。
 * 「两轮最优」按同一口径取。
 *
 * 这些断言针对**语义**（谁排在谁前面、为什么），不是"函数有没有返回"。
 */
import { describe, expect, it } from 'vitest';
import { computeQualificationRanking, pickBestRun } from '../../src/domain/qualification-ranking';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema, type EventFile, type QualificationRun } from '../../src/domain/schema';

const BASE = eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));

/** 造一条已确认的跑图记录。 */
function run(
  teamId: string,
  round: 1 | 2,
  score: string | null,
  elapsedSeconds: string | null,
  status: QualificationRun['resultStatus'] = 'confirmed',
): QualificationRun {
  return {
    id: `qual-${teamId}-r${round}`,
    teamId,
    round,
    scheduleItemId: `sched-${teamId}-r${round}`,
    venueId: 'venue-a',
    executionStatus: 'finished',
    rawResult: null,
    score,
    elapsedSeconds,
    resultStatus: status,
    judgeNote: null,
    confirmedAt: status === 'confirmed' ? '2026-10-03T08:00:00+08:00' : null,
  };
}

/** 用指定 runs 替换整个排位赛跑图集合。 */
function withRuns(runs: QualificationRun[]): EventFile {
  return { ...BASE, qualification: { ...BASE.qualification, runs } };
}

const TEAMS = BASE.teams.filter((t) => t.division === 'competitive').map((t) => t.id);

describe('pickBestRun：取两轮最优', () => {
  it('积分高的一轮胜出', () => {
    const runs = [run('t1', 1, '80', '30'), run('t1', 2, '95', '40')];
    const best = pickBestRun(runs, 't1')!;
    expect(best.score).toBe(95);
    expect(best.round).toBe(2);
  });

  it('积分相同时用时短的一轮胜出', () => {
    const runs = [run('t1', 1, '90', '50'), run('t1', 2, '90', '20')];
    const best = pickBestRun(runs, 't1')!;
    expect(best.round).toBe(2);
    expect(best.elapsedSeconds).toBe(20);
  });

  it('只有一轮有成绩时，取那一轮而不是无成绩的一轮', () => {
    const runs = [run('t1', 1, '70', '10'), run('t1', 2, null, null, 'none')];
    const best = pickBestRun(runs, 't1')!;
    expect(best.score).toBe(70);
    expect(best.round).toBe(1);
  });

  it('未确认的成绩不参与取最优', () => {
    const runs = [run('t1', 1, '60', '10'), run('t1', 2, '99', '5', 'provisional')];
    const best = pickBestRun(runs, 't1')!;
    // 第二轮虽高但只是草稿，不能影响对外名次
    expect(best.score).toBe(60);
    expect(best.round).toBe(1);
  });

  it('两轮都确认但都无成绩时标记 incomplete', () => {
    const best = pickBestRun([run('t1', 1, null, null), run('t1', 2, null, null)], 't1')!;
    expect(best.incomplete).toBe(true);
    expect(best.score).toBeNull();
  });

  it('只有一轮有效成绩时不算 incomplete，只标 partial', () => {
    const best = pickBestRun([run('t1', 1, '70', '10')], 't1')!;
    // 少录一轮不等于"没有成绩"：那一轮就是它的最优成绩，应正常参与排名
    expect(best.incomplete).toBe(false);
    expect(best.partial).toBe(true);
    expect(best.score).toBe(70);
  });

  it('两轮都有可比成绩时不标 partial', () => {
    const best = pickBestRun([run('t1', 1, '70', '10'), run('t1', 2, '60', '10')], 't1')!;
    expect(best.partial).toBe(false);
  });
});

describe('computeQualificationRanking：名次排序', () => {
  it('积分高者排前', () => {
    const e = withRuns([
      run(TEAMS[0]!, 1, '50', '10'),
      run(TEAMS[1]!, 1, '90', '10'),
      run(TEAMS[2]!, 1, '70', '10'),
    ]);
    const r = computeQualificationRanking(e);
    expect(r.standings.map((s) => s.teamId).slice(0, 3)).toEqual([
      TEAMS[1],
      TEAMS[2],
      TEAMS[0],
    ]);
  });

  it('积分相同时，到达最终分时间早者排前', () => {
    const e = withRuns([
      run(TEAMS[0]!, 1, '80', '45'),
      run(TEAMS[1]!, 1, '80', '12'),
      run(TEAMS[2]!, 1, '80', '30'),
    ]);
    const r = computeQualificationRanking(e);
    expect(r.standings.map((s) => s.teamId).slice(0, 3)).toEqual([
      TEAMS[1], // 12 秒
      TEAMS[2], // 30 秒
      TEAMS[0], // 45 秒
    ]);
  });

  it('两轮最优参与比较：单轮高但另一轮低的队伍按最优一轮排', () => {
    const e = withRuns([
      // t0 最优 85（第 2 轮）
      run(TEAMS[0]!, 1, '40', '10'),
      run(TEAMS[0]!, 2, '85', '60'),
      // t1 最优 90（第 1 轮）
      run(TEAMS[1]!, 1, '90', '60'),
      run(TEAMS[1]!, 2, '20', '10'),
    ]);
    const r = computeQualificationRanking(e);
    expect(r.standings[0]!.teamId).toBe(TEAMS[1]);
    expect(r.standings[0]!.best!.score).toBe(90);
    expect(r.standings[1]!.teamId).toBe(TEAMS[0]);
    expect(r.standings[1]!.best!.score).toBe(85);
  });

  it('名次连续从 1 开始，覆盖全部 22 支竞技组队伍', () => {
    const r = computeQualificationRanking(BASE);
    const competitive = BASE.teams.filter((t) => t.division === 'competitive');
    expect(r.standings).toHaveLength(competitive.length);
    expect(r.standings.map((s) => s.rank)).toEqual(
      Array.from({ length: competitive.length }, (_, i) => i + 1),
    );
    expect(new Set(r.standings.map((s) => s.teamId)).size).toBe(competitive.length);
  });

  it('缺成绩的队伍沉底并列入 incompleteTeamIds', () => {
    const e = withRuns([
      run(TEAMS[0]!, 1, '10', '10'),
      run(TEAMS[0]!, 2, '12', '10'),
      // TEAMS[1] 完全没有记录
      run(TEAMS[2]!, 1, '99', '10'),
      run(TEAMS[2]!, 2, '98', '10'),
    ]);
    const r = computeQualificationRanking(e);
    expect(r.standings[0]!.teamId).toBe(TEAMS[2]);
    expect(r.standings[1]!.teamId).toBe(TEAMS[0]);
    // 无成绩的一律排在最后
    const last = r.standings[r.standings.length - 1]!;
    expect(last.best === null || last.best.incomplete).toBe(true);
    expect(r.incompleteTeamIds).toContain(TEAMS[1]);
  });

  it('只录一轮的队伍按那一轮正常排名，不被压到榜尾', () => {
    const e = withRuns([
      // TEAMS[0] 只录了一轮，但成绩最好
      run(TEAMS[0]!, 1, '95', '10'),
      run(TEAMS[1]!, 1, '20', '10'),
      run(TEAMS[1]!, 2, '25', '10'),
      run(TEAMS[2]!, 1, '30', '10'),
      run(TEAMS[2]!, 2, '35', '10'),
    ]);
    const r = computeQualificationRanking(e);
    // 一轮 95 分应当排第一，而不是因为"少录一轮"沉底
    expect(r.standings[0]!.teamId).toBe(TEAMS[0]);
    expect(r.partialTeamIds).toContain(TEAMS[0]);
    expect(r.incompleteTeamIds).not.toContain(TEAMS[0]);
  });

  it('两轮都有成绩并列时标记 tiedTeamIds', () => {
    const e = withRuns([
      run(TEAMS[0]!, 1, '88', '20'),
      run(TEAMS[0]!, 2, '90', '20'),
      run(TEAMS[1]!, 1, '90', '20'),
      run(TEAMS[1]!, 2, '88', '20'),
    ]);
    const r = computeQualificationRanking(e);
    // 两队最优都是 90 分 20 秒 → 无法用数据区分
    expect(r.tiedTeamIds).toEqual([TEAMS[1]]);
  });

  it('积分与用时都相同的并列被标记，并保持输入顺序（稳定）', () => {
    const e = withRuns([
      run(TEAMS[0]!, 1, '88', '20'),
      run(TEAMS[1]!, 1, '88', '20'),
    ]);
    const r = computeQualificationRanking(e);
    expect(r.tiedTeamIds).toEqual([TEAMS[1]]);
    // 稳定：t0 在输入里靠前，就仍在前面
    expect(r.standings[0]!.teamId).toBe(TEAMS[0]);
    expect(r.standings[1]!.tiedWithPrevious).toBe(true);
  });

  it('单场成绩更新后名次随之改变（自动重排的核心行为）', () => {
    const before = withRuns([
      run(TEAMS[0]!, 1, '80', '30'),
      run(TEAMS[1]!, 1, '70', '30'),
    ]);
    expect(computeQualificationRanking(before).standings[0]!.teamId).toBe(TEAMS[0]);

    // 更正 TEAMS[1] 的成绩使其反超
    const after = withRuns([
      run(TEAMS[0]!, 1, '80', '30'),
      run(TEAMS[1]!, 1, '95', '30'),
    ]);
    const r = computeQualificationRanking(after);
    expect(r.standings[0]!.teamId).toBe(TEAMS[1]);
    expect(r.standings[0]!.rank).toBe(1);
  });

  it('积分并列时按用时纠正名次（同分不同时）', () => {
    const before = withRuns([
      run(TEAMS[0]!, 1, '80', '30'),
      run(TEAMS[1]!, 1, '80', '40'),
    ]);
    expect(computeQualificationRanking(before).standings[0]!.teamId).toBe(TEAMS[0]);

    const after = withRuns([
      run(TEAMS[0]!, 1, '80', '30'),
      run(TEAMS[1]!, 1, '80', '25'), // 更正为更早到达
    ]);
    const r = computeQualificationRanking(after);
    expect(r.standings[0]!.teamId).toBe(TEAMS[1]);
  });

  it('纯函数：不修改输入', () => {
    const runs = [run(TEAMS[0]!, 1, '80', '30'), run(TEAMS[1]!, 1, '70', '30')];
    const e = withRuns(runs);
    const snapshot = JSON.stringify(e);
    computeQualificationRanking(e);
    expect(JSON.stringify(e)).toBe(snapshot);
  });
});
