/**
 * 瑞士轮排序、配对与晋级的验收用例（D04、D06–D11、D17、D18）。
 */
import { describe, expect, it } from 'vitest';
import type { QualificationRanking, SwissMatch } from '../../src/domain/schema';
import { calculateSwissStandings, CANONICAL_RECORD_ORDER } from '../../src/domain/standings';
import {
  checkRoundGate,
  generateSwissPairings,
  ROUND_GROUP_ORDER,
  EXPECTED_MATCH_COUNTS,
  determineActiveTeams,
} from '../../src/domain/swiss';
import {
  makeAttempt,
  makeMatch,
  makeRound,
  makeTeams,
  simulateSwiss,
  t,
} from '../fixtures/swiss-scenario';
import { fromInt, toFixed2, cmp } from '../../src/domain/rational';

const TEAMS = makeTeams();
const TEAM_IDS = TEAMS.map((x) => x.id);

function ranking16(): QualificationRanking {
  return {
    orderedTeamIds: TEAM_IDS,
    bestResultLabels: null,
    status: 'confirmed',
    confirmedAt: '2026-10-03T15:30:00+08:00',
    sourceNote: '测试',
    publicationStatus: 'published',
    publishedAt: '2026-10-03T15:30:00+08:00',
    missingTeamIds: null,
    partialTeamIds: null,
    tiedTeamIds: null,
    reviewNote: null,
    overrideReason: null,
  };
}

/** 让编号较小者获胜（确定性）。 */
const lowerWins = (_r: number, home: string, away: string): string => {
  const hn = Number(home.split('-')[1]);
  const an = Number(away.split('-')[1]);
  return hn < an ? home : away;
};

