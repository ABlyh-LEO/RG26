/**
 * 瑞士轮评分与统计口径（docs/IMPLEMENTATION_PLAN.md 第 5.2–5.3 节）。
 *
 * 两种统计集合必须严格分开：
 * - 表现统计（n, s_k, o_k, t_k）只包含“有效比赛”（normal / early-end）。
 * - 战绩与登记对阵（W, L, m）还包含未开赛弃权与行政判负中止。
 *
 * 绝不用假 0 分填补缺失数据；缺分不是 0。
 */
import type { ResultKind, SwissMatch } from './schema';
import {
  type Rational,
  ZERO,
  add,
  clamp,
  cmp,
  div,
  fromDecimalString,
  fromInt,
  isZero,
  mul,
  rational,
  sub,
  sum,
  THREE_FIFTHS,
  TWO_FIFTHS,
  ONE_HALF,
} from './rational';

/** 有效正常比赛与按规则提前结束的比赛计入表现统计。 */
export function countsTowardPerformance(kind: ResultKind): boolean {
  return kind === 'normal' || kind === 'early-end';
}

/** 所有已结算并登记的对阵都计入战绩、登记对阵数 m 和 O。 */
export function countsTowardRecord(_kind: ResultKind): boolean {
  return true;
}

/** A 的每场得分封顶。原始积分本身没有上限。 */
export const SCORE_CAP = fromInt(16);
/** B 的分差截断范围。 */
export const DIFF_CLAMP_LOW = fromInt(-10);
export const DIFF_CLAMP_HIGH = fromInt(10);
/** 零分有效局的时间约定（秒）。 */
export const ZERO_SCORE_SECONDS = fromInt(360);

/** 一场已完成、已确认、可参与统计的对阵解析结果。 */
export interface SettledMatch {
  matchId: string;
  attemptId: string;
  homeTeamId: string;
  awayTeamId: string;
  winnerId: string;
  kind: ResultKind;
  /** 有效比赛才有值；弃权/行政中止为 null。 */
  homeScore: Rational | null;
  awayScore: Rational | null;
  homeSeconds: Rational | null;
  awaySeconds: Rational | null;
}

export interface SettledMatchIssue {
  matchId: string;
  code: string;
  message: string;
}

export interface SettledMatches {
  matches: SettledMatch[];
  issues: SettledMatchIssue[];
}

function parseScore(text: string | null, field: string, matchId: string, issues: SettledMatchIssue[]): Rational | null {
  if (text === null) return null;
  try {
    return fromDecimalString(text);
  } catch (error) {
    issues.push({
      matchId,
      code: 'invalid-decimal',
      message: `${field} 不是有效的非负十进制数值：${JSON.stringify(text)}（${(error as Error).message}）`,
    });
    return null;
  }
}

/**
 * 时间语义：
 * - 有效比赛给出时间时用它；
 * - 有效比赛得分为 0 时强制 360 秒；
 * - 有效比赛缺时间时，若不违反零分约定则记 null（由调用方决定告警，绝不伪造）。
 * 大于 360 秒只提示复核，不擅自新增硬性判罚。
 */
function resolveSeconds(
  score: Rational | null,
  seconds: Rational | null,
  field: string,
  matchId: string,
  issues: SettledMatchIssue[],
): Rational | null {
  if (score === null) return null;
  if (isZero(score)) return ZERO_SCORE_SECONDS;
  if (seconds === null) {
    issues.push({
      matchId,
      code: 'missing-seconds',
      message: `${field} 缺失：有效比赛需要达到最终积分的时间（零分局才适用 360 秒约定）`,
    });
    return null;
  }
  if (cmp(seconds, ZERO_SCORE_SECONDS) > 0) {
    issues.push({
      matchId,
      code: 'seconds-over-360',
      message: `${field} 超过 360 秒，请复核`,
    });
  }
  return seconds;
}

/**
 * 从比赛中取出“本次结算”的有效 attempt。
 * 只接受 resultStatus === 'confirmed' 且 attemptId 等于 effectiveAttemptId 的那一次；
 * 重赛的旧 attempt 保留在数据里但不参与统计。
 */
