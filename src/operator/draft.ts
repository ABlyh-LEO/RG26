/**
 * 维护工具的草稿操作（纯函数，便于测试）。
 *
 * 所有操作先作用于本地草稿；正式站点的数据只能来自通过校验并发布的快照。
 * 每个操作返回新的事件对象，不修改输入。
 */
import type {
  EventFile,
  ResultKind,
  Series,
  SwissMatch,
} from '../domain/schema';
import { calculateSwissStandings } from '../domain/standings';
import { generateSwissPairings, proposalToMatchSkeletons, ROUND_GROUP_ORDER } from '../domain/swiss';
import { validateEvent } from '../domain/validation';
import { qualifiedTeamIds } from '../data/view-model';
import { ONE_HALF, mul, THREE_FIFTHS } from '../domain/rational';

/* ------------------------------------------------------------------ *
 * 单场录入（BO1 瑞士轮）
 * ------------------------------------------------------------------ */

export interface Bo1Entry {
  matchId: string;
  homeScore: string;
  awayScore: string;
  homeSeconds: string;
  awaySeconds: string;
  winnerId: string | null;
  resultKind: ResultKind;
  note: string | null;
}

export interface ApplyResult {
  event: EventFile;
  ok: boolean;
  messages: string[];
}

/**
 * 把一次 BO1 录入写入比赛。
 *
 * 若比赛中已有结果，新结果作为一次新的 attempt 追加，
 * 并把旧的 effectiveAttemptId 记为 supersedesId（保留历史，不删除）。
 */
export function applyBo1Entry(event: EventFile, entry: Bo1Entry): ApplyResult {
  const match = event.swiss.matches.find((m) => m.id === entry.matchId);
  if (!match) return { event, ok: false, messages: [`找不到比赛 ${entry.matchId}`] };

  const participants = match.participantSnapshot;
  if (!participants) {
    return { event, ok: false, messages: ['该比赛尚未确定参赛队伍，无法录入结果'] };
  }
  const [homeId, awayId] = participants;

  if (entry.winnerId === null) {
    return { event, ok: false, messages: ['必须指定胜者：瑞士轮不允许平局，胜者由裁判确认'] };
  }
  if (entry.winnerId !== homeId && entry.winnerId !== awayId) {
    return { event, ok: false, messages: ['胜者必须是参赛双方之一'] };
  }

  const performanceKinds: ResultKind[] = ['normal', 'early-end'];
  const needsScores = performanceKinds.includes(entry.resultKind);
  if (needsScores) {
    if (entry.homeScore.trim() === '' || entry.awayScore.trim() === '') {
      return { event, ok: false, messages: ['有效比赛必须填写双方积分（缺分不等于 0，不能用假 0 分填补）'] };
    }
    const homeZero = Number(entry.homeScore) === 0;
    const awayZero = Number(entry.awayScore) === 0;
    if (!homeZero && entry.homeSeconds.trim() === '') {
      return { event, ok: false, messages: ['本队积分不为 0 时必须填写到达最终积分的时间'] };
    }
    if (!awayZero && entry.awaySeconds.trim() === '') {
      return { event, ok: false, messages: ['对手积分不为 0 时必须填写到达最终积分的时间'] };
    }
  }

  const attemptId = `${entry.matchId}-a${match.attempts.length + 1}`;
  const previousEffective = match.effectiveAttemptId;

  const newAttempt = {
    id: attemptId,
    supersedesId: previousEffective,
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeScore: needsScores ? entry.homeScore.trim() : null,
    awayScore: needsScores ? entry.awayScore.trim() : null,
    homeReachedSeconds: needsScores ? (Number(entry.homeScore) === 0 ? '360' : entry.homeSeconds.trim()) : null,
    awayReachedSeconds: needsScores ? (Number(entry.awayScore) === 0 ? '360' : entry.awaySeconds.trim()) : null,
    winnerId: entry.winnerId,
    resultKind: entry.resultKind,
    resultStatus: 'confirmed' as const,
    confirmedAt: new Date().toISOString(),
    note: entry.note,
  };

  const messages: string[] = [];
  if (previousEffective !== null) {
    messages.push(`本场已有结果，新结果作为重赛记录追加；旧结果 ${previousEffective} 保留但不再计入统计。`);
  }

  return {
    event: {
      ...event,
      swiss: {
        ...event.swiss,
        matches: event.swiss.matches.map((m) =>
          m.id === entry.matchId
            ? {
                ...m,
                attempts: [...m.attempts, newAttempt],
                effectiveAttemptId: attemptId,
                executionStatus: 'finished' as const,
              }
            : m,
        ),
      },
      event: { ...event.event, contentUpdatedAt: new Date().toISOString() },
    },
    ok: true,
    messages,
  };
}

