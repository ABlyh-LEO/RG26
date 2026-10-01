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
import { computeQualificationRanking } from '../domain/qualification-ranking';
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
  /**
   * 到达最终分时间（秒）。**必须记录**：
   * 积分相同时，最后得分时间是判断本局胜负的重要依据。
   *
   * 类型上可省略是为了兼容既有调用点；省略等同于留空（尚未填），
   * **绝不等于 0** —— 0 秒与"没填"是两件不同的事。
   */
  homeReachedSeconds?: string;
  awayReachedSeconds?: string;
  winnerId: string | null;
  resultKind: ResultKind;
}

/**
 * 校验并归一化「到达最终分时间」。
 *
 * **有效比赛的时间是强制必填**（组委会确认）：积分相同时，
 * 最后得分时间是判断本局胜负的重要依据，缺了它就无法判罚。
 *
 * 唯一的例外是**零分局**：积分为 0 时沿用 360 秒约定
 * （与瑞士轮 `t_k` 的口径一致），调用方传 `scoreIsZero` 即可。
 *
 * **绝不把空值当成 0** —— 「没填」与「0 秒」是两件不同的事。
 */
function normalizeSeconds(
  raw: string | undefined,
  label: string,
  options: { required: boolean; scoreIsZero?: boolean } = { required: true },
): { ok: true; value: string | null } | { ok: false; message: string } {
  const text = (raw ?? '').trim();
  if (text === '') {
    // 零分局：按 360 秒约定补上，而不是留空
    if (options.scoreIsZero) return { ok: true, value: '360' };
    if (options.required) {
      return {
        ok: false,
        message: `${label}必须填写（积分相同时它决定胜负；积分为 0 时记 360 秒）`,
      };
    }
    return { ok: true, value: null };
  }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    return { ok: false, message: `${label}必须是非负十进制数值（秒）` };
  }
  return { ok: true, value: text };
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

  /*
   * 有效比赛的时间**强制必填**（积分相同时决定胜负）；
   * 零分局沿用 360 秒约定，与瑞士轮口径一致。
   * 弃权/行政中止不计表现分，因此不要求时间。
   */
  const countsPerformance = entry.resultKind === 'normal' || entry.resultKind === 'early-end';

  const homeSec = normalizeSeconds(entry.homeReachedSeconds, '本方（第一个席位）到达最终分时间', {
    required: countsPerformance,
    scoreIsZero: countsPerformance && Number(entry.homeScore) === 0,
  });
  if (!homeSec.ok) return { event, ok: false, messages: [homeSec.message] };
  const awaySec = normalizeSeconds(entry.awayReachedSeconds, '对方（第二个席位）到达最终分时间', {
    required: countsPerformance,
    scoreIsZero: countsPerformance && Number(entry.awayScore) === 0,
  });
  if (!awaySec.ok) return { event, ok: false, messages: [awaySec.message] };

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
                        homeReachedSeconds: homeSec.value,
                        awayReachedSeconds: awaySec.value,
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

/**
 * 录入一场**决赛 BO1**（八强赛 / 败者组第二轮 / 半决赛，共 8 场）。
 *
 * 为什么需要单独的入口：
 * 决赛系列赛分两类 —— 第 1–8 场是 **BO1**，第 9–10 场是 **BO3**。
 * `applyBo1Entry` 只查 `event.swiss.matches`（瑞士轮），
 * `applyBo3Game` 明确拒绝非 BO3/BO2 的系列赛，
 * 于是这 8 场 BO1 一度**完全没有录入入口** —— 决赛根本推不下去。
 *
 * BO1 只打一局，因此直接写 `games[0]`，与 BO3 共用同一套
 * `participantSnapshot` / `resultStatus` 语义，保证下游解析一致。
 */
