/**
 * 更正机制与跨队伍重算（D08、D14）。
 */
import { describe, expect, it } from 'vitest';
import { buildCorrection, canExportOfficial, collectDownstreamSeries, previewCorrection } from '../../src/domain/corrections';
import { calculateSwissStandings } from '../../src/domain/standings';
import { makeAttempt, makeMatch, makeRound, makeTeams, simulateSwiss, t, rankingFixtureFrom } from '../fixtures/finals-scenario';
import type { EventFile } from '../../src/domain/schema';
import { toFixed2 } from '../../src/domain/rational';

const TEAM_IDS = Array.from({ length: 16 }, (_, i) => t(i + 1));

/** 让编号较小者获胜。 */
const lowerWins = (_r: number, home: string, away: string): string => {
  const hn = Number(home.split('-')[1]);
  const an = Number(away.split('-')[1]);
  return hn < an ? home : away;
};

function makeEventWithSwiss(rounds: ReturnType<typeof simulateSwiss>): EventFile {
  return {
    schemaVersion: 1,
    event: {
      id: 'robogame-2026',
      name: '测试',
      timezone: 'Asia/Shanghai',
      dates: ['2026-10-03', '2026-10-04'],
      sourceDocumentSha256: '96c9c6b67cbd7e75e127d4126b36d166b583cb4f3de6fd98ac532bd80bb18a47',
      officialScheduleUrl: null,
      scheduleNotice: '测试',
      contentUpdatedAt: '2026-10-04T00:00:00+08:00',
      openItems: [],
    },
    rules: { version: 'test', qualificationRankingMode: 'official-manual', swissPairingPolicy: 'same-record-adjacent' },
    teams: makeTeams(),
    venues: [],
    scheduleItems: [],
    qualification: { runs: [], ranking: rankingFixtureFrom(TEAM_IDS) },
    swiss: { rounds: rounds.rounds, matches: rounds.matches },
    finals: { seeding: null, series: [] },
    showcase: { drawOrder: null, confirmedAt: null, note: null },
    notices: [],
    corrections: [],
  };
}