/* ------------------------------------------------------------------ *
 * BO3 逐局录入
 * ------------------------------------------------------------------ */

export interface Bo3GameEntry {
  seriesId: string;
  gameIndex: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: string;
  awayScore: string;
  winnerId: string | null;
  resultKind: ResultKind;
}

/** 录入一局 BO3。已决出胜者后的局不允许再录入（应为“不需要进行”）。 */
export function applyBo3Game(event: EventFile, entry: Bo3GameEntry): ApplyResult {
  const series = event.finals.series.find((s) => s.id === entry.seriesId);
  if (!series) return { event, ok: false, messages: [`找不到系列赛 ${entry.seriesId}`] };

  if (series.format !== 'BO3' && series.format !== 'BO2') {
    return { event, ok: false, messages: [`${series.id} 不是 BO3/BO2 系列赛`] };
  }

  const decided = seriesWins(series);
  if (decided.winnerId !== null) {
    return {
      event,
      ok: false,
      messages: [`该系列赛已由 ${decided.winnerId} 取得 ${decided.need} 胜并结束，后续局标为“不需要进行”，不能录入。`],
    };
  }

  if (entry.winnerId === null) {
    return { event, ok: false, messages: ['必须指定本局胜者'] };
  }
  if (entry.winnerId !== entry.homeTeamId && entry.winnerId !== entry.awayTeamId) {
    return { event, ok: false, messages: ['本局胜者必须是参赛双方之一'] };
  }

  return {
    event: {
      ...event,
      finals: {
        ...event.finals,
        series: event.finals.series.map((s) =>
          s.id === entry.seriesId
            ? {
                ...s,
                participantSnapshot: [entry.homeTeamId, entry.awayTeamId] as [string, string],
                executionStatus: 'running' as const,
                games: s.games.map((g) =>
                  g.index === entry.gameIndex
                    ? {
                        ...g,
                        homeTeamId: entry.homeTeamId,
                        awayTeamId: entry.awayTeamId,
                        homeScore: entry.homeScore.trim() === '' ? null : entry.homeScore.trim(),
                        awayScore: entry.awayScore.trim() === '' ? null : entry.awayScore.trim(),
                        winnerId: entry.winnerId,
                        resultKind: entry.resultKind,
                        resultStatus: 'confirmed' as const,
                        confirmedAt: new Date().toISOString(),
                      }
                    : g,
                ),
              }
            : s,
        ),
      },
      event: { ...event.event, contentUpdatedAt: new Date().toISOString() },
    },
    ok: true,
    messages: [],
  };
}

/** 计算系列赛当前比分与所需胜局数。 */
export function seriesWins(series: Series): { home: number; away: number; need: number; winnerId: string | null } {
  const need = series.format === 'BO1' ? 1 : 2;
  let home = 0;
  let away = 0;
  let winnerId: string | null = null;
  for (const g of [...series.games].sort((a, b) => a.index - b.index)) {
    if (winnerId !== null) break;
    if (g.resultStatus !== 'confirmed' || g.winnerId === null) continue;
    if (g.winnerId === g.homeTeamId) home += 1;
    else if (g.winnerId === g.awayTeamId) away += 1;
    if (home >= need) winnerId = g.homeTeamId;
    else if (away >= need) winnerId = g.awayTeamId;
  }
  return { home, away, need, winnerId };
}

/* ------------------------------------------------------------------ *
 * 排位赛
 * ------------------------------------------------------------------ */