export function collectSettledMatches(matches: readonly SwissMatch[]): SettledMatches {
  const settled: SettledMatch[] = [];
  const issues: SettledMatchIssue[] = [];

  for (const match of matches) {
    if (match.effectiveAttemptId === null) continue;
    const attempt = match.attempts.find((a) => a.id === match.effectiveAttemptId);
    if (!attempt) {
      issues.push({
        matchId: match.id,
        code: 'unknown-effective-attempt',
        message: `effectiveAttemptId=${match.effectiveAttemptId} 在 attempts 中不存在`,
      });
      continue;
    }
    if (attempt.resultStatus !== 'confirmed') continue;
    if (attempt.winnerId === null) {
      issues.push({
        matchId: match.id,
        code: 'missing-winner',
        message: '已确认的结果必须由裁判确认胜者，瑞士轮不允许平局',
      });
      continue;
    }
    if (attempt.homeTeamId !== attempt.winnerId && attempt.awayTeamId !== attempt.winnerId) {
      issues.push({
        matchId: match.id,
        code: 'winner-not-participant',
        message: `胜者 ${attempt.winnerId} 不是参赛双方之一`,
      });
      continue;
    }

    const performance = countsTowardPerformance(attempt.resultKind);
    let homeScore: Rational | null = null;
    let awayScore: Rational | null = null;
    let homeSeconds: Rational | null = null;
    let awaySeconds: Rational | null = null;

    if (performance) {
      homeScore = parseScore(attempt.homeScore, '本队积分', match.id, issues);
      awayScore = parseScore(attempt.awayScore, '对手积分', match.id, issues);
      if (homeScore === null || awayScore === null) {
        issues.push({
          matchId: match.id,
          code: 'missing-score',
          message: '有效比赛缺少积分；缺分不等于 0，不得用假 0 分填补',
        });
        continue;
      }
      homeSeconds = resolveSeconds(homeScore, parseScore(attempt.homeReachedSeconds, '本队时间', match.id, issues), '本队时间', match.id, issues);
      awaySeconds = resolveSeconds(awayScore, parseScore(attempt.awayReachedSeconds, '对手时间', match.id, issues), '对手时间', match.id, issues);
    }

    settled.push({
      matchId: match.id,
      attemptId: attempt.id,
      homeTeamId: attempt.homeTeamId,
      awayTeamId: attempt.awayTeamId,
      winnerId: attempt.winnerId,
      kind: attempt.resultKind,
      homeScore,
      awayScore,
      homeSeconds,
      awaySeconds,
    });
  }

  return { matches: settled, issues };
}

/**
 * 单队的原始统计与派生评分。
 *
 * - n: 计入得分表现的有效比赛数量
 * - m: 已结算并登记的对阵数量（含弃权与行政中止）
 * - W/L: 上述对阵的胜负
 * - s/o/t: 有效比赛的本队/对手积分与时间贡献
 */
export interface TeamScores {
  teamId: string;
  n: number;
  m: number;
  wins: number;
  losses: number;
  /** 有效比赛的原始积分序列（不封顶）。 */
  scores: Rational[];
  /** 有效比赛的对手积分序列。 */
  opponentScores: Rational[];
  /** 有效比赛的本队时间序列。 */
  times: Rational[];
  meanScore: Rational;
  meanDiff: Rational;
  /** 局均最后得分时间 T；n=0 时为 360。 */
  t: Rational;
  a: Rational;
  b: Rational;
  p: Rational;
  /** 胜率 v = W/(W+L)；无胜负记录时为 0。 */
  v: Rational;
  /**
   * 对手强度分 O 与综合分 R。
   * 在 computeOpponentAndComposite 之前保持 undefined，读取请用 readScores，
   * 以避免把“尚未计算”误当成 0。
   */
  o?: Rational;
  r?: Rational;
  /** 已结算的对手出现序列（不去重，每场计一次）。 */
  opponents: string[];
  issues: SettledMatchIssue[];
}

/** 每场对 A 的贡献：(100/n) * min(s_k,16)/16 —— 注意 100/n 在求和外。 */
function contributionA(scores: readonly Rational[]): Rational {
  if (scores.length === 0) return ZERO;
  const capped = sum(scores.map((s) => div(clamp(s, ZERO, SCORE_CAP), SCORE_CAP)));
  return mul(div(fromInt(100), fromInt(scores.length)), capped);
}

/** 每场对 B 的贡献：(1/n) * sum(50 + 5 * clamp(s_k - o_k, -10, 10))。 */
function contributionB(scores: readonly Rational[], opponentScores: readonly Rational[]): Rational {
  if (scores.length === 0) return ZERO;
  const parts = scores.map((s, index) => {
    const opp = opponentScores[index];
    if (opp === undefined) return fromInt(50);
    const diff = clamp(sub(s, opp), DIFF_CLAMP_LOW, DIFF_CLAMP_HIGH);
    return add(fromInt(50), mul(fromInt(5), diff));
  });
  return mul(div(fromInt(1), fromInt(scores.length)), sum(parts));
}

/**
 * 计算全部队伍的原始统计与 P。
 * 注意：P（以及 v）必须先全部算完，才能计算任何队伍的 O/R（第 5.3 节）。
 */
