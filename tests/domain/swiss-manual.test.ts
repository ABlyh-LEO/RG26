/**
 * 瑞士轮配对必须与赛程手册一致（附一 + 赛段二）。
 *
 * 手册原文（`docs/RoboGame2026赛程安排（暂定） (1).docx`，
 * 抽取件 `docs/reference/schedule-extracted.md:49`、`:157`）：
 *
 * - R1：「第一轮按排位赛名次**分为前后两半**，依次安排第1名对第9名、
 *   第2名对第10名，直至第8名对第16名。」
 * - R2 起：「第二轮起按相同胜负战绩分组，组内依附一的R及同分规则重新排序，
 *   按**第1名对末名、第2名对倒数第2名首尾配对**，依此类推；按上述顺序安排组内场次。」
 * - 附一简例：「某同战绩组按R及同分规则排为甲、乙、丙、丁、戊、己、庚、辛，
 *   则依次安排**甲对辛、乙对庚、丙对己、丁对戊**。六队组为第1名对第6名、
 *   第2名对第5名、第3名对第4名；四队组为第1名对第4名、第2名对第3名。」
 *
 * 本文件把这两条规则固化成断言：R1 是「前后两半对位」而不是首尾，
 * R2 起是「组内首尾」而不是相邻。历史上实现正好把两者都做反了。
 */
import { describe, expect, it } from 'vitest';
import type { QualificationRanking } from '../../src/domain/schema';
import { generateSwissPairings, type PairingProposal } from '../../src/domain/swiss';
import { makeRound, makeTeams, simulateSwiss, t } from '../fixtures/swiss-scenario';

const TEAMS = makeTeams();
const TEAM_IDS = TEAMS.map((team) => team.id);

function ranking16(): QualificationRanking {
  return {
    orderedTeamIds: TEAM_IDS,
    bestResultLabels: null,
    status: 'confirmed',
    confirmedAt: '2026-10-03T15:30:00+08:00',
    sourceNote: '手册对照测试',
    publicationStatus: 'published',
    publishedAt: '2026-10-03T15:30:00+08:00',
    missingTeamIds: null,
    partialTeamIds: null,
    tiedTeamIds: null,
    reviewNote: null,
    overrideReason: null,
  };
}

/** 编号较小者获胜，得到手册描述的"常规赛程"分布（2×3-0 / 3×3-1 / 3×3-2 …）。 */
const lowerWins = (_round: number, home: string, away: string): string =>
  Number(home.split('-')[1]) < Number(away.split('-')[1]) ? home : away;

/** 推进到第 n 轮之前：返回已完成的比赛与轮次。 */
function through(roundIndex: number) {
  const scenario = simulateSwiss(TEAM_IDS, lowerWins);
  const played = scenario.matches.filter((m) => m.roundIndex < roundIndex);
  const rounds = [...new Set(played.map((m) => m.roundIndex))]
    .sort((a, b) => a - b)
    .map((index) => makeRound(index, played.filter((m) => m.roundIndex === index)));
  return { proposal: generateSwissPairings({
    roundIndex,
    teamIds: TEAM_IDS,
    matches: played,
    qualification: ranking16(),
    qualificationOfficial: { ok: true, reason: null },
    rounds,
  }), scenario };
}

/** 断言某个战绩组内部是"首尾配对"，且场次顺序与配对顺序一致。 */
function expectHeadToTail(proposal: PairingProposal, record: string): void {
  const group = proposal.standings.groups.find((candidate) => candidate.record === record);
  expect(group, `缺少 ${record} 组`).toBeDefined();
  const ordered = group!.entries.map((entry) => entry.teamId);
  const pairs = proposal.pairs.filter((pair) => pair.groupRecord === record);
  expect(pairs, `${record} 组场次数量`).toHaveLength(Math.floor(ordered.length / 2));
  pairs.forEach((pair, index) => {
    expect(pair.orderInGroup, `${record} 组第 ${index + 1} 场的顺序号`).toBe(index + 1);
    expect(pair.homeTeamId, `${record} 组第 ${index + 1} 场主队`).toBe(ordered[index]);
    expect(pair.awayTeamId, `${record} 组第 ${index + 1} 场客队（应为末名方向）`).toBe(
      ordered[ordered.length - 1 - index],
    );
  });
}