/** 录入裁判确认的排位赛最终排名（1–22）。 */
export function applyQualificationRanking(
  event: EventFile,
  orderedTeamIds: string[],
  sourceNote: string | null,
): ApplyResult {
  const competitive = event.teams.filter((t) => t.division === 'competitive');
  const messages: string[] = [];

  if (orderedTeamIds.length !== competitive.length) {
    return {
      event,
      ok: false,
      messages: [`排名必须包含全部 ${competitive.length} 支竞技组队伍，当前 ${orderedTeamIds.length} 支`],
    };
  }
  const unique = new Set(orderedTeamIds);
  if (unique.size !== orderedTeamIds.length) {
    return { event, ok: false, messages: ['排名中出现重复队伍'] };
  }
  for (const id of orderedTeamIds) {
    if (!competitive.some((t) => t.id === id)) {
      return { event, ok: false, messages: [`${id} 不是竞技组队伍`] };
    }
  }

  const now = new Date().toISOString();
  return {
    event: {
      ...event,
      qualification: {
        ...event.qualification,
        ranking: {
          ...event.qualification.ranking,
          orderedTeamIds,
          status: 'confirmed',
          confirmedAt: now,
          sourceNote,
          publicationStatus: 'published',
          publishedAt: now,
        },
      },
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages,
  };
}

/* ------------------------------------------------------------------ *
 * 生成并公布下一轮对阵
 * ------------------------------------------------------------------ */

export interface PairingOutcome extends ApplyResult {
  proposal: ReturnType<typeof generateSwissPairings> | null;
}

/**
 * 生成下一轮候选（不公布）。
 * 只产出候选，绝不因为一次输入保存就自动对外宣布新的对阵。
 */
export function generateNextRound(event: EventFile, roundIndex: number): PairingOutcome {
  const teamIds = qualifiedTeamIds(event);
  const proposal = generateSwissPairings({
    roundIndex,
    teamIds,
    matches: event.swiss.matches,
    qualification: event.qualification.ranking,
    rounds: event.swiss.rounds,
  });

  return {
    event,
    ok: proposal.blockers.length === 0,
    messages: [...proposal.blockers, ...proposal.warnings],
    proposal,
  };
}

/**
 * 公布候选对阵：写入比赛骨架、冻结评分快照、标记轮次已发布。
 *
 * 这是唯一会改变对外可见对阵的操作，必须由维护者显式触发。
 */
export function publishRound(
  event: EventFile,
  roundIndex: number,
  proposal: ReturnType<typeof generateSwissPairings>,
): ApplyResult {
  if (proposal.blockers.length > 0) {
    return { event, ok: false, messages: ['候选存在阻断问题，不能公布', ...proposal.blockers] };
  }

  const round = event.swiss.rounds.find((r) => r.index === roundIndex);
  if (!round) return { event, ok: false, messages: [`找不到第 ${roundIndex} 轮`] };

  const teamIds = qualifiedTeamIds(event);
  const standings = calculateSwissStandings(teamIds, event.swiss.matches, event.qualification.ranking);

  // 为每场找到对应的时间槽
  const skeletons = proposalToMatchSkeletons(
    proposal,
    round.id,
    (_r, i) => String(round.matchIds[i] ?? `${round.id}-m${i + 1}`),
    (r, groupRecord, orderInGroup) => {
      const existing = event.scheduleItems.find(
        (s) => s.stage === 'swiss' && s.title.includes(`R${r} · ${groupRecord} 组第 ${orderInGroup} 场`),
      );
      return existing?.id ?? `sched-swiss-r${r}-${groupRecord.replace('-', '')}-${orderInGroup}`;
    },
  );

  const now = new Date().toISOString();

  // 评分快照：把"已用于正式配对的排名"与"当前参考排名"分开保存。
  const snapshot = proposal.pairs.map((p, index) => {
    const entry = standings.byTeam.get(p.homeTeamId);
    const seed = (v: { n: bigint; d: bigint }) => ({ n: v.n.toString(), d: v.d.toString() });
    return {
      teamId: p.homeTeamId,
      record: entry?.record ?? '0-0',
      wins: entry?.wins ?? 0,
      losses: entry?.losses ?? 0,
      r: entry ? seed(entry.metrics.r) : seed(mul(THREE_FIFTHS, ONE_HALF)),
      p: entry ? seed(entry.metrics.p) : seed(ONE_HALF),
      t: entry ? seed(entry.metrics.t) : seed(mul(THREE_FIFTHS, ONE_HALF)),
      rankWithinGroup: entry?.rankWithinGroup ?? index + 1,
    };
  });

  const newMatches: SwissMatch[] = skeletons.map((s) => ({
    ...s,
    attempts: [],
    effectiveAttemptId: null,
  }));

  // 用新比赛替换旧的空槽（同 id 直接覆盖）
  const byId = new Map(event.swiss.matches.map((m) => [m.id, m]));
  for (const m of newMatches) byId.set(m.id, m);

  return {
    event: {
      ...event,
      swiss: {
        rounds: event.swiss.rounds.map((r) =>
          r.index === roundIndex
            ? {
                ...r,
                matchIds: newMatches.map((m) => m.id),
                pairingVersion: r.pairingVersion + 1,
                basedOnRound: roundIndex - 1,
                publicationStatus: 'published' as const,
                publishedAt: now,
                rankingSnapshot: snapshot,
              }
            : r,
        ),
        matches: [...byId.values()],
      },
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages: [`已公布第 ${roundIndex} 轮共 ${newMatches.length} 场对阵，并冻结评分快照。`],
  };
}

/** 确认整轮：要求该轮全部比赛都有已确认结果。 */
export function confirmRound(event: EventFile, roundIndex: number): ApplyResult {
  const round = event.swiss.rounds.find((r) => r.index === roundIndex);
  if (!round) return { event, ok: false, messages: [`找不到第 ${roundIndex} 轮`] };

  const matches = round.matchIds
    .map((id) => event.swiss.matches.find((m) => m.id === id))
    .filter((m): m is SwissMatch => m !== undefined);

  const unconfirmed = matches.filter(
    (m) => !m.attempts.some((a) => a.id === m.effectiveAttemptId && a.resultStatus === 'confirmed'),
  );
  if (unconfirmed.length > 0) {
    return {
      event,
      ok: false,
      messages: [`第 ${roundIndex} 轮还有 ${unconfirmed.length} 场未确认：${unconfirmed.map((m) => m.id).join('、')}`],
    };
  }

  const now = new Date().toISOString();
  return {
    event: {
      ...event,
      swiss: {
        ...event.swiss,
        rounds: event.swiss.rounds.map((r) => (r.index === roundIndex ? { ...r, closedAt: now } : r)),
      },
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages: [`第 ${roundIndex} 轮已确认，可以生成下一轮候选。`],
  };
}

/* ------------------------------------------------------------------ *
 * 八强种子
 * ------------------------------------------------------------------ */

export function publishFinalsSeeding(event: EventFile): ApplyResult {
  const teamIds = qualifiedTeamIds(event);
  const standings = calculateSwissStandings(teamIds, event.swiss.matches, event.qualification.ranking);

  const finalRound = event.swiss.rounds.find((r) => r.index === 5);
  if (finalRound && finalRound.closedAt === null) {
    return { event, ok: false, messages: ['第五轮尚未确认，最终种子必须等第五轮全部结束后统一计算'] };
  }

  const g30 = standings.groups.find((g) => g.record === '3-0')?.entries ?? [];
  const g31 = standings.groups.find((g) => g.record === '3-1')?.entries ?? [];
  const g32 = standings.groups.find((g) => g.record === '3-2')?.entries ?? [];

  if (g30.length < 2 || g31.length < 3 || g32.length < 3) {
    return {
      event,
      ok: false,
      messages: [
        `战绩组不足：3-0 有 ${g30.length} 队、3-1 有 ${g31.length} 队、3-2 有 ${g32.length} 队（预期 2/3/3）`,
      ],
    };
  }

  const seeds: Record<string, string> = {
    W1: g30[0]!.teamId,
    W2: g30[1]!.teamId,
    W3: g31[0]!.teamId,
    W4: g31[1]!.teamId,
    L1: g31[2]!.teamId,
    L2: g32[0]!.teamId,
    L3: g32[1]!.teamId,
    L4: g32[2]!.teamId,
  };

  const now = new Date().toISOString();
  const currentVersion = event.finals.seeding?.version ?? 0;

  return {
    event: {
      ...event,
      finals: {
        ...event.finals,
        seeding: {
          seeds,
          basisNote: '第五轮瑞士轮最终排名：3-0 前两名 W1/W2；3-1 前两名为 W3/W4、第三名为 L1；3-2 三名为 L2–L4',
          version: currentVersion + 1,
          publicationStatus: 'published',
          publishedAt: now,
        },
      },
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages: ['已公布八强种子。'],
  };
}

/* ------------------------------------------------------------------ *
 * 展示组抽签
 * ------------------------------------------------------------------ */

export function applyShowcaseDraw(event: EventFile, drawOrder: string[]): ApplyResult {
  const showcaseTeams = event.teams.filter((t) => t.division === 'showcase');
  if (drawOrder.length !== showcaseTeams.length) {
    return { event, ok: false, messages: [`抽签顺序必须包含全部 ${showcaseTeams.length} 支展示组队伍`] };
  }
  const unique = new Set(drawOrder);
  if (unique.size !== drawOrder.length) return { event, ok: false, messages: ['抽签顺序中出现重复队伍'] };
  for (const id of drawOrder) {
    if (!showcaseTeams.some((t) => t.id === id)) {
      return { event, ok: false, messages: [`${id} 不是展示组队伍`] };
    }
  }

  const now = new Date().toISOString();
  // 把抽签结果绑定到三个正式演出系列赛
  const series = event.finals.series.map((s) => {
    const index = ['showcase-final-1', 'showcase-final-2', 'showcase-final-3'].indexOf(s.id);
    if (index === -1) return s;
    const teamId = drawOrder[index];
    if (!teamId) return s;
    return {
      ...s,
      showcaseTeamId: teamId,
      participantSnapshot: [teamId, teamId] as [string, string],
      slots: [
        { kind: 'team' as const, teamId },
        { kind: 'team' as const, teamId },
      ] as [{ kind: 'team'; teamId: string }, { kind: 'team'; teamId: string }],
    };
  });

  return {
    event: {
      ...event,
      showcase: { drawOrder, confirmedAt: now, note: null },
      finals: { ...event.finals, series },
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages: ['已登记展示组抽签顺序。'],
  };
}

/* ------------------------------------------------------------------ *
 * 公告与时间调整
 * ------------------------------------------------------------------ */

export function addNotice(event: EventFile, title: string, body: string, severity: 'info' | 'warning' | 'critical'): ApplyResult {
  if (title.trim() === '' || body.trim() === '') {
    return { event, ok: false, messages: ['公告标题与内容都不能为空'] };
  }
  const now = new Date().toISOString();
  const id = `notice-${event.notices.length + 1}-${now.slice(0, 19).replace(/[:T-]/g, '')}`;
  return {
    event: {
      ...event,
      notices: [...event.notices, { id, at: now, title: title.trim(), body: body.trim(), severity }],
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages: ['已添加公告。'],
  };
}

export function adjustSchedule(
  event: EventFile,
  scheduleItemId: string,
  revisedStart: string | null,
  adjustmentNote: string | null,
): ApplyResult {
  const item = event.scheduleItems.find((s) => s.id === scheduleItemId);
  if (!item) return { event, ok: false, messages: [`找不到日程项 ${scheduleItemId}`] };
  if (revisedStart !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(revisedStart)) {
    return { event, ok: false, messages: ['修订时间必须是带时区偏移的 ISO 8601，例如 2026-10-03T09:10:00+08:00'] };
  }

  const now = new Date().toISOString();
  return {
    event: {
      ...event,
      scheduleItems: event.scheduleItems.map((s) =>
        s.id === scheduleItemId ? { ...s, revisedStart, adjustmentNote } : s,
      ),
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages: ['已调整日程。原计划时间保持不变，修订时间单独记录。'],
  };
}

/* ------------------------------------------------------------------ *
 * 变更包
 * ------------------------------------------------------------------ */

export interface ChangePackage {
  schemaVersion: 1;
  baseRevision: string;
  exportedAt: string;
  event: EventFile;
}

/** 导出完整赛事版本（避免局部补丁丢失跨对象依赖）。 */
export function buildChangePackage(event: EventFile, baseRevision: string): ChangePackage {
  return {
    schemaVersion: 1,
    baseRevision,
    exportedAt: new Date().toISOString(),
    event,
  };
}

/** 导出前的自查：返回阻断发布的问题。 */
export function preflight(event: EventFile): { ok: boolean; errors: string[]; warnings: string[] } {
  const result = validateEvent(event);
  return {
    ok: result.errors.length === 0,
    errors: result.errors.map((e) => `${e.objectType}${e.objectId ? ` ${e.objectId}` : ''}：${e.message}`),
    warnings: result.warnings.map((w) => w.message),
  };
}

export { ROUND_GROUP_ORDER };