export function computeTeamScores(
  teamIds: readonly string[],
  settled: readonly SettledMatch[],
  issues: readonly SettledMatchIssue[] = [],
): Map<string, TeamScores> {
  const result = new Map<string, TeamScores>();
  for (const teamId of teamIds) {
    const scores: Rational[] = [];
    const opponentScores: Rational[] = [];
    const times: Rational[] = [];
    const opponents: string[] = [];
    const ownIssues: SettledMatchIssue[] = [];
    let wins = 0;
    let losses = 0;
    let m = 0;

    for (const match of settled) {
      const isHome = match.homeTeamId === teamId;
      const isAway = match.awayTeamId === teamId;
      if (!isHome && !isAway) continue;

      // 战绩与登记对阵：所有已结算对阵都计入。
      m += 1;
      if (match.winnerId === teamId) wins += 1;
      else losses += 1;
      opponents.push(isHome ? match.awayTeamId : match.homeTeamId);

      // 表现统计：只有有效比赛计入。
      if (!countsTowardPerformance(match.kind)) continue;
      const ownScore = isHome ? match.homeScore : match.awayScore;
      const oppScore = isHome ? match.awayScore : match.homeScore;
      const ownSeconds = isHome ? match.homeSeconds : match.awaySeconds;
      if (ownScore === null || oppScore === null || ownSeconds === null) continue;
      scores.push(ownScore);
      opponentScores.push(oppScore);
      times.push(ownSeconds);
    }

    for (const issue of issues) {
      const match = settled.find((s) => s.matchId === issue.matchId);
      if (match && (match.homeTeamId === teamId || match.awayTeamId === teamId)) ownIssues.push(issue);
    }

    const n = scores.length;
    const a = contributionA(scores);
    const b = contributionB(scores, opponentScores);
    const p = n === 0 ? ZERO : mul(add(a, b), ONE_HALF);
    const totalGames = wins + losses;
    const v = totalGames === 0 ? ZERO : div(fromInt(wins), fromInt(totalGames));

    result.set(teamId, {
      teamId,
      n,
      m,
      wins,
      losses,
      scores,
      opponentScores,
      times,
      meanScore: n === 0 ? ZERO : div(sum(scores), fromInt(n)),
      meanDiff: n === 0 ? ZERO : div(sum(scores.map((s, i) => sub(s, opponentScores[i] ?? ZERO))), fromInt(n)),
      t: n === 0 ? ZERO_SCORE_SECONDS : div(sum(times), fromInt(n)),
      a,
      b,
      p,
      v,
      opponents,
      issues: ownIssues,
    });
  }
  return result;
}

/**
 * 对手强度分 O 与综合分 R。
 *
 * O = (1/m) * sum(q_j)，其中 q_j = 50*v_j + 0.5*P_j，按每场对应对手计入一次。
 * 同一对手多次对阵就计多次，不去重。O 不依赖对手的 O/R，因此本函数是单遍的。
 */
export function computeOpponentAndComposite(scores: Map<string, TeamScores>): void {
  for (const team of scores.values()) {
    if (team.m === 0 || team.opponents.length === 0) {
      team.o = ZERO;
      team.r = mul(THREE_FIFTHS, team.p);
      continue;
    }
    const qs = team.opponents.map((opponentId) => {
      const opp = scores.get(opponentId);
      if (!opp) return ZERO;
      return add(mul(fromInt(50), opp.v), mul(ONE_HALF, opp.p));
    });
    const o = div(sum(qs), fromInt(team.opponents.length));
    team.o = o;
    team.r = add(mul(THREE_FIFTHS, team.p), mul(TWO_FIFTHS, o));
  }
}

/** 带 O/R 的完整评分。 */
export interface TeamScoresComplete extends TeamScores {
  o: Rational;
  r: Rational;
}

/**
 * 显式读取带 O/R 的评分。
 * 若尚未调用 computeOpponentAndComposite，按第 5.3 节的边界值补齐：
 * m=0 时 O 为 0，R = 0.6P + 0.4*0。
 */
export function readScores(scores: Map<string, TeamScores>, teamId: string): TeamScoresComplete {
  const s = scores.get(teamId);
  if (!s) throw new Error(`未知队伍：${teamId}`);
  const o = s.o ?? ZERO;
  const r = s.r ?? add(mul(THREE_FIFTHS, s.p), mul(TWO_FIFTHS, o));
  return { ...s, o, r };
}

/** 供测试与展示使用的便捷常量：100 与 50 的常见组合。 */
export const HUNDRED = rational(100n);
export const FIFTY = rational(50n);

export { cmp, isZero };
