/**
 * 测试用的固定合成赛程。
 *
 * 重要：这里的一切都是**测试数据**，绝不进入 data/event.json 或公开产物。
 * 使用固定输入保证可重复；关键种子、配对与获奖队伍都有独立预期。
 */
import type {
  EventFile,
  QualificationRanking,
  ResultAttempt,
  ResultKind,
  SwissMatch,
  SwissRound,
  Team,
  Venue,
} from '../../src/domain/schema';

export const TEST_TEAM_COUNT = 16;

/** 生成 16 支竞技组测试队伍（编号 1..16，三审排名 1..16）。 */
export function makeTeams(count = TEST_TEAM_COUNT): Team[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `competitive-${i + 1}`,
    division: 'competitive' as const,
    number: i + 1,
    name: `测试队伍${i + 1}号`,
    nameVerified: true,
    nameNote: null,
    thirdReviewRank: i + 1,
  }));
}

export const TEST_VENUES: Venue[] = [
  { id: 'venue-a', label: '副场地A', provisionalName: false, note: null },
  { id: 'venue-b', label: '副场地B', provisionalName: false, note: null },
];

/** 队伍 ID 简写：t1..t16。 */
export function t(n: number): string {
  return `competitive-${n}`;
}

/** 构造一个已确认的瑞士轮 attempt。 */
export function makeAttempt(
  id: string,
  homeTeamId: string,
  awayTeamId: string,
  winnerId: string,
  opts: {
    homeScore?: string | null;
    awayScore?: string | null;
    homeSeconds?: string | null;
    awaySeconds?: string | null;
    kind?: ResultKind;
    status?: 'none' | 'provisional' | 'confirmed';
    supersedesId?: string | null;
  } = {},
): ResultAttempt {
  const kind = opts.kind ?? 'normal';
  const status = opts.status ?? 'confirmed';
  return {
    id,
    supersedesId: opts.supersedesId ?? null,
    homeTeamId,
    awayTeamId,
    homeScore: opts.homeScore !== undefined ? opts.homeScore : '10',
    awayScore: opts.awayScore !== undefined ? opts.awayScore : '5',
    homeReachedSeconds: opts.homeSeconds !== undefined ? opts.homeSeconds : '100',
    awayReachedSeconds: opts.awaySeconds !== undefined ? opts.awaySeconds : '100',
    winnerId,
    resultKind: kind,
    resultStatus: status,
    confirmedAt: status === 'confirmed' ? '2026-10-03T20:00:00+08:00' : null,
    note: null,
  };
}

/** 构造一场比赛。 */
export function makeMatch(
  roundIndex: number,
  groupRecord: string,
  orderInGroup: number,
  homeTeamId: string,
  awayTeamId: string,
  attempts: ResultAttempt[] = [],
  effectiveAttemptId: string | null = null,
): SwissMatch {
  const id = `m-${roundIndex}-${groupRecord.replace('-', '')}-${orderInGroup}`;
  return {
    id,
    roundId: `swiss-round-${roundIndex}`,
    roundIndex,
    groupRecord,
    orderInGroup,
    slots: [
      { kind: 'team', teamId: homeTeamId },
      { kind: 'team', teamId: awayTeamId },
    ],
    participantSnapshot: [homeTeamId, awayTeamId],
    attempts,
    effectiveAttemptId,
    executionStatus: attempts.some((a) => a.resultStatus === 'confirmed') ? 'finished' : 'scheduled',
    scheduleItemId: `sched-${id}`,
    note: null,
  };
}

export function makeRound(index: number, matches: SwissMatch[], published = true): SwissRound {
  return {
    id: `swiss-round-${index}`,
    index,
    matchIds: matches.map((m) => m.id),
    pairingVersion: 1,
    basedOnRound: index - 1,
    basedOnRevision: null,
    publicationStatus: published ? 'published' : 'draft',
    publishedAt: published ? '2026-10-03T20:00:00+08:00' : null,
    closedAt: null,
    rankingSnapshot: null,
    revisionNote: null,
  };
}

/**
 * 完整的 5 轮瑞士轮结果（合成）。
 *
 * 设计：让 t1..t4 各自取得 3-0 / 3-1 等分布，最终战绩组人数为 2/3/3/3/3/2。
 * 这是固定的确定性输入，不是随机生成。
 *
 * 结果约定（每队 5 轮内达到 3 胜或 3 负即停止）：
 * - R1: 1v9, 2v10, ... 8v16（手册：按排位分为前后两半对位）
 * - 之后按战绩组配对，组内首尾（第 1 名对末名）
 */
export interface FullSwissScenario {
  matches: SwissMatch[];
  rounds: SwissRound[];
  /** 每队最终战绩的期望值。 */
  expectedRecords: Map<string, { wins: number; losses: number }>;
}

/**
 * 用确定性规则推进 5 轮：给定“谁赢”的判据函数，生成全部比赛。
 * winner 决定函数以 (roundIndex, homeId, awayId) 为输入，返回胜者 ID。
 */