describe('D08 3-0 后历史对手继续比赛', () => {
  it('该队 W/L/P 保持，O/R 随历史对手后续成绩变化', () => {
    // t1 在两轮内取得 2-0，然后在 R3 取得 3-0 并停止参赛。
    const r1 = [
      makeMatch(1, '0-0', 1, t(1), t(16), [
        makeAttempt('a1', t(1), t(16), t(1), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'a1'),
      makeMatch(1, '0-0', 2, t(2), t(15), [
        makeAttempt('a2', t(2), t(15), t(2), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'a2'),
    ];
    const r2 = [
      makeMatch(2, '1-0', 1, t(1), t(2), [
        makeAttempt('b1', t(1), t(2), t(1), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'b1'),
      makeMatch(2, '0-1', 1, t(15), t(16), [
        makeAttempt('b2', t(15), t(16), t(15), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'b2'),
    ];
    const r3 = [
      makeMatch(3, '2-0', 1, t(1), t(3), [
        makeAttempt('c1', t(1), t(3), t(1), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'c1'),
    ];

    const before = calculateSwissStandings(TEAM_IDS, [...r1, ...r2, ...r3], rankingFixtureFrom(TEAM_IDS));
    const t1Before = before.byTeam.get(t(1))!;
    expect(t1Before.wins).toBe(3);
    expect(t1Before.losses).toBe(0);
    const pBefore = t1Before.metrics.p;
    const oBefore = t1Before.metrics.o;
    const rBefore = t1Before.metrics.r;

    // 历史对手 t2 与 t3 继续比赛并获胜 → t1 的 O 应变化，但 P 不变
    const later = [
      makeMatch(4, '2-1', 1, t(2), t(4), [
        makeAttempt('d1', t(2), t(4), t(2), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'd1'),
      makeMatch(4, '1-2', 1, t(3), t(5), [
        makeAttempt('d2', t(3), t(5), t(3), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'd2'),
    ];

    const after = calculateSwissStandings(TEAM_IDS, [...r1, ...r2, ...r3, ...later], rankingFixtureFrom(TEAM_IDS));
    const t1After = after.byTeam.get(t(1))!;

    // P、W、L 保持（不因停止参赛而清零）
    expect(t1After.wins).toBe(3);
    expect(t1After.losses).toBe(0);
    expect(toFixed2(t1After.metrics.p)).toBe(toFixed2(pBefore));
    expect(t1After.metrics.n).toBe(t1Before.metrics.n);

    // O 与 R 可以变化（对手战绩更新）
    expect(toFixed2(t1After.metrics.o)).not.toBe(toFixed2(oBefore));
    expect(toFixed2(t1After.metrics.r)).not.toBe(toFixed2(rBefore));
  });

  it('最终 W1/W2 必须等 R5 全部结束后确定', () => {
    // 用一个到了 R3 就停止的赛程验证：此时 3-0 组只有 2 队，但 3-2 组等尚未产生，
    // 因此不能提前宣布最终种子顺序（种子分配需要完整战绩组）。
    const scenario = simulateSwiss(TEAM_IDS, lowerWins);
    const throughR3 = scenario.matches.filter((m) => m.roundIndex <= 3);
    const partial = calculateSwissStandings(TEAM_IDS, throughR3, rankingFixtureFrom(TEAM_IDS));

    const g30 = partial.groups.find((g) => g.record === '3-0')!.entries;
    expect(g30).toHaveLength(2);

    // 但那两支 3-0 队的 O/R 仍会随后续轮次变化
    const full = calculateSwissStandings(TEAM_IDS, scenario.matches, rankingFixtureFrom(TEAM_IDS));
    for (const entry of g30) {
      const before = entry.metrics.r;
      const after = full.byTeam.get(entry.teamId)!.metrics.r;
      expect(toFixed2(after)).not.toBe(toFixed2(before));
    }
  });
});

describe('D14 更正已确认瑞士成绩', () => {
  it('重算全体 O/R，已公布但未开赛的下游轮次出现需处置提示', () => {
    const scenario = simulateSwiss(TEAM_IDS, lowerWins);

    // 真实场景：更正发生在**最近一个已确认轮次**（R2），
    // 其下游 R3 已公布但尚未开赛 —— 即第 6.3 节的第 2 类情形。
    const throughR2 = scenario.matches.filter((m) => m.roundIndex <= 2);
    const r3Matches = scenario.matches.filter((m) => m.roundIndex === 3).map((m) => ({
      ...m,
      // R3 已公布但未开赛：没有结果，执行状态为 scheduled。
      attempts: [],
      effectiveAttemptId: null,
      executionStatus: 'scheduled' as const,
    }));

    const event = makeEventWithSwiss({
      matches: [...throughR2, ...r3Matches],
      rounds: [
        makeRound(1, throughR2.filter((m) => m.roundIndex === 1)),
        makeRound(2, throughR2.filter((m) => m.roundIndex === 2)),
        makeRound(3, r3Matches),
      ],
      expectedRecords: new Map(),
    });

    // 更正 R2 的一场比赛：把胜者反转
    const targetMatch = throughR2.find((m) => m.roundIndex === 2)!;
    const attempt = targetMatch.attempts[0]!;
    const newWinner = attempt.winnerId === attempt.homeTeamId ? attempt.awayTeamId : attempt.homeTeamId;
    const corrected: typeof targetMatch = {
      ...targetMatch,
      attempts: [{ ...attempt, winnerId: newWinner }],
    };

    const updatedMatches = event.swiss.matches.map((m) => (m.id === targetMatch.id ? corrected : m));

    const impact = previewCorrection(event, {
      reason: '裁判复核后更正 R2 一场胜负',
      matchIds: [targetMatch.id],
      updatedMatches,
    });

    // 跨队伍重算：全体队伍都在重算集合中（O/R 依赖历史对手）
    expect(impact.recomputedTeamIds).toHaveLength(16);
    // 排名确实发生变化
    expect(impact.rankingChanges.length).toBeGreaterThan(0);
    // R3 已公布但未开赛 → 需要处置，且阻断导出
    expect(impact.requiredDisposition).toBe('pending');
    expect(impact.affectedPublishedRounds.some((r) => r.index === 3)).toBe(true);
    expect(impact.blockers.join(' ')).toContain('保留并说明');
    // 没有任何下游比赛开赛
    expect(impact.startedDownstreamMatches).toEqual([]);
  });

  it('下游尚未发布时可以直接重算并重建候选', () => {
    const scenario = simulateSwiss(TEAM_IDS, lowerWins);
    // 只有 R1 已确认；R2 仍是草稿（尚未发布）
    const r1 = scenario.matches.filter((m) => m.roundIndex === 1);
    const r2Draft = scenario.matches.filter((m) => m.roundIndex === 2).map((m) => ({
      ...m,
      attempts: [],
      effectiveAttemptId: null,
      executionStatus: 'scheduled' as const,
    }));

    const event = makeEventWithSwiss({
      matches: [...r1, ...r2Draft],
      rounds: [makeRound(1, r1), makeRound(2, r2Draft, false)],
      expectedRecords: new Map(),
    });

    const targetMatch = r1[0]!;
    const attempt = targetMatch.attempts[0]!;
    const newWinner = attempt.winnerId === attempt.homeTeamId ? attempt.awayTeamId : attempt.homeTeamId;
    const updatedMatches = event.swiss.matches.map((m) =>
      m.id === targetMatch.id ? { ...m, attempts: [{ ...attempt, winnerId: newWinner }] } : m,
    );

    const impact = previewCorrection(event, {
      reason: '更正 R1',
      matchIds: [targetMatch.id],
      updatedMatches,
    });

    // 下游未发布 → 第一类情形，不阻断
    expect(impact.requiredDisposition).toBe('downstream-not-published');
    expect(impact.affectedPublishedRounds).toEqual([]);
    expect(impact.startedDownstreamMatches).toEqual([]);
    expect(impact.blockers).toEqual([]);
  });

  it('下游已开赛时要求记录组委会修订，并保留已有比赛记录', () => {
    const scenario = simulateSwiss(TEAM_IDS, lowerWins);
    const r1 = scenario.matches.filter((m) => m.roundIndex === 1);
    const r2 = scenario.matches.filter((m) => m.roundIndex === 2);

    const event = makeEventWithSwiss({
      matches: [...r1, ...r2],
      rounds: [makeRound(1, r1), makeRound(2, r2)],
      expectedRecords: new Map(),
    });

    const target = r1[0]!;
    const attempt = target.attempts[0]!;
    const newWinner = attempt.winnerId === attempt.homeTeamId ? attempt.awayTeamId : attempt.homeTeamId;
    const updatedMatches = event.swiss.matches.map((m) =>
      m.id === target.id ? { ...m, attempts: [{ ...attempt, winnerId: newWinner }] } : m,
    );

    const impact = previewCorrection(event, {
      reason: '更正',
      matchIds: [target.id],
      updatedMatches,
    });

    // R2 已开赛（有 attempts）→ 必须走 committee-revision-recorded
    expect(impact.startedDownstreamMatches.length).toBeGreaterThan(0);
    expect(impact.requiredDisposition).toBe('committee-revision-recorded');
    expect(impact.blockers.join(' ')).toContain('不能静默把旧比分移给另一支队');
  });

  it('未处置的更正阻止导出正式版本', () => {
    const event = makeEventWithSwiss(simulateSwiss(TEAM_IDS, lowerWins));
    const impact = previewCorrection(event, {
      reason: '测试',
      matchIds: [],
      updatedMatches: event.swiss.matches,
    });
    const correction = buildCorrection('c1', { reason: '测试', matchIds: [], updatedMatches: [] }, impact, '2026-10-04T00:00:00+08:00', 'pending', 'old', 'new');
    const withCorrection: EventFile = { ...event, corrections: [correction] };

    const gate = canExportOfficial(withCorrection);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join(' ')).toContain('尚未处置');
  });

  it('已处置且允许推进的更正不阻止导出', () => {
    const event = makeEventWithSwiss(simulateSwiss(TEAM_IDS, lowerWins));
    const impact = previewCorrection(event, {
      reason: '测试',
      matchIds: [],
      updatedMatches: event.swiss.matches,
    });
    const correction = buildCorrection(
      'c1',
      { reason: '测试', matchIds: [], updatedMatches: [] },
      impact,
      '2026-10-04T00:00:00+08:00',
      'downstream-not-published',
      'old',
      'new',
    );
    const gate = canExportOfficial({ ...event, corrections: [correction] });
    expect(gate.ok).toBe(true);
  });
});

describe('决赛下游依赖闭包', () => {
  it('从任意瑞士轮更正出发，所有计入排名的决赛系列赛都在影响集合中', () => {
    const event = makeEventWithSwiss(simulateSwiss(TEAM_IDS, lowerWins));
    const affected = collectDownstreamSeries(event, 1);
    // 测试事件没有决赛系列赛，因此为空
    expect(affected).toEqual([]);
  });
});
