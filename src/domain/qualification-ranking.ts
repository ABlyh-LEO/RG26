/**
 * 排位赛名次计算（纯函数）。
 *
 * 口径由组委会确认（原文只写「取两轮最优成绩排 1–22 名」，未说明比较规则）：
 *
 * 1. **积分高者优**；
 * 2. **积分相同时，到达最终分时间早者优**。
 *
 * 「两轮最优」按同一口径取：先比积分，积分高者胜出；积分相同再比时间。
 *
 * 本模块不读时钟、不碰 DOM、不使用随机数（由 ESLint 强制），
 * 因此结果完全由输入决定，可被单测穷尽覆盖。
 */
import type { EventFile, QualificationRun } from './schema';

/** 一支队伍在排位赛中的最优一轮。 */
export interface BestRun {
  teamId: string;
  /** 胜出的那一轮（1 或 2）。 */
  round: 1 | 2;
  /** 该轮积分；无可用成绩时为 null。 */
  score: number | null;
  /** 该轮到达最终分时间（秒）；无记录时为 null。 */
  elapsedSeconds: number | null;
  /** 展示用文字，优先取原始成绩文字，其次由积分/用时拼出。 */
  label: string;
  /**
   * 该队**没有任何已确认且带积分的成绩**。
   *
   * 只有这种情况才沉到榜尾 —— 名次完全无从计算。
   *
   * 注意**不要**把"只录了一轮"也算进来：只有一轮有效成绩时，
   * 那一轮就是它的最优成绩，理应正常参与排名。早先版本把两者混在
   * 一起，导致"少录一轮"的队伍被错误地压到榜尾。
   */
  incomplete: boolean;
  /** 只录到一轮（或另一轮无成绩），名次基于现有数据，提示复核。 */
  partial: boolean;
}

/** 队伍名次条目。 */
export interface QualifiedStanding {
  teamId: string;
  /** 1 起的名次。 */
  rank: number;
  best: BestRun | null;
  /**
   * 与**前一名**成绩完全相同（积分与用时都相同）。
   * 这类并列无法用数据区分，名次由输入顺序决定，需人工复核。
   */
  tiedWithPrevious: boolean;
}

export interface QualificationRankResult {
  standings: QualifiedStanding[];
  /** 没有任何可比成绩、必须人工补录的队伍（沉在榜尾）。 */
  incompleteTeamIds: string[];
  /** 只有一轮可比成绩、名次基于现有数据的队伍（需复核）。 */
  partialTeamIds: string[];
  /** 存在并列、名次需人工确认的队伍。 */
  tiedTeamIds: string[];
}

/**
 * 解析可比较的数值。
 *
 * schema 把积分与用时定义为**十进制字符串**（可以是 "12.5"），
 * 也可能为 null 或空串。无法解析时返回 null，表示"没有可比成绩"。
 */
function toNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * 比较两轮，判断 `a` 是否优于 `b`（用于"取两轮最优"）。
 *
 * - 有成绩优于无成绩；
 * - 积分高者优；
 * - 积分相同则用时短者优；
 * - 用时也一样（或都缺）时不算谁更优，保留先出现的那个（轮次小的）。
 */
function isBetter(a: RunScore, b: RunScore): boolean {
  if (a.score === null && b.score === null) return false;
  if (a.score === null) return false;
  if (b.score === null) return true;
  if (a.score !== b.score) return a.score > b.score;
  if (a.elapsedSeconds === null && b.elapsedSeconds === null) return false;
  if (a.elapsedSeconds === null) return false;
  if (b.elapsedSeconds === null) return true;
  return a.elapsedSeconds < b.elapsedSeconds;
}

interface RunScore {
  score: number | null;
  elapsedSeconds: number | null;
}

/** 一轮跑图是否已确认且具备可比成绩。 */
function isUsable(run: QualificationRun): boolean {
  return run.resultStatus === 'confirmed';
}

