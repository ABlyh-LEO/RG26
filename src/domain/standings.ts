/**
 * 排名与排序（docs/IMPLEMENTATION_PLAN.md 第 5.4 节）。
 *
 * 同战绩组依次比较：R 降序 → P 降序 → T 升序 → 排位赛最终名次升序。
 * 前项相同才比较后项。比较一律用原始有理数精度，
 * 绝不使用页面显示的四舍五入值，也不增加未规定的“直接交手”“净胜分优先”。
 */
import type { QualificationRanking, SwissMatch } from './schema';
import {
  type Rational,
  cmp,
  fromInt,
  fromSerialized,
  toFixed2,
} from './rational';
import {
  type SettledMatch,
  type TeamScores,
  collectSettledMatches,
  computeOpponentAndComposite,
  computeTeamScores,
  readScores,
} from './scores';

/** 每个战绩组内的一条排名记录。 */
export interface StandingsEntry {
  teamId: string;
  /** 战绩组的原始战绩。 */
  wins: number;
  losses: number;
  record: string;
  /** 组内名次，从 1 开始。 */
  rankWithinGroup: number;
  metrics: {
    n: number;
    m: number;
    a: Rational;
    b: Rational;
    p: Rational;
    o: Rational;
    r: Rational;
    t: Rational;
    meanScore: Rational;
    meanDiff: Rational;
    v: Rational;
  };
  /** 展示用两位小数；比较绝不使用这些值。 */
  display: {
    a: string;
    b: string;
    p: string;
    o: string;
    r: string;
    t: string;
    /** n=0 时为 null，UI 显示“—”。 */
    meanScore: string | null;
    meanDiff: string | null;
  };
  /** 排位赛最终名次（1 起）。缺失时为 null。 */
  qualificationRank: number | null;
  issues: string[];
}

export interface StandingsGroup {
  record: string;
  wins: number;
  losses: number;
  entries: StandingsEntry[];
}

export interface Standings {
  /** 按最终战绩组顺序：3-0、3-1、3-2、2-3、1-3、0-3 及任何实际存在的组合。 */
  groups: StandingsGroup[];
  byTeam: Map<string, StandingsEntry>;
  /** 计算过程中的数据问题，按比赛列出。 */
  issues: { matchId: string; code: string; message: string }[];
}

/**
 * 最终战绩组顺序。文档规定的顺序在前，其余按胜场降序、负场升序兜底，
 * 以便在异常（退赛等）导致非标准战绩时仍能稳定输出。
 */
export const CANONICAL_RECORD_ORDER = ['3-0', '3-1', '3-2', '2-3', '1-3', '0-3'] as const;

function recordOrderKey(record: string, index: Map<string, number>): number {
  const known = index.get(record);
  if (known !== undefined) return known;
  return CANONICAL_RECORD_ORDER.length;
}

function parseRecord(record: string): { wins: number; losses: number } {
  const [w = '0', l = '0'] = record.split('-');
  return { wins: Number(w), losses: Number(l) };
}

/**
 * 计算瑞士轮排名。
 *
 * @param teamIds        参与排名的队伍（正常为晋级十六强的 16 队）
 * @param matches        全部瑞士轮比赛（含未公布的空槽）
 * @param qualification  正式排位赛排名，用于同分时的最后一级比较
 */