export function applyFinalsBo1(event: EventFile, entry: Bo3GameEntry): ApplyResult {
  const series = event.finals.series.find((s) => s.id === entry.seriesId);
  if (!series) return { event, ok: false, messages: [`找不到系列赛 ${entry.seriesId}`] };

  if (series.format !== 'BO1') {
    return { event, ok: false, messages: [`${series.id} 不是 BO1 系列赛，请用逐局录入`] };
  }
  if (!series.countsForStandings) {
    return { event, ok: false, messages: [`${series.id} 不计入排名，不应录入正式结果`] };
  }

  const decided = seriesWins(series);
  if (decided.winnerId !== null) {
    return {
      event,
      ok: false,
      messages: [`该场比赛已由 ${decided.winnerId} 获胜并结束，如需更正请重新录入（会作为新记录追加）。`],
    };
  }

  if (entry.winnerId === null) {
    return { event, ok: false, messages: ['必须指定胜者：淘汰赛不允许平局，胜者由裁判确认'] };
  }
  if (entry.homeTeamId === entry.awayTeamId) {
    return { event, ok: false, messages: ['双方不能是同一支队伍'] };
  }
  if (entry.winnerId !== entry.homeTeamId && entry.winnerId !== entry.awayTeamId) {
    return { event, ok: false, messages: ['胜者必须是参赛双方之一'] };
  }

  const performanceKinds: ResultKind[] = ['normal', 'early-end'];
  if (performanceKinds.includes(entry.resultKind)) {
    if (entry.homeScore.trim() === '' || entry.awayScore.trim() === '') {
      return { event, ok: false, messages: ['有效比赛必须填写双方积分（缺分不等于 0，不能用假 0 分填补）'] };
    }
  }

  const homeSec = normalizeSeconds(entry.homeReachedSeconds, '本方（第一个席位）到达最终分时间', {
    required: performanceKinds.includes(entry.resultKind),
    scoreIsZero: performanceKinds.includes(entry.resultKind) && Number(entry.homeScore) === 0,
  });
  if (!homeSec.ok) return { event, ok: false, messages: [homeSec.message] };
  const awaySec = normalizeSeconds(entry.awayReachedSeconds, '对方（第二个席位）到达最终分时间', {
    required: performanceKinds.includes(entry.resultKind),
    scoreIsZero: performanceKinds.includes(entry.resultKind) && Number(entry.awayScore) === 0,
  });
  if (!awaySec.ok) return { event, ok: false, messages: [awaySec.message] };

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
                executionStatus: 'finished' as const,
                games: s.games.map((g) =>
                  g.index === (s.games[0]?.index ?? 1)
                    ? {
                        ...g,
                        homeTeamId: entry.homeTeamId,
                        awayTeamId: entry.awayTeamId,
                        homeScore: entry.homeScore.trim() === '' ? null : entry.homeScore.trim(),
                        awayScore: entry.awayScore.trim() === '' ? null : entry.awayScore.trim(),
                        homeReachedSeconds: homeSec.value,
                        awayReachedSeconds: awaySec.value,
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
export function seriesWins(series: Series): { home: number; away: number; need: number; winnerId: string | null } {  const need = series.format === 'BO1' ? 1 : 2;
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
 * 排位赛跑图成绩
 * ------------------------------------------------------------------ */

export interface QualificationRunEntry {
  runId: string;
  /** 成绩文字（例如「2.35 米」）。规则未规定结构，因此允许自由文本；仅作展示。 */
  rawResult: string;
  /**
   * 积分。**参与排名的依据之一**（积分高者优）。
   * 未确认的成绩不计入名次。
   */
  score: string | null;
  /**
   * 到达最终分时间（秒）。**参与排名的依据之一**
   * （积分相同时，用时短者优）。
   */
  elapsedSeconds: string | null;
  judgeNote: string | null;
  /** 是否标记为已确认。 */
  confirm: boolean;
}

const NON_NEGATIVE_DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * 录入一次排位赛跑图成绩。
 *
 * 口径（组委会确认，见 `domain/qualification-ranking.ts`）：
 * **积分高者优；积分相同时，到达最终分时间早者优。**
 * 成绩文字只作展示，不参与比较。
 *
 * 本函数只负责**写入**这一条记录；调用方在 `confirm` 为真时
 * 接着调用 `applyQualificationAutoRanking` 重排名次。
 * 未确认（provisional）的成绩**不影响**对外名次。
 */
export function applyQualificationRun(event: EventFile, entry: QualificationRunEntry): ApplyResult {
  const run = event.qualification.runs.find((r) => r.id === entry.runId);
  if (!run) return { event, ok: false, messages: [`找不到跑图记录 ${entry.runId}`] };

  // 这两个字段在类型上是 string，但外部调用（脚本 / 反序列化）可能传来
  // null。早先直接 .trim() 会抛 TypeError 而不是返回一条可读的错误，
  // 这里统一按空串处理，失败也要是"可解释的失败"。
  const rawText = (entry.rawResult ?? '').trim();
  const scoreText = (entry.score ?? '').trim();
  const elapsedText = (entry.elapsedSeconds ?? '').trim();

  if (scoreText !== '' && !NON_NEGATIVE_DECIMAL.test(scoreText)) {
    return { event, ok: false, messages: ['积分必须是非负十进制数值（可留空）'] };
  }
  if (elapsedText !== '' && !NON_NEGATIVE_DECIMAL.test(elapsedText)) {
    return { event, ok: false, messages: ['用时必须是非负十进制数值（秒）'] };
  }
  if (entry.confirm && rawText === '' && scoreText === '') {
    return { event, ok: false, messages: ['标记为已确认时，至少要填写成绩文字或积分'] };
  }

  const now = new Date().toISOString();
  const nextStatus = entry.confirm ? ('confirmed' as const) : ('provisional' as const);

  return {
    event: {
      ...event,
      qualification: {
        ...event.qualification,
        runs: event.qualification.runs.map((r) =>
          r.id === entry.runId
            ? {
                ...r,
                rawResult: rawText === '' ? null : rawText,
                score: scoreText === '' ? null : scoreText,
                elapsedSeconds: elapsedText === '' ? null : elapsedText,
                judgeNote: entry.judgeNote,
                resultStatus: nextStatus,
                executionStatus: entry.confirm ? ('finished' as const) : r.executionStatus,
                confirmedAt: entry.confirm ? now : null,
              }
            : r,
        ),
      },
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages: entry.confirm ? [] : ['已保存为「待确认」，确认后才会出现在跑图记录中。'],
  };
}

/**
 * 批量确认某队（或全部）待确认的跑图成绩。
 * 排位赛核分时段一次性确认是常见操作，因此提供批量入口。
 */
export function confirmQualificationRuns(
  event: EventFile,
  options: { teamId?: string; round?: 1 | 2 } = {},
): ApplyResult {
  const now = new Date().toISOString();
  const targets = event.qualification.runs.filter(
    (r) =>
      r.resultStatus === 'provisional' &&
      (options.teamId === undefined || r.teamId === options.teamId) &&
      (options.round === undefined || r.round === options.round),
  );

  if (targets.length === 0) {
    return { event, ok: false, messages: ['没有待确认的跑图成绩。'] };
  }

  const targetIds = new Set(targets.map((r) => r.id));
  return {
    event: {
      ...event,
      qualification: {
        ...event.qualification,
        runs: event.qualification.runs.map((r) =>
          targetIds.has(r.id)
            ? { ...r, resultStatus: 'confirmed' as const, confirmedAt: now, executionStatus: 'finished' as const }
            : r,
        ),
      },
      event: { ...event.event, contentUpdatedAt: now },
    },
    ok: true,
    messages: [`已确认 ${targets.length} 条跑图成绩。`],
  };
}

/** 排位赛进度概览，供维护工具与页面显示。 */
export function qualificationProgress(event: EventFile): {
  total: number;
  confirmed: number;
  provisional: number;
  pending: number;
} {
  const runs = event.qualification.runs;
  return {
    total: runs.length,
    confirmed: runs.filter((r) => r.resultStatus === 'confirmed').length,
    provisional: runs.filter((r) => r.resultStatus === 'provisional').length,
    pending: runs.filter((r) => r.resultStatus === 'none').length,
  };
}

/* ------------------------------------------------------------------ *
 * 排位赛
 * ------------------------------------------------------------------ */

/**
 * 按「积分高者优，同分时到达最终分时间早者优」自动重排排位赛 1–22 名。
 *
 * 口径由组委会确认，见 `domain/qualification-ranking.ts`。
 *
 * 与 `applyQualificationRanking` 的区别：
 * - 本函数**从成绩推算**名次，用于单场成绩更新后自动重排；
 * - `applyQualificationRanking` 是**人工覆盖**，用于数据无法区分的并列
 *   （积分与用时完全相同）或组委会特批的调整。
 *
 * 存在并列或成绩不全时依然写入，但会在 messages 里明确提示需人工复核，
 * 绝不假装名次已经确定。
 */
export function applyQualificationAutoRanking(event: EventFile): ApplyResult {
  const result = computeQualificationRanking(event);
  const messages: string[] = [];

  if (result.incompleteTeamIds.length > 0) {
    const names = result.incompleteTeamIds
      .map((id) => event.teams.find((t) => t.id === id)?.name ?? id)
      .slice(0, 5);
    messages.push(
      `${result.incompleteTeamIds.length} 支队伍暂无积分成绩，已排在榜尾：${names.join('、')}${
        result.incompleteTeamIds.length > names.length ? ' 等' : ''
      }`,
    );
  }
  if (result.partialTeamIds.length > 0) {
    messages.push(`${result.partialTeamIds.length} 支队伍只录到一轮成绩，名次基于现有数据。`);
  }
  if (result.tiedTeamIds.length > 0) {
    const names = result.tiedTeamIds
      .map((id) => event.teams.find((t) => t.id === id)?.name ?? id)
      .slice(0, 5);
    messages.push(
      `积分与用时完全相同的并列，名次无法由数据区分，请人工复核：${names.join('、')}`,
    );
  }

  const now = new Date().toISOString();
  const orderedTeamIds = result.standings.map((s) => s.teamId);
  const bestResultLabels = result.standings.map((s) => s.best?.label ?? '—');

  return {
    event: {
      ...event,
      qualification: {
        ...event.qualification,
        ranking: {
          ...event.qualification.ranking,
          orderedTeamIds,
          bestResultLabels,
          sourceNote: event.qualification.ranking.sourceNote ?? '按积分与到达最终分时间自动排序',
          status: 'confirmed',
          confirmedAt: now,
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