/** 把一轮跑图转成可比较的分数；没有积分就无法参与自动排名。 */
function scoreOf(run: QualificationRun): RunScore {
  return {
    score: toNumber(run.score),
    elapsedSeconds: toNumber(run.elapsedSeconds),
  };
}

/** 展示文字：优先原文，其次由积分与用时拼出。 */
function labelOf(run: QualificationRun): string {
  const raw = run.rawResult?.trim();
  if (raw) return raw;
  const parts: string[] = [];
  const s = toNumber(run.score);
  const e = toNumber(run.elapsedSeconds);
  if (s !== null) parts.push(`${s} 分`);
  if (e !== null) parts.push(`${e} 秒`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * 计算每队的**最优一轮**。
 *
 * 只考虑 `resultStatus === 'confirmed'` 的记录：未确认的成绩是草稿，
 * 不能影响对外公布的名次。
 */
export function pickBestRun(
  runs: readonly QualificationRun[],
  teamId: string,
): BestRun | null {
  const own = runs.filter((r) => r.teamId === teamId);
  if (own.length === 0) return null;

  const usable = own.filter(isUsable);

  /** 有积分才谈得上排名；只有成绩文字没有积分的记录无法比较。 */
  const scorable = usable.filter((r) => toNumber(r.score) !== null);

  if (scorable.length === 0) {
    // 没有任何可比成绩：返回条目并标记 incomplete，
    // 让调用方把它沉到榜尾并要求人工补录。
    const first = usable[0] ?? own[0]!;
    return {
      teamId,
      round: first.round,
      score: null,
      elapsedSeconds: null,
      label: usable.length > 0 ? labelOf(first) : '—',
      incomplete: true,
      partial: false,
    };
  }

  let best: QualificationRun | null = null;
  for (const run of scorable) {
    if (best === null || isBetter(scoreOf(run), scoreOf(best))) best = run;
  }

  const s = scoreOf(best!);
  return {
    teamId,
    round: best!.round,
    score: s.score,
    elapsedSeconds: s.elapsedSeconds,
    label: labelOf(best!),
    incomplete: false,
    // 两轮都有可比成绩才算完整；否则名次基于现有数据，提示复核。
    partial: scorable.length < 2,
  };
}

/**
 * 按「积分高者优，同分时用时短者优」计算排位赛 1–22 名。
 *
 * **稳定排序**：成绩完全相同的队伍保持输入顺序（即三审顺序 / 出场顺序），
 * 并标记 `tiedWithPrevious` 提示人工复核 —— 数据本身无法区分谁在前。
 *
 * 缺成绩的队伍排在最后，并出现在 `incompleteTeamIds` 里。
 */
export function computeQualificationRanking(
  event: EventFile,
): QualificationRankResult {
  const competitive = event.teams.filter((t) => t.division === 'competitive');
  const runs = event.qualification.runs;

  const entries = competitive.map((team) => ({
    teamId: team.id,
    best: pickBestRun(runs, team.id),
  }));

  const complete = entries.filter((e) => e.best !== null && !e.best.incomplete);
  const incomplete = entries.filter((e) => e.best === null || e.best.incomplete);
  /**
   * 排序键：先按"有无成绩"，再按积分降序，再按用时升序。
   * 缺成绩的一律沉底（不参与前面的比较）。
   */
  const sorted = [...complete].sort((a, b) => {
    const ba = a.best!;
    const bb = b.best!;
    const sa = ba.score;
    const sb = bb.score;
    if (sa === null && sb === null) return 0;
    if (sa === null) return 1;
    if (sb === null) return -1;
    if (sa !== sb) return sb - sa; // 积分高者优
    const ea = ba.elapsedSeconds;
    const eb = bb.elapsedSeconds;
    if (ea === null && eb === null) return 0;
    if (ea === null) return 1;
    if (eb === null) return -1;
    return ea - eb; // 用时短者优
  });

  const ordered = [...sorted, ...incomplete];

  const standings: QualifiedStanding[] = [];
  const tiedTeamIds: string[] = [];
  ordered.forEach((entry, index) => {
    const prev = index > 0 ? ordered[index - 1]! : null;
    const tied =
      prev !== null &&
      prev.best !== null &&
      entry.best !== null &&
      !prev.best.incomplete &&
      !entry.best.incomplete &&
      prev.best.score === entry.best.score &&
      prev.best.elapsedSeconds === entry.best.elapsedSeconds;
    if (tied) tiedTeamIds.push(entry.teamId);
    standings.push({
      teamId: entry.teamId,
      rank: index + 1,
      best: entry.best,
      tiedWithPrevious: tied,
    });
  });

  return {
    standings,
    incompleteTeamIds: incomplete.map((e) => e.teamId),
    partialTeamIds: complete.filter((e) => e.best!.partial).map((e) => e.teamId),
    tiedTeamIds,
  };
}

/* ------------------------------------------------------------------ *
 * 实时排行（「当前排行」）
 * ------------------------------------------------------------------ */

/** 实时排行中的一行。 */
export interface LiveQualificationStanding {
  teamId: string;
  /** 1 起的「当前位次」。展示措辞必须是「当前第 N 位」，不能写成「第 N 名」。 */
  position: number;
  label: string;
  score: number | null;
  elapsedSeconds: number | null;
  round: 1 | 2 | null;
  /** 该队没有任何已确认且可比较的成绩。 */
  incomplete: boolean;
  /** 只录到一轮可比成绩。 */
  partial: boolean;
  /** 与上一位成绩完全相同，名次无法由数据区分。 */
  tiedWithPrevious: boolean;
}

/**
 * 实时排行：由已确认成绩现场算出，**绝不落库、绝不参与业务判定**。
 *
 * 观众端允许在成绩不完整时看排名（以「当前排行」名义），但必须同时
 * 标注未确认与不完整，且**不得据此断言谁晋级**。业务判定
 * （`qualifiedTeamIds`、八强种子、R1 配对、奖项结算）只能读
 * `officialQualificationRanking`。
 */
export interface LiveQualificationRanking {
  entries: LiveQualificationStanding[];
  /** 已确认且积分可比较的跑图次数，用于「已确认 N / 44 次」的规模标注。 */
  scoredRunCount: number;
  confirmedRunCount: number;
  totalRunCount: number;
  teamCount: number;
  /** 是否有任何可比成绩；为假时不应显示实时榜。 */
  hasAnyScore: boolean;
  incompleteTeamIds: string[];
  partialTeamIds: string[];
  tiedTeamIds: string[];
}

/** 现场派生实时排行。本函数不写入任何数据。 */
export function liveQualificationRanking(event: EventFile): LiveQualificationRanking {
  const result = computeQualificationRanking(event);
  const entries: LiveQualificationStanding[] = result.standings.map((standing) => {
    const best = standing.best;
    return {
      teamId: standing.teamId,
      position: standing.rank,
      label: best?.label ?? '—',
      score: best?.score ?? null,
      elapsedSeconds: best?.elapsedSeconds ?? null,
      round: best?.round ?? null,
      incomplete: best === null || best.incomplete,
      partial: best?.partial ?? false,
      tiedWithPrevious: standing.tiedWithPrevious,
    };
  });

  const runs = event.qualification.runs;
  const scoredRunCount = runs.filter(
    (run) => run.resultStatus === 'confirmed' && toNumber(run.score) !== null,
  ).length;

  return {
    entries,
    scoredRunCount,
    confirmedRunCount: runs.filter((run) => run.resultStatus === 'confirmed').length,
    totalRunCount: runs.length,
    teamCount: entries.length,
    hasAnyScore: scoredRunCount > 0,
    incompleteTeamIds: result.incompleteTeamIds,
    partialTeamIds: result.partialTeamIds,
    tiedTeamIds: result.tiedTeamIds,
  };
}