export function simulateSwiss(
  teamIds: readonly string[],
  decideWinner: (roundIndex: number, homeId: string, awayId: string) => string,
  qualificationOrder: readonly string[] = teamIds,
): FullSwissScenario {
  const matches: SwissMatch[] = [];
  const rounds: SwissRound[] = [];
  const records = new Map<string, { wins: number; losses: number }>();
  for (const id of teamIds) records.set(id, { wins: 0, losses: 0 });

  const GROUP_ORDER: Record<number, string[]> = {
    2: ['1-0', '0-1'],
    3: ['2-0', '1-1', '0-2'],
    4: ['2-1', '1-2'],
    5: ['2-2'],
  };

  for (let roundIndex = 1; roundIndex <= 5; roundIndex += 1) {
    const roundMatches: SwissMatch[] = [];

    if (roundIndex === 1) {
      const half = Math.floor(qualificationOrder.length / 2);
      for (let i = 0; i < half; i += 1) {
        const home = qualificationOrder[i];
        const away = qualificationOrder[i + half];
        if (!home || !away) continue;
        const winner = decideWinner(roundIndex, home, away);
        const attemptId = `a-r1-${i + 1}`;
        roundMatches.push(
          makeMatch(roundIndex, '0-0', i + 1, home, away, [makeAttempt(attemptId, home, away, winner)], attemptId),
        );
      }
    } else {
      const groupOrder = GROUP_ORDER[roundIndex] ?? [];
      for (const record of groupOrder) {
        const inGroup = teamIds
          .filter((id) => {
            const r = records.get(id);
            if (!r) return false;
            if (r.wins >= 3 || r.losses >= 3) return false;
            return `${r.wins}-${r.losses}` === record;
          })
          .sort((a, b) => qualificationOrder.indexOf(a) - qualificationOrder.indexOf(b));
        const half = Math.floor(inGroup.length / 2);
        for (let pair = 0; pair < half; pair += 1) {
          const home = inGroup[pair];
          const away = inGroup[inGroup.length - 1 - pair];
          if (!home || !away) continue;
          const order = pair + 1;
          const winner = decideWinner(roundIndex, home, away);
          const attemptId = `a-r${roundIndex}-${record.replace('-', '')}-${order}`;
          roundMatches.push(
            makeMatch(roundIndex, record, order, home, away, [makeAttempt(attemptId, home, away, winner)], attemptId),
          );
        }
      }
    }

    for (const m of roundMatches) {
      const w = m.attempts[0]?.winnerId;
      if (!w) continue;
      const loser = w === m.participantSnapshot?.[0] ? m.participantSnapshot?.[1] : m.participantSnapshot?.[0];
      const wr = records.get(w);
      if (wr) wr.wins += 1;
      if (loser) {
        const lr = records.get(loser);
        if (lr) lr.losses += 1;
      }
    }

    matches.push(...roundMatches);
    rounds.push(makeRound(roundIndex, roundMatches));
  }

  return { matches, rounds, expectedRecords: records };
}

/** 由队伍 ID 列表构造一个"已确认"的排位赛排名对象。 */
export function rankingFixtureFrom(orderedTeamIds: readonly string[]): QualificationRanking {
  return {
    orderedTeamIds: [...orderedTeamIds],
    bestResultLabels: null,
    status: 'confirmed',
    confirmedAt: '2026-10-03T15:30:00+08:00',
    sourceNote: '测试数据',
    publicationStatus: 'published',
    publishedAt: '2026-10-03T15:30:00+08:00',
    missingTeamIds: null,
    partialTeamIds: null,
    tiedTeamIds: null,
    reviewNote: null,
    overrideReason: null,
  };
}

/** 最小可用的完整事件（用于校验器与 UI 的空数据场景）。 */
export function makeEmptyEvent(teams: Team[] = makeTeams()): EventFile {
  return {
    schemaVersion: 1,
    event: {
      id: 'robogame-2026',
      name: 'RoboGame2026 赛事',
      timezone: 'Asia/Shanghai',
      dates: ['2026-10-03', '2026-10-04'],
      sourceDocumentSha256: '89c9fb3fd29f13c4daaacba8bd921744df7f5da264b86c3683cc8ca7484e7bf2',
      officialScheduleUrl: null,
      scheduleNotice: '时间仅供参考。',
      contentUpdatedAt: '2026-09-30T00:00:00Z',
      openItems: [],
    },
    rules: {
      version: 'test',
      qualificationRankingMode: 'official-manual',
      swissPairingPolicy: 'same-record-adjacent',
    },
    teams,
    venues: TEST_VENUES,
    scheduleItems: [],
    qualification: {
      runs: [],
      ranking: {
        orderedTeamIds: [],
        bestResultLabels: null,
        status: 'none',
        confirmedAt: null,
        sourceNote: null,
        publicationStatus: 'draft',
        publishedAt: null,
        missingTeamIds: null,
        partialTeamIds: null,
        tiedTeamIds: null,
        reviewNote: null,
        overrideReason: null,
      },
    },
    swiss: { rounds: [], matches: [] },
    finals: { seeding: null, series: [] },
    showcase: { drawOrder: null, confirmedAt: null, note: null },
    notices: [],
    corrections: [],
  };
}