describe('R1 按排位前后两半对位（手册赛段二）', () => {
  const { proposal } = through(1);

  it('生成 8 场且无阻断', () => {
    expect(proposal.blockers).toEqual([]);
    expect(proposal.pairs).toHaveLength(8);
  });

  it('第 1 名对第 9 名、第 2 名对第 10 名……第 8 名对第 16 名', () => {
    const pairs = proposal.pairs.map((pair) => [pair.homeTeamId, pair.awayTeamId]);
    expect(pairs[0]).toEqual([t(1), t(9)]);
    expect(pairs[1]).toEqual([t(2), t(10)]);
    expect(pairs[3]).toEqual([t(4), t(12)]);
    expect(pairs[7]).toEqual([t(8), t(16)]);
  });

  it('场次顺序就是手册列出的配对顺序（第 1 场 = 1 对 9）', () => {
    proposal.pairs.forEach((pair, index) => expect(pair.orderInGroup).toBe(index + 1));
  });
});

describe('R2 起的组内首尾配对（手册附一简例）', () => {
  it('R2 的 8 队组：甲对辛、乙对庚、丙对己、丁对戊', () => {
    const { proposal } = through(2);
    expect(proposal.blockers).toEqual([]);
    expect(proposal.pairs).toHaveLength(8);
    expectHeadToTail(proposal, '1-0');
    expectHeadToTail(proposal, '0-1');
    // 手册简例的四个配对：第 1 名对末名、第 2 名对倒数第 2……
    const group = proposal.standings.groups.find((candidate) => candidate.record === '1-0')!;
    const ordered = group.entries.map((entry) => entry.teamId);
    const first = proposal.pairs[0]!;
    expect([first.homeTeamId, first.awayTeamId]).toEqual([ordered[0], ordered[7]]);
    expect([proposal.pairs[3]!.homeTeamId, proposal.pairs[3]!.awayTeamId]).toEqual([ordered[3], ordered[4]]);
  });

  it('R3 的 4 队组与 8 队组都是首尾', () => {
    const { proposal } = through(3);
    expect(proposal.blockers).toEqual([]);
    expectHeadToTail(proposal, '2-0');
    expectHeadToTail(proposal, '1-1');
    expectHeadToTail(proposal, '0-2');
  });

  it('R4 的 6 队组：第 1 名对第 6 名、第 2 名对第 5 名、第 3 名对第 4 名', () => {
    const { proposal } = through(4);
    expect(proposal.blockers).toEqual([]);
    expectHeadToTail(proposal, '2-1');
    expectHeadToTail(proposal, '1-2');
    const group = proposal.standings.groups.find((candidate) => candidate.record === '2-1')!;
    expect(group.entries).toHaveLength(6);
    const pairs = proposal.pairs.filter((pair) => pair.groupRecord === '2-1');
    expect([pairs[0]!.homeTeamId, pairs[0]!.awayTeamId]).toEqual([group.entries[0]!.teamId, group.entries[5]!.teamId]);
    expect([pairs[2]!.homeTeamId, pairs[2]!.awayTeamId]).toEqual([group.entries[2]!.teamId, group.entries[3]!.teamId]);
  });

  it('R5 的 2-2 组共 6 队，同样是首尾', () => {
    const { proposal } = through(5);
    expect(proposal.blockers).toEqual([]);
    expect(proposal.pairs).toHaveLength(3);
    expectHeadToTail(proposal, '2-2');
  });
});

describe('常规赛程与手册一致', () => {
  it('共 33 场，最终战绩分布 2 / 3 / 3 / 3 / 3 / 2', () => {
    const scenario = simulateSwiss(TEAM_IDS, lowerWins);
    expect(scenario.matches).toHaveLength(33);
    const dist = new Map<string, number>();
    for (const record of scenario.expectedRecords.values()) {
      const key = `${record.wins}-${record.losses}`;
      dist.set(key, (dist.get(key) ?? 0) + 1);
    }
    expect(dist.get('3-0')).toBe(2);
    expect(dist.get('3-1')).toBe(3);
    expect(dist.get('3-2')).toBe(3);
    expect(dist.get('2-3')).toBe(3);
    expect(dist.get('1-3')).toBe(3);
    expect(dist.get('0-3')).toBe(2);
  });
});