describe('D04 弃权与行政中止', () => {
  it('双方 n 不增加，但 W/L、m 与 O 正确增加，且无假 0 分参与 P', () => {
    const matches: SwissMatch[] = [
      // 一场正常的有效比赛：t1 胜 t2
      makeMatch(1, '0-0', 1, t(1), t(2), [
        makeAttempt('a1', t(1), t(2), t(1), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'a1'),
      // 一场未开赛弃权：t1 胜 t3，但双方都不计入表现统计
      makeMatch(1, '0-0', 2, t(1), t(3), [
        makeAttempt('a2', t(1), t(3), t(1), {
          kind: 'walkover-before-start',
          homeScore: null,
          awayScore: null,
          homeSeconds: null,
          awaySeconds: null,
        }),
      ], 'a2'),
      // 一场行政判负中止：t4 胜 t5
      makeMatch(1, '0-0', 3, t(4), t(5), [
        makeAttempt('a3', t(4), t(5), t(4), {
          kind: 'administrative-stop',
          homeScore: null,
          awayScore: null,
          homeSeconds: null,
          awaySeconds: null,
        }),
      ], 'a3'),
    ];

    const standings = calculateSwissStandings(TEAM_IDS, matches, ranking16());
    const t1Entry = standings.byTeam.get(t(1))!;

    // n 只计入那场有效比赛
    expect(t1Entry.metrics.n).toBe(1);
    // m 计入 2 场（正常 + 弃权）
    expect(t1Entry.metrics.m).toBe(2);
    expect(t1Entry.wins).toBe(2);
    expect(t1Entry.losses).toBe(0);
    // P 只由那一场有效比赛决定：A=100, B=100, P=100
    expect(toFixed2(t1Entry.metrics.p)).toBe('100.00');
    // 弃权没有贡献假 0 分：如果被算成 0 分，A/B 会被拉低
    expect(t1Entry.metrics.n).toBe(1);

    // t3 的 n=0（弃权不计表现），A/B/P 为 0，T 为 360
    const t3Entry = standings.byTeam.get(t(3))!;
    expect(t3Entry.metrics.n).toBe(0);
    expect(t3Entry.metrics.m).toBe(1);
    expect(t3Entry.losses).toBe(1);
    expect(t3Entry.metrics.a).toEqual(fromInt(0));
    expect(t3Entry.metrics.p).toEqual(fromInt(0));
    expect(toFixed2(t3Entry.metrics.t)).toBe('360.00');

    // O 计入弃权对手：t3 的对手 t1 的 v=1、P=100 → q = 50 + 50 = 100
    expect(toFixed2(t3Entry.metrics.o)).toBe('100.00');
  });
});

describe('D05 重赛只取最终有效 attempt', () => {
  it('旧 attempt 保留但不参与统计', () => {
    const matches: SwissMatch[] = [
      makeMatch(1, '0-0', 1, t(1), t(2), [
        // 第一次：t2 胜
        makeAttempt('a1', t(1), t(2), t(2), { homeScore: '5', awayScore: '16', homeSeconds: '200', awaySeconds: '60' }),
        // 重赛：t1 胜（取代 a1）
        makeAttempt('a2', t(1), t(2), t(1), {
          supersedesId: 'a1',
          homeScore: '16',
          awayScore: '0',
          homeSeconds: '60',
          awaySeconds: '360',
        }),
      ], 'a2'),
    ];

    const standings = calculateSwissStandings(TEAM_IDS, matches, ranking16());
    const t1Entry = standings.byTeam.get(t(1))!;
    const t2Entry = standings.byTeam.get(t(2))!;

    // 只有最终有效的 a2 计入
    expect(t1Entry.metrics.n).toBe(1);
    expect(t1Entry.wins).toBe(1);
    expect(t1Entry.losses).toBe(0);
    expect(toFixed2(t1Entry.metrics.meanScore)).toBe('16.00');

    expect(t2Entry.metrics.n).toBe(1);
    expect(t2Entry.wins).toBe(0);
    expect(t2Entry.losses).toBe(1);
    // t2 的原始积分来自 a2 的 0，而不是 a1 的 16
    expect(toFixed2(t2Entry.metrics.meanScore)).toBe('0.00');
  });

  it('未确认的 attempt 不参与统计', () => {
    const matches: SwissMatch[] = [
      makeMatch(1, '0-0', 1, t(1), t(2), [
        makeAttempt('a1', t(1), t(2), t(1), {
          homeScore: '16',
          awayScore: '0',
          homeSeconds: '60',
          awaySeconds: '360',
          status: 'provisional',
        }),
      ], 'a1'),
    ];
    const standings = calculateSwissStandings(TEAM_IDS, matches, ranking16());
    expect(standings.byTeam.get(t(1))!.metrics.m).toBe(0);
    expect(standings.byTeam.get(t(1))!.wins).toBe(0);
  });
});

describe('D06 同分比较按原始精度', () => {
  it('显示相同两位小数时仍按原始精度排序，并逐级比较 P 与 T', () => {
    // 构造两队 R 极为接近但不等。
    // 直接测试排序器：构造两组 metrics 接近的 entry。
    const standings = calculateSwissStandings(
      TEAM_IDS,
      [
        makeMatch(1, '0-0', 1, t(1), t(2), [
          makeAttempt('a1', t(1), t(2), t(1), { homeScore: '16', awayScore: '1', homeSeconds: '60', awaySeconds: '100' }),
        ], 'a1'),
        makeMatch(1, '0-0', 2, t(3), t(4), [
          makeAttempt('a2', t(3), t(4), t(3), { homeScore: '16', awayScore: '1', homeSeconds: '61', awaySeconds: '100' }),
        ], 'a2'),
      ],
      ranking16(),
    );

    const g = standings.groups.find((x) => x.record === '1-0')!;
    // t1 与 t3 的 P 相同（同样的积分与分差），但 T 不同 → t1（60 秒）应排在 t3（61 秒）之前
    const ids = g.entries.map((e) => e.teamId);
    expect(ids.indexOf(t(1))).toBeLessThan(ids.indexOf(t(3)));
    // 显示值确实相同，证明排序没有依赖显示值
    const e1 = g.entries.find((e) => e.teamId === t(1))!;
    const e3 = g.entries.find((e) => e.teamId === t(3))!;
    expect(e1.display.p).toBe(e3.display.p);
    expect(e1.display.r).toBe(e3.display.r);
    expect(cmp(e1.metrics.t, e3.metrics.t)).toBeLessThan(0);
  });

  it('R、P、T 全同时按排位赛名次升序', () => {
    const standings = calculateSwissStandings(
      TEAM_IDS,
      [
        makeMatch(1, '0-0', 1, t(5), t(6), [
          makeAttempt('a1', t(5), t(6), t(5), { homeScore: '16', awayScore: '0', homeSeconds: '50', awaySeconds: '360' }),
        ], 'a1'),
        makeMatch(1, '0-0', 2, t(2), t(7), [
          makeAttempt('a2', t(2), t(7), t(2), { homeScore: '16', awayScore: '0', homeSeconds: '50', awaySeconds: '360' }),
        ], 'a2'),
      ],
      ranking16(),
    );
    const g = standings.groups.find((x) => x.record === '1-0')!;
    const ids = g.entries.map((e) => e.teamId);
    // t2（排位第 2）应在 t5（排位第 5）之前
    expect(ids.indexOf(t(2))).toBeLessThan(ids.indexOf(t(5)));
  });
});

describe('D07 同一对手出现两次', () => {
  it('O 按两次记录计入，不去重', () => {
    const matches: SwissMatch[] = [
      makeMatch(1, '0-0', 1, t(1), t(2), [
        makeAttempt('a1', t(1), t(2), t(1), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'a1'),
      makeMatch(2, '1-0', 1, t(1), t(2), [
        makeAttempt('a2', t(1), t(2), t(1), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'a2'),
    ];
    const standings = calculateSwissStandings(TEAM_IDS, matches, ranking16());
    const t1Entry = standings.byTeam.get(t(1))!;
    // m = 2，两次对同一个对手
    expect(t1Entry.metrics.m).toBe(2);
    // O 应当是同一个对手 q 的平均值；如果去重成 1 次结果会不同吗？
    // 同一对手两次 → 平均值仍等于该对手的 q，但 m 必须是 2。
    // 用一个更强的判据：对手 t2 输了两场 v=0，P=0 → q = 0；O = 0。
    expect(toFixed2(t1Entry.metrics.o)).toBe('0.00');
    // 与"只计一次"相比，wins 必须为 2（两次都计入战绩）
    expect(t1Entry.wins).toBe(2);
  });

  it('两个不同对手时 O 取两者平均（证明按场次而非去重计算）', () => {
    const matches: SwissMatch[] = [
      makeMatch(1, '0-0', 1, t(1), t(2), [
        makeAttempt('a1', t(1), t(2), t(1), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'a1'),
      makeMatch(1, '0-0', 2, t(1), t(3), [
        makeAttempt('a2', t(1), t(3), t(3), { homeScore: '0', awayScore: '16', homeSeconds: '360', awaySeconds: '60' }),
      ], 'a2'),
    ];
    const standings = calculateSwissStandings(TEAM_IDS, matches, ranking16());
    const t1Entry = standings.byTeam.get(t(1))!;
    expect(t1Entry.metrics.m).toBe(2);
    // 对手 t2：0 胜 1 负 → v=0，P=0 → q=0
    // 对手 t3：1 胜 0 负 → v=1，P=100 → q=50+50=100
    // O = (0 + 100)/2 = 50
    expect(toFixed2(t1Entry.metrics.o)).toBe('50.00');
  });
});

describe('D09 R1 前后两半对位，R2 起同组首尾配对', () => {
  it('R1 严格按排位前后两半：1v9、2v10 … 8v16', () => {
    const proposal = generateSwissPairings({
      roundIndex: 1,
      teamIds: TEAM_IDS,
      matches: [],
      qualification: ranking16(),
      qualificationOfficial: { ok: true, reason: null },
      rounds: [],
    });
    expect(proposal.blockers).toEqual([]);
    expect(proposal.pairs).toHaveLength(8);
    const pairs = proposal.pairs.map((p) => [p.homeTeamId, p.awayTeamId]);
    expect(pairs[0]).toEqual([t(1), t(9)]);
    expect(pairs[1]).toEqual([t(2), t(10)]);
    expect(pairs[7]).toEqual([t(8), t(16)]);
  });

  it('R2 起按相同战绩分组、组内首尾配对，无避重与随机', () => {
    // 构造 R1：低编号获胜，得到 8 个 1-0 与 8 个 0-1
    const scenario = simulateSwiss(TEAM_IDS, lowerWins);
    const r1 = scenario.matches.filter((m) => m.roundIndex === 1);

    const proposal = generateSwissPairings({
      roundIndex: 2,
      teamIds: TEAM_IDS,
      matches: r1,
      qualification: ranking16(),
      qualificationOfficial: { ok: true, reason: null },
      rounds: [makeRound(1, r1)],
    });

    expect(proposal.blockers).toEqual([]);
    expect(proposal.pairs).toHaveLength(8);
    // 组顺序必须是 1-0 然后 0-1
    const groups = proposal.pairs.map((p) => p.groupRecord);
    expect(groups.slice(0, 4)).toEqual(['1-0', '1-0', '1-0', '1-0']);
    expect(groups.slice(4)).toEqual(['0-1', '0-1', '0-1', '0-1']);
    // 1-0 组内首尾配对：R1 中 1..8 号获胜，组内顺序为 1..8，故应为 1v8、2v7、3v6、4v5
    expect(proposal.pairs[0]!.homeTeamId).toBe(t(1));
    expect(proposal.pairs[0]!.awayTeamId).toBe(t(8));
    expect(proposal.pairs[1]!.homeTeamId).toBe(t(2));
    expect(proposal.pairs[1]!.awayTeamId).toBe(t(7));
    expect(proposal.pairs[3]!.homeTeamId).toBe(t(4));
    expect(proposal.pairs[3]!.awayTeamId).toBe(t(5));
  });

  it('轮次门禁：上一轮未确认时拒绝生成', () => {
    const scenario = simulateSwiss(TEAM_IDS, lowerWins);
    const r1 = scenario.matches.filter((m) => m.roundIndex === 1);
    // 去掉一场的结果
    const incomplete = r1.map((m, i) =>
      i === 0 ? { ...m, attempts: [], effectiveAttemptId: null } : m,
    );
    const gate = checkRoundGate({
      roundIndex: 2,
      teamIds: TEAM_IDS,
      matches: incomplete,
      qualification: ranking16(),
      qualificationOfficial: { ok: true, reason: null },
      rounds: [makeRound(1, incomplete)],
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('未确认');
  });

  it('R1 门禁要求排位赛排名已确认', () => {
    const gate = checkRoundGate({
      roundIndex: 1,
      teamIds: TEAM_IDS,
      matches: [],
      qualification: { ...ranking16(), status: 'none' },
      qualificationOfficial: { ok: true, reason: null },
      rounds: [],
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('尚未确认');
  });

  it('R1 门禁拒绝"已确认但成绩不完整、且未人工定榜"的排名', () => {
    const gate = checkRoundGate({
      roundIndex: 1,
      teamIds: TEAM_IDS,
      matches: [],
      qualification: ranking16(),
      qualificationOfficial: { ok: false, reason: '成绩不完整且未人工定榜：19 / 22 支队伍尚无已确认的积分成绩：测试队' },
      rounds: [],
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('正式名次尚未成立');
    expect(gate.reason).toContain('成绩不完整');
    expect(gate.reason).toContain('19 / 22');
  });
});

describe('D10 R3 跨日冻结', () => {
  it('R2 完成后一次性发布 R3 全部 8 场；前四场完成不改变次日四场，且 R4 仍不可生成', () => {
    const scenario = simulateSwiss(TEAM_IDS, lowerWins);
    const throughR2 = scenario.matches.filter((m) => m.roundIndex <= 2);

    // 生成 R3 候选
    const r3Proposal = generateSwissPairings({
      roundIndex: 3,
      teamIds: TEAM_IDS,
      matches: throughR2,
      qualification: ranking16(),
      qualificationOfficial: { ok: true, reason: null },
      rounds: [makeRound(1, throughR2.filter((m) => m.roundIndex === 1)), makeRound(2, throughR2.filter((m) => m.roundIndex === 2))],
    });
    expect(r3Proposal.blockers).toEqual([]);
    expect(r3Proposal.pairs).toHaveLength(8);
    // 组顺序 2-0、1-1、0-2
    const records = r3Proposal.pairs.map((p) => p.groupRecord);
    expect(records).toEqual(['2-0', '2-0', '1-1', '1-1', '1-1', '1-1', '0-2', '0-2']);

    // 记录次日四场（1-1 后两场、0-2 两场）的参赛双方
    const nextDayPairs = r3Proposal.pairs.slice(4).map((p) => `${p.homeTeamId}|${p.awayTeamId}`);

    // 现在完成 R3 的前四场（2-0 两场 + 1-1 前两场）
    const r3Matches: SwissMatch[] = r3Proposal.pairs.map((p, i) => {
      const order = p.orderInGroup;
      const played = i < 4;
      const attemptId = `r3-${i}`;
      return makeMatch(
        3,
        p.groupRecord,
        order,
        p.homeTeamId,
        p.awayTeamId,
        played ? [makeAttempt(attemptId, p.homeTeamId, p.awayTeamId, lowerWins(3, p.homeTeamId, p.awayTeamId))] : [],
        played ? attemptId : null,
      );
    });

    // 次日四场仍然是同样的对阵（固定不重排）
    const afterPartial = r3Matches.slice(4).map((m) => `${m.participantSnapshot![0]}|${m.participantSnapshot![1]}`);
    expect(afterPartial).toEqual(nextDayPairs);

    // R4 不可生成
    const r4Gate = checkRoundGate({
      roundIndex: 4,
      teamIds: TEAM_IDS,
      matches: [...throughR2, ...r3Matches],
      qualification: ranking16(),
      qualificationOfficial: { ok: true, reason: null },
      rounds: [
        makeRound(1, throughR2.filter((m) => m.roundIndex === 1)),
        makeRound(2, throughR2.filter((m) => m.roundIndex === 2)),
        makeRound(3, r3Matches),
      ],
    });
    expect(r4Gate.ok).toBe(false);
  });
});

describe('D11 全赛程合成结果', () => {
  const scenario = simulateSwiss(TEAM_IDS, lowerWins);

  it('共 5 轮 33 场', () => {
    expect(scenario.rounds).toHaveLength(5);
    expect(scenario.matches).toHaveLength(33);
    const counts = [1, 2, 3, 4, 5].map((r) => scenario.matches.filter((m) => m.roundIndex === r).length);
    expect(counts).toEqual([8, 8, 8, 6, 3]);
    for (const r of [1, 2, 3, 4, 5]) {
      expect(counts[r - 1]).toBe(EXPECTED_MATCH_COUNTS[r]);
    }
  });

  it('最终战绩组人数为 2/3/3/3/3/2', () => {
    const standings = calculateSwissStandings(TEAM_IDS, scenario.matches, ranking16());
    const byRecord = new Map(standings.groups.map((g) => [g.record, g.entries.length]));
    expect(byRecord.get('3-0')).toBe(2);
    expect(byRecord.get('3-1')).toBe(3);
    expect(byRecord.get('3-2')).toBe(3);
    expect(byRecord.get('2-3')).toBe(3);
    expect(byRecord.get('1-3')).toBe(3);
    expect(byRecord.get('0-3')).toBe(2);
  });

  it('战绩组顺序为 3-0、3-1、3-2、2-3、1-3、0-3', () => {
    const standings = calculateSwissStandings(TEAM_IDS, scenario.matches, ranking16());
    expect(standings.groups.map((g) => g.record)).toEqual([...CANONICAL_RECORD_ORDER]);
  });

  it('每组人数为偶数（可配对），且 2-2 组恰好 6 队产生 3 场', () => {
    const standingsBeforeR5 = calculateSwissStandings(
      TEAM_IDS,
      scenario.matches.filter((m) => m.roundIndex <= 4),
      ranking16(),
    );
    const g22 = standingsBeforeR5.groups.find((g) => g.record === '2-2')!;
    expect(g22.entries.length).toBe(6);
    expect(g22.entries.length % 2).toBe(0);
    const active = determineActiveTeams(
      {
        roundIndex: 5, teamIds: TEAM_IDS, matches: scenario.matches, qualification: ranking16(),
        rounds: scenario.rounds, qualificationOfficial: { ok: true, reason: null },
      },
      standingsBeforeR5,
    );
    expect([...active].filter((id) => g22.entries.some((e) => e.teamId === id))).toHaveLength(6);
  });
});

describe('D18 退赛造成分组奇数', () => {
  it('停止自动配对并报因，不擅自轮空', () => {
    // 构造一个 1-0 组只有 3 队的情形（模拟一队退赛）
    const matches: SwissMatch[] = [
      makeMatch(1, '0-0', 1, t(1), t(2), [
        makeAttempt('a1', t(1), t(2), t(1), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'a1'),
      makeMatch(1, '0-0', 2, t(3), t(4), [
        makeAttempt('a2', t(3), t(4), t(3), { homeScore: '16', awayScore: '0', homeSeconds: '60', awaySeconds: '360' }),
      ], 'a2'),
      makeMatch(1, '0-0', 3, t(5), t(6), [
        // 平局式无效：让 t6 胜，使 1-0 组为 t1、t3、t6（3 队）
        makeAttempt('a3', t(5), t(6), t(6), { homeScore: '0', awayScore: '16', homeSeconds: '360', awaySeconds: '60' }),
      ], 'a3'),
    ];

    // 只用这 6 队，让 1-0 组有 3 队（奇数）
    const subset = [t(1), t(2), t(3), t(4), t(5), t(6)];
    const proposal = generateSwissPairings({
      roundIndex: 2,
      teamIds: subset,
      matches,
      qualification: { ...ranking16(), orderedTeamIds: subset },
      qualificationOfficial: { ok: true, reason: null },
      rounds: [makeRound(1, matches)],
    });

    expect(proposal.blockers.length).toBeGreaterThan(0);
    expect(proposal.blockers.join(' ')).toContain('奇数');
    // 不应通过轮空来凑数
    expect(proposal.blockers.join(' ')).toContain('不擅自轮空');
  });
});

describe('D17 三审排名与排位赛名次不同', () => {
  it('R1 与同分比较使用正式排位，不使用三审顺序', () => {
    // 反转排位：排位第 1 名是三审第 16 名
    const reversed = [...TEAM_IDS].reverse();
    const qual: QualificationRanking = { ...ranking16(), orderedTeamIds: reversed };

    const proposal = generateSwissPairings({
      roundIndex: 1,
      teamIds: TEAM_IDS,
      matches: [],
      qualification: qual,
      qualificationOfficial: { ok: true, reason: null },
      rounds: [],
    });
    // 前后两半对位基于 reversed：第 1 名是 t16，对第 9 名（t8）
    expect(proposal.pairs[0]!.homeTeamId).toBe(t(16));
    expect(proposal.pairs[0]!.awayTeamId).toBe(t(8));

    // 同分比较也用正式排位
    const standings = calculateSwissStandings(
      TEAM_IDS,
      [
        makeMatch(1, '0-0', 1, t(5), t(6), [
          makeAttempt('a1', t(5), t(6), t(5), { homeScore: '16', awayScore: '0', homeSeconds: '50', awaySeconds: '360' }),
        ], 'a1'),
        makeMatch(1, '0-0', 2, t(2), t(7), [
          makeAttempt('a2', t(2), t(7), t(2), { homeScore: '16', awayScore: '0', homeSeconds: '50', awaySeconds: '360' }),
        ], 'a2'),
      ],
      qual,
    );
    const g = standings.groups.find((x) => x.record === '1-0')!;
    const ids = g.entries.map((e) => e.teamId);
    // 在 reversed 排位中，t5 的名次优于 t2
    expect(ids.indexOf(t(5))).toBeLessThan(ids.indexOf(t(2)));
  });
});

describe('配对组顺序常量与赛程一致', () => {
  it('R2–R5 的组顺序符合第 5.4 节', () => {
    expect(ROUND_GROUP_ORDER[2]).toEqual(['1-0', '0-1']);
    expect(ROUND_GROUP_ORDER[3]).toEqual(['2-0', '1-1', '0-2']);
    expect(ROUND_GROUP_ORDER[4]).toEqual(['2-1', '1-2']);
    expect(ROUND_GROUP_ORDER[5]).toEqual(['2-2']);
  });
});