export function calculateSwissStandings(
  teamIds: readonly string[],
  matches: readonly SwissMatch[],
  qualification: QualificationRanking,
): Standings {
  const settledAll = collectSettledMatches(matches);
  const scoresMap = computeTeamScores(teamIds, settledAll.matches, settledAll.issues);
  computeOpponentAndComposite(scoresMap);

  const qualificationRankOf = new Map<string, number>();
  qualification.orderedTeamIds.forEach((teamId, index) => {
    qualificationRankOf.set(teamId, index + 1);
  });

  const byRecord = new Map<string, StandingsEntry[]>();
  const byTeam = new Map<string, StandingsEntry>();

  for (const teamId of teamIds) {
    const s = readScores(scoresMap, teamId);
    const record = `${s.wins}-${s.losses}`;
    const entry: StandingsEntry = {
      teamId,
      wins: s.wins,
      losses: s.losses,
      record,
      rankWithinGroup: 0,
      metrics: {
        n: s.n,
        m: s.m,
        a: s.a,
        b: s.b,
        p: s.p,
        o: s.o,
        r: s.r,
        t: s.t,
        meanScore: s.meanScore,
        meanDiff: s.meanDiff,
        v: s.v,
      },
      display: {
        a: toFixed2(s.a),
        b: toFixed2(s.b),
        p: toFixed2(s.p),
        o: toFixed2(s.o),
        r: toFixed2(s.r),
        t: toFixed2(s.t),
        meanScore: s.n === 0 ? null : toFixed2(s.meanScore),
        meanDiff: s.n === 0 ? null : toFixed2(s.meanDiff),
      },
      qualificationRank: qualificationRankOf.get(teamId) ?? null,
      issues: s.issues.map((i) => i.message),
    };
    byTeam.set(teamId, entry);
    const list = byRecord.get(record);
    if (list) list.push(entry);
    else byRecord.set(record, [entry]);
  }

  const canonicalIndex = new Map<string, number>(CANONICAL_RECORD_ORDER.map((r, i) => [r, i]));
  const groups: StandingsGroup[] = [...byRecord.entries()]
    .map(([record, entries]) => {
      const { wins, losses } = parseRecord(record);
      return { record, wins, losses, entries };
    })
    .sort((x, y) => {
      const kx = recordOrderKey(x.record, canonicalIndex);
      const ky = recordOrderKey(y.record, canonicalIndex);
      if (kx !== ky) return kx - ky;
      if (x.wins !== y.wins) return y.wins - x.wins;
      if (x.losses !== y.losses) return x.losses - y.losses;
      return x.record.localeCompare(y.record);
    });

  for (const group of groups) {
    sortGroupEntries(group.entries, qualificationRankOf);
    group.entries.forEach((entry, index) => {
      entry.rankWithinGroup = index + 1;
    });
  }

  return {
    groups,
    byTeam,
    issues: settledAll.issues.map((i) => ({ matchId: i.matchId, code: i.code, message: i.message })),
  };
}

/**
 * 组内排序：R 降序 → P 降序 → T 升序 → 排位赛名次升序。
 * 排位赛名次缺失时排在有名次者之后（缺失不是 0，也不是最后一名）。
 */
export function sortGroupEntries(entries: StandingsEntry[], qualificationRankOf: Map<string, number>): void {
  entries.sort((x, y) => {
    const byR = cmp(y.metrics.r, x.metrics.r);
    if (byR !== 0) return byR;
    const byP = cmp(y.metrics.p, x.metrics.p);
    if (byP !== 0) return byP;
    const byT = cmp(x.metrics.t, y.metrics.t);
    if (byT !== 0) return byT;
    return compareQualificationRank(
      qualificationRankOf.get(x.teamId) ?? null,
      qualificationRankOf.get(y.teamId) ?? null,
    );
  });
}

/**
 * 排位赛名次升序；缺失者排在最后，两者都缺失时保持稳定（按 teamId 保证确定性）。
 * 绝不把缺失名次当作 0 或当作最后一名来打破同分。
 */
export function compareQualificationRank(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** 快照序列化所需的辅助：把有理数写入 rankingSnapshot 条目。 */
export function serializeMetric(value: Rational): { n: string; d: string } {
  return { n: value.n.toString(), d: value.d.toString() };
}

/** 从快照条目还原有理数。 */
export function deserializeMetric(value: { n: string; d: string }): Rational {
  return fromSerialized(value.n, value.d);
}

/** 展示两位小数；调用方负责 null → “—” 的呈现。 */
export function displayFixed2(value: Rational): string {
  return toFixed2(value);
}

/** 生成“战绩组 + 组内名次”的稳定标识，例如 "2-0#1"。 */
export function standingsKey(entry: StandingsEntry): string {
  return `${entry.record}#${entry.rankWithinGroup}`;
}

/** 用于调试/展示：把胜场数转成用于指示的颜色语义由 UI 决定，这里只给判定。 */
export function qualificationState(entry: StandingsEntry): 'advanced' | 'eliminated' | 'active' {
  if (entry.wins >= 3) return 'advanced';
  if (entry.losses >= 3) return 'eliminated';
  return 'active';
}

export { fromInt, type TeamScores, type SettledMatch };
