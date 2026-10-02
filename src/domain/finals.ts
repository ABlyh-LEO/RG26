/**
 * 决赛：八强种子、固定对阵图、BO3 与奖项（docs/IMPLEMENTATION_PLAN.md 第 5.5 节、第 4.3 节）。
 *
 * 关键约束：
 * - 采用文档定义的固定图，绝不套用通用双败库的默认赛程。
 * - 文档没有总决赛重置：F-GF 只打一组 BO3。
 * - BO3 先赢 2 局即结束；2-0 后第三局标为“不需要进行”，不能当作 0-0 未完赛。
 * - 系列赛尚未产生胜者时不得向下游推进。
 * - 不为并列奖项编造精确第 5–8 名。
 */
import type { FinalsSeed, FinalsSeeding, Series, SlotRef, SwissMatch } from './schema';
import type { Standings } from './standings';

/* ------------------------------------------------------------------ *
 * 固定对阵图（第 4.3 节）
 * ------------------------------------------------------------------ */

export interface FinalsNodeSpec {
  id: string;
  format: 'BO1' | 'BO2' | 'BO3';
  stage: 'finals' | 'showcase';
  countsForStandings: boolean;
  /** 展示演出与表演赛没有两两对抗，为 null。 */
  slots: [SlotRef, SlotRef] | null;
  /** UI 使用的中文简明名称。 */
  label: string;
  /**
   * 决赛场次序号（1 起，按**实际比赛顺序**）。
   *
   * 这是给观众看的编号，用来替代 `F-W1B 败者` 这类内部 ID 写法：
   * 「第 5 场败者」比「F-W1B 败者」好读得多，而且在赛程表上能对得上。
   * 展示演出与表演赛不属于竞技赛程，为 null。
   */
  matchNo: number | null;
  /** 展示组演出对应的编号（竞技组为 null）。 */
  showcaseOrder: number | null;
}

export const FINALS_NODES: readonly FinalsNodeSpec[] = [
  { id: 'F-M1', format: 'BO1', stage: 'finals', countsForStandings: true,
    slots: [{ kind: 'finals-seed', seed: 'W1' }, { kind: 'finals-seed', seed: 'L1' }],
    label: '八强双败首轮 · 第 1 名对第 5 名', matchNo: 1, showcaseOrder: null },
  { id: 'F-M2', format: 'BO1', stage: 'finals', countsForStandings: true,
    slots: [{ kind: 'finals-seed', seed: 'W2' }, { kind: 'finals-seed', seed: 'L2' }],
    label: '八强双败首轮 · 第 2 名对第 6 名', matchNo: 2, showcaseOrder: null },
  { id: 'F-M3', format: 'BO1', stage: 'finals', countsForStandings: true,
    slots: [{ kind: 'finals-seed', seed: 'W3' }, { kind: 'finals-seed', seed: 'L3' }],
    label: '八强双败首轮 · 第 3 名对第 7 名', matchNo: 3, showcaseOrder: null },
  { id: 'F-M4', format: 'BO1', stage: 'finals', countsForStandings: true,
    slots: [{ kind: 'finals-seed', seed: 'W4' }, { kind: 'finals-seed', seed: 'L4' }],
    label: '八强双败首轮 · 第 4 名对第 8 名', matchNo: 4, showcaseOrder: null },
  {
    id: 'F-L1A',
    format: 'BO1',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'loser', seriesId: 'F-M1' },
      { kind: 'loser', seriesId: 'F-M4' },
    ],
    label: '八强败者组首轮 A',
    matchNo: 5,
    showcaseOrder: null,
  },
  {
    id: 'F-L1B',
    format: 'BO1',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'loser', seriesId: 'F-M2' },
      { kind: 'loser', seriesId: 'F-M3' },
    ],
    label: '八强败者组首轮 B',
    matchNo: 6,
    showcaseOrder: null,
  },
  {
    id: 'F-W1A',
    format: 'BO1',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'winner', seriesId: 'F-M1' },
      { kind: 'winner', seriesId: 'F-M4' },
    ],
    label: '八强胜者组 A',
    matchNo: 7,
    showcaseOrder: null,
  },
  {
    id: 'F-W1B',
    format: 'BO1',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'winner', seriesId: 'F-M2' },
      { kind: 'winner', seriesId: 'F-M3' },
    ],
    label: '八强胜者组 B',
    matchNo: 8,
    showcaseOrder: null,
  },
  {
    id: 'F-L2A',
    format: 'BO1',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'loser', seriesId: 'F-W1A' },
      { kind: 'winner', seriesId: 'F-L1B' },
    ],
    label: '败者组第二轮 A',
    matchNo: 9,
    showcaseOrder: null,
  },
  {
    id: 'F-L2B',
    format: 'BO1',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'loser', seriesId: 'F-W1B' },
      { kind: 'winner', seriesId: 'F-L1A' },
    ],
    label: '败者组第二轮 B',
    matchNo: 10,
    showcaseOrder: null,
  },
  {
    id: 'F-WSF',
    format: 'BO1',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'winner', seriesId: 'F-W1A' },
      { kind: 'winner', seriesId: 'F-W1B' },
    ],
    label: '半决赛胜者组',
    matchNo: 11,
    showcaseOrder: null,
  },
  {
    id: 'F-LSF',
    format: 'BO1',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'winner', seriesId: 'F-L2A' },
      { kind: 'winner', seriesId: 'F-L2B' },
    ],
    label: '半决赛败者组',
    matchNo: 12,
    showcaseOrder: null,
  },
  {
    id: 'F-QUAL',
    format: 'BO3',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'winner', seriesId: 'F-LSF' },
      { kind: 'loser', seriesId: 'F-WSF' },
    ],
    label: '总决赛名额争夺战',
    matchNo: 13,
    showcaseOrder: null,
  },
  {
    id: 'F-GF',
    format: 'BO3',
    stage: 'finals',
    countsForStandings: true,
    slots: [
      { kind: 'winner', seriesId: 'F-WSF' },
      { kind: 'winner', seriesId: 'F-QUAL' },
    ],
    label: '总决赛',
    matchNo: 14,
    showcaseOrder: null,
  },
  {
    id: 'showcase-final-1',
    format: 'BO2',
    stage: 'showcase',
    countsForStandings: false,
    slots: null,
    label: '展示组正式演出（抽签第 1 队）',
    matchNo: null,
    showcaseOrder: 1,
  },
  {
    id: 'showcase-final-2',
    format: 'BO2',
    stage: 'showcase',
    countsForStandings: false,
    slots: null,
    label: '展示组正式演出（抽签第 2 队）',
    matchNo: null,
    showcaseOrder: 2,
  },
  {
    id: 'showcase-final-3',
    format: 'BO2',
    stage: 'showcase',
    countsForStandings: false,
    slots: null,
    label: '展示组正式演出（抽签第 3 队）',
    matchNo: null,
    showcaseOrder: 3,
  },
  {
    id: 'exhibition',
    format: 'BO2',
    stage: 'finals',
    countsForStandings: false,
    slots: null,
    label: '表演赛',
    matchNo: null,
    showcaseOrder: null,
  },
] as const;

/**
 * 只包含竞技组决赛的节点，按比赛**实际发生顺序**排列
 * （用于手机纵向视图与场次序号）。
 *
 * 半决赛的次序按新版赛程手册：**胜者组先行、败者组随后**
 * （16:15~16:35「先进行半决赛胜者组 BO1，而后进行半决赛败者组 BO1」）。
 * 注意这只是**发生顺序**：两者的依赖关系没有变 ——
 * 名额争夺战仍是「半决赛败者组胜者 vs 半决赛胜者组败者」。
 */
export const FINALS_MATCH_ORDER: readonly string[] = [
  'F-M1', 'F-M2', 'F-M3', 'F-M4',
  'F-L1A',
  'F-L1B',
  'F-W1A',
  'F-W1B',
  'F-L2A',
  'F-L2B',
  'F-WSF',
  'F-LSF',
  'F-QUAL',
  'F-GF',
] as const;
/* ------------------------------------------------------------------ *
 * 种子分配（第 5.5 节）
 * ------------------------------------------------------------------ */

/** schema v1 兼容键，依次表示八强排名1–8；下午分组必须由上午胜负决定。 */
export const FINALS_SEED_ORDER: readonly FinalsSeed[] = ['W1', 'W2', 'W3', 'W4', 'L1', 'L2', 'L3', 'L4'];
export function finalsSeedLabel(seed: FinalsSeed): string { return `八强第 ${FINALS_SEED_ORDER.indexOf(seed) + 1} 名`; }

export interface SeedingResult {
  seeds: Partial<Record<FinalsSeed, string>>;
  /** 阻断性问题：缺少必要战绩组时不得公布种子。 */
  blockers: string[];
}

/**
 * 从最终瑞士轮排名分配 W1–W4 / L1–L4。
 *
 * - 3-0 组前两队：W1、W2
 * - 3-1 组前两队：W3、W4；该组第三队：L1
 * - 3-2 组三队：L2、L3、L4
 *
 * 必须使用 R5 结算后的最终数据；3-0 队伍不能在其历史对手未完赛时提前锁定 W1/W2。
 */
export function assignFinalsSeeds(standings: Standings): SeedingResult {
  const blockers: string[] = [];
  const seeds: Partial<Record<FinalsSeed, string>> = {};

  const group = (record: string) => standings.groups.find((g) => g.record === record)?.entries ?? [];

  const g30 = group('3-0');
  const g31 = group('3-1');
  const g32 = group('3-2');

  if (g30.length < 2) blockers.push(`3-0 组只有 ${g30.length} 队，预期 2 队，无法确定 W1/W2`);
  if (g31.length < 3) blockers.push(`3-1 组只有 ${g31.length} 队，预期 3 队，无法确定 W3/W4/L1`);
  if (g32.length < 3) blockers.push(`3-2 组只有 ${g32.length} 队，预期 3 队，无法确定 L2/L3/L4`);

  const assign = (seed: FinalsSeed, entryIndex: number, entries: typeof g30) => {
    const entry = entries[entryIndex];
    if (entry) seeds[seed] = entry.teamId;
  };

  assign('W1', 0, g30);
  assign('W2', 1, g30);
  assign('W3', 0, g31);
  assign('W4', 1, g31);
  assign('L1', 2, g31);
  assign('L2', 0, g32);
  assign('L3', 1, g32);
  assign('L4', 2, g32);

  return { seeds, blockers };
}

/** 从落库的 seeding 记录读取种子映射。 */
export function seedingToMap(seeding: FinalsSeeding | null): Partial<Record<FinalsSeed, string>> {
  if (!seeding) return {};
  return { ...seeding.seeds };
}

/* ------------------------------------------------------------------ *
 * 系列赛解析
 * ------------------------------------------------------------------ */

export type SlotResolution =
  | { state: 'resolved'; teamId: string }
  | { state: 'pending'; label: string }
  | { state: 'conflict'; label: string; reason: string };

export interface SeriesResolution {
  id: string;
  format: 'BO1' | 'BO2' | 'BO3';
  label: string;
  countsForStandings: boolean;
  slots: [SlotResolution, SlotResolution];
  /** 有效且已确认的小局。 */
  playedGames: number;
  homeWins: number;
  awayWins: number;
  /** 系列赛是否已决出胜者。 */
  decided: boolean;
  winnerId: string | null;
  loserId: string | null;
  /** 未进行的局是否应标记为“不需要进行”。 */
  notNeededGameIndexes: number[];
  /** 依赖冲突说明。 */
  conflicts: string[];
}

export interface FinalsResolution {
  series: Map<string, SeriesResolution>;
  /** 奖项归属。 */
  awards: Awards;
  conflicts: string[];
}

export interface Awards {
  champion: string | null;
  runnerUp: string | null;
  third: string | null;
  /** 四强（半决赛败者，不含季军）。 */
  topFour: string[];
  /** 八强（败者组首轮与败者组第二轮败者）。 */
  topEight: string[];
  /** 十六强（瑞士轮淘汰者），由 Swiss 阶段结算，这里只透传。 */
  topSixteen: string[];
  /** 优秀奖（排位赛 17–22），由 Qualification 阶段结算，这里只透传。 */
  honorableMention: string[];
}

const EMPTY_AWARDS: Awards = {
  champion: null,
  runnerUp: null,
  third: null,
  topFour: [],
  topEight: [],
  topSixteen: [],
  honorableMention: [],
};

/**
 * 决赛场次序号 → 「第 N 场」的显示文本。
 *
 * 对观众只说"第 5 场败者"，不说 `F-L2A 败者`：后者是内部 ID，
 * 在赛程表上也找不到对应。
 */
export function finalsMatchNoLabel(seriesId: string): string | null {
  const node = FINALS_NODES.find((n) => n.id === seriesId);
  return node?.matchNo ? `第 ${node.matchNo} 场` : null;
}

/**
 * 未确定席位的显示文本。
 *
 * **绝不出现内部 ID。** `winner`/`loser` 一律翻译成「第 N 场胜者／败者」；
 * 万一查不到序号（数据异常），退回中性的「上一场胜者／败者」，
 * 也不把 `F-XXXX` 漏给观众。
 */
function placeholderLabel(ref: SlotRef): string {
  switch (ref.kind) {
    case 'team':
      return ref.teamId.startsWith('__') ? '待定' : ref.teamId;
    case 'qualification-rank':
      return `排位赛第 ${ref.rank} 名`;
    case 'finals-seed':
      return finalsSeedLabel(ref.seed);
    case 'winner': {
      const no = finalsMatchNoLabel(ref.seriesId);
      return no ? `${no}胜者` : '上一场胜者';
    }
    case 'loser': {
      const no = finalsMatchNoLabel(ref.seriesId);
      return no ? `${no}败者` : '上一场败者';
    }
    case 'pending':
      return ref.reason;
  }
}

/**
 * 解析一个槽位。
 *
 * 已保存 participantSnapshot 的比赛，快照即为事实：依赖变化只触发不一致提示，
 * 绝不自动把已经发生的比赛重新解释成另一支队伍。
 */
function resolveSlot(
  ref: SlotRef,
  seriesId: string,
  slotIndex: number,
  seriesList: readonly Series[],
  seeds: Partial<Record<FinalsSeed, string>>,
  resolutions: Map<string, SeriesResolution>,
  conflicts: string[],
): SlotResolution {
  const self = seriesList.find((s) => s.id === seriesId);
  const snapshot = self?.participantSnapshot?.[slotIndex] ?? null;

  const fromRef = (): SlotResolution => {
    switch (ref.kind) {
      case 'team':
        return ref.teamId.startsWith('__')
          ? { state: 'pending', label: placeholderLabel(ref) }
          : { state: 'resolved', teamId: ref.teamId };
      case 'qualification-rank':
        return { state: 'pending', label: placeholderLabel(ref) };
      case 'finals-seed': {
        const teamId = seeds[ref.seed];
        return teamId ? { state: 'resolved', teamId } : { state: 'pending', label: finalsSeedLabel(ref.seed) };
      }
      case 'winner':
      case 'loser': {
        const upstream = resolutions.get(ref.seriesId);
        if (!upstream) return { state: 'pending', label: placeholderLabel(ref) };
        if (!upstream.decided) return { state: 'pending', label: placeholderLabel(ref) };
        if (upstream.conflicts.length > 0) {
          return { state: 'conflict', label: placeholderLabel(ref), reason: upstream.conflicts.join('；') };
        }
        const teamId = ref.kind === 'winner' ? upstream.winnerId : upstream.loserId;
        if (!teamId) return { state: 'pending', label: placeholderLabel(ref) };
        return { state: 'resolved', teamId };
      }
      case 'pending':
        // 尚未确定：直接给出"在等什么"，不编造具体名次。
        return { state: 'pending', label: ref.reason };
    }
  };

  const resolved = fromRef();

  // 快照优先：如果已经保存了实际参赛队伍，就以快照为准，并把不一致报为冲突。
  if (snapshot) {
    if (resolved.state === 'resolved' && resolved.teamId !== snapshot) {
      const reason = `${seriesId} 的第 ${slotIndex + 1} 号位已记录参赛队伍 ${snapshot}，但依赖解析为 ${resolved.teamId}；保持已发生的比赛记录并需要组委会处置`;
      conflicts.push(reason);
      return { state: 'conflict', label: placeholderLabel(ref), reason };
    }
    if (resolved.state === 'conflict') return resolved;
    return { state: 'resolved', teamId: snapshot };
  }

  // 依赖已决出但与快照不符且下游已开赛：不静默改写。
  if (self && self.executionStatus === 'running' || (self && self.executionStatus === 'finished')) {
    if (resolved.state === 'resolved') return resolved;
  }
  return resolved;
}

/** BO3/BO2 需要打赢几局。 */
export function requiredWins(format: 'BO1' | 'BO2' | 'BO3'): number {
  if (format === 'BO1') return 1;
  if (format === 'BO2') return 2;
  return 2;
}

/** 该赛制最多打几局。 */
export function maxGames(format: 'BO1' | 'BO2' | 'BO3'): number {
  if (format === 'BO1') return 1;
  return format === 'BO2' ? 2 : 3;
}

/**
 * 结算一个系列赛的小局。
 * 只统计 resultStatus === 'confirmed' 且有明确胜者的小局。
 */
export function resolveSeriesGames(series: Series): {
  homeWins: number;
  awayWins: number;
  playedGames: number;
  decided: boolean;
  winnerId: string | null;
  loserId: string | null;
  notNeeded: number[];
} {
  const need = requiredWins(series.format);
  let homeWins = 0;
  let awayWins = 0;
  let playedGames = 0;
  let winnerId: string | null = null;

  const ordered = [...series.games].sort((a, b) => a.index - b.index);
  for (const game of ordered) {
    // 系列赛已决出后，后续局一律视为“不需要进行”，且不参与统计。
    if (winnerId !== null) continue;
    if (game.resultStatus !== 'confirmed' || game.winnerId === null) continue;
    playedGames += 1;
    if (game.winnerId === game.homeTeamId) homeWins += 1;
    else if (game.winnerId === game.awayTeamId) awayWins += 1;
    else continue; // 胜者不是参赛双方：不计入，由校验报错
    if (homeWins >= need || awayWins >= need) {
      winnerId = homeWins >= need ? game.homeTeamId : game.awayTeamId;
    }
  }

  /*
   * 表演赛（BO2）在本系统里按**活动**处理，不进录入队列，也不结算胜负；
   * 所有真正录入的已确认小局都要求有明确胜者（校验与 schema 都会拦住无胜者的
   * 已确认小局），因此这里不再假定"BO2 允许平局"。
   */
  const total = maxGames(series.format);
  const notNeeded: number[] = [];
  if (winnerId !== null && playedGames < total) {
    for (let i = playedGames + 1; i <= total; i += 1) notNeeded.push(i);
  }

  const snapshot = series.participantSnapshot;
  const homeId = snapshot?.[0] ?? null;
  const awayId = snapshot?.[1] ?? null;
  const loserId = winnerId === null ? null : winnerId === homeId ? awayId : homeId;

  return { homeWins, awayWins, playedGames, decided: winnerId !== null, winnerId, loserId, notNeeded };
}

/**
 * 沿 winner/loser 依赖图解析全部决赛系列赛。
 * 采用拓扑顺序（FINALS_MATCH_ORDER 已是拓扑序）单遍解析。
 */
export function resolveFinals(
  seriesList: readonly Series[],
  seeding: FinalsSeeding | null,
  extras: Partial<Pick<Awards, 'topSixteen' | 'honorableMention'>> = {},
): FinalsResolution {
  const seeds = seedingToMap(seeding);
  const resolutions = new Map<string, SeriesResolution>();
  const conflicts: string[] = [];

  const byId = new Map(seriesList.map((s) => [s.id, s]));

  for (const nodeId of FINALS_MATCH_ORDER) {
    const node = FINALS_NODES.find((n) => n.id === nodeId);
    const series = byId.get(nodeId);
    if (!node || !series) continue;
    resolveOne(node, series, seriesList, seeds, resolutions, conflicts);
  }

  // 展示组与表演赛不属于依赖图，单独解析（无 winner/loser 引用）。
  for (const node of FINALS_NODES) {
    if (FINALS_MATCH_ORDER.includes(node.id)) continue;
    const series = byId.get(node.id);
    if (!series) continue;
    resolveOne(node, series, seriesList, seeds, resolutions, conflicts);
  }

  const awards = computeAwards(resolutions, extras);

  return { series: resolutions, awards, conflicts };
}

function resolveOne(
  node: FinalsNodeSpec,
  series: Series,
  seriesList: readonly Series[],
  seeds: Partial<Record<FinalsSeed, string>>,
  resolutions: Map<string, SeriesResolution>,
  conflicts: string[],
): void {
  const localConflicts: string[] = [];
  // 展示演出与表演赛没有对阵双方：两个槽位都是“不适用”。
  const slots: [SlotResolution, SlotResolution] = node.slots
    ? [
        resolveSlot(node.slots[0], node.id, 0, seriesList, seeds, resolutions, localConflicts),
        resolveSlot(node.slots[1], node.id, 1, seriesList, seeds, resolutions, localConflicts),
      ]
    : [
        { state: 'pending', label: '不适用' },
        { state: 'pending', label: '不适用' },
      ];

  const games = resolveSeriesGames(series);

  // 尚未产生胜者时不得向下游推进。
  if (slots[0].state === 'resolved' && slots[1].state === 'resolved' && slots[0].teamId === slots[1].teamId) {
    localConflicts.push(`${node.id} 的两个槽位解析为同一支队伍 ${slots[0].teamId}`);
  }

  conflicts.push(...localConflicts);
  resolutions.set(node.id, {
    id: node.id,
    format: series.format,
    label: node.label,
    countsForStandings: node.countsForStandings,
    slots,
    playedGames: games.playedGames,
    homeWins: games.homeWins,
    awayWins: games.awayWins,
    decided: games.decided,
    winnerId: games.winnerId,
    loserId: games.loserId,
    notNeededGameIndexes: games.notNeeded,
    conflicts: localConflicts,
  });
}

/**
 * 奖项结算（第 5.5 节）。
 * - F-L1A/F-L1B 败者 及 F-L2A/F-L2B 败者 → 八强
 * - F-LSF 败者 → 四强
 * - F-QUAL 败者 → 季军；F-GF 败者 → 亚军、胜者 → 冠军
 * 不为并列奖项编造精确第 5–8 名。
 */
export function computeAwards(
  resolutions: Map<string, SeriesResolution>,
  extras: Partial<Pick<Awards, 'topSixteen' | 'honorableMention'>> = {},
): Awards {
  const loserOf = (id: string): string | null => {
    const r = resolutions.get(id);
    if (!r || !r.decided) return null;
    return r.loserId;
  };
  const winnerOf = (id: string): string | null => {
    const r = resolutions.get(id);
    if (!r || !r.decided) return null;
    return r.winnerId;
  };

  const topEight = [
    loserOf('F-L1A'),
    loserOf('F-L1B'),
    loserOf('F-L2A'),
    loserOf('F-L2B'),
  ].filter((v): v is string => v !== null);

  const topFourLoser = loserOf('F-LSF');

  return {
    champion: winnerOf('F-GF'),
    runnerUp: loserOf('F-GF'),
    third: loserOf('F-QUAL'),
    topFour: topFourLoser ? [topFourLoser] : [],
    topEight,
    topSixteen: extras.topSixteen ?? [],
    honorableMention: extras.honorableMention ?? [],
  };
}

/**
 * 图的静态校验：拒绝循环、未知来源、自我对阵、不存在的系列赛。
 * 在初始化与导入时都要跑。
 *
 * **展示组（`stage === 'showcase'`）是单独演出，不是两队对阵**：
 * 它没有"双方"，因此不适用自我对阵检查（见下方第 3、4 条）。
 */
export function validateFinalsGraph(seriesList: readonly Series[]): string[] {
  const errors: string[] = [];
  const ids = new Set(seriesList.map((s) => s.id));
  /** 单独演出：登记的是演出队伍，不存在对阵双方。 */
  const isPerformance = (series: Series): boolean => series.stage === 'showcase';

  // 1. 未知来源
  for (const series of seriesList) {
    for (const ref of series.slots ?? []) {
      if ((ref.kind === 'winner' || ref.kind === 'loser') && !ids.has(ref.seriesId)) {
        errors.push(`${series.id} 引用了不存在的系列赛 ${ref.seriesId}`);
      }
    }
  }

  // 2. 循环 / 自我引用：对有向依赖做 DFS
  const deps = new Map<string, string[]>();
  for (const series of seriesList) {
    const list = (series.slots ?? []).flatMap((r) => (r.kind === 'winner' || r.kind === 'loser' ? [r.seriesId] : []));
    deps.set(series.id, list);
    if (list.includes(series.id)) errors.push(`${series.id} 依赖自己`);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);

  const visit = (id: string, stack: string[]): void => {
    color.set(id, GRAY);
    for (const dep of deps.get(id) ?? []) {
      if (!ids.has(dep)) continue;
      const c = color.get(dep);
      if (c === GRAY) {
        errors.push(`决赛依赖存在循环：${[...stack, id, dep].join(' → ')}`);
        continue;
      }
      if (c === WHITE) visit(dep, [...stack, id]);
    }
    color.set(id, BLACK);
  };
  for (const id of ids) if (color.get(id) === WHITE) visit(id, []);

  // 3. 自我对阵（同一槽位来源重复）—— 单独演出没有双方，跳过
  for (const series of seriesList) {
    if (isPerformance(series)) continue;
    if (!series.slots) continue;
    const [a, b] = series.slots;
    if (JSON.stringify(a) === JSON.stringify(b)) {
      errors.push(`${series.id} 的两个槽位来源完全相同，构成自我对阵`);
    }
  }

  // 4. 实际参赛快照上的自我对阵 —— 单独演出没有"参赛双方"，跳过
  for (const series of seriesList) {
    if (isPerformance(series)) continue;
    const snap = series.participantSnapshot;
    if (snap && snap[0] === snap[1]) {
      errors.push(`${series.id} 的参赛快照中出现自我对阵：${snap[0]}`);
    }
  }

  return errors;
}

/** 瑞士轮淘汰者（1-3 与 0-3）即“十六强”。 */
export function swissEliminatedTeams(standings: Standings): string[] {
  return standings.groups
    .filter((g) => g.wins < 3 && g.losses >= 3)
    .flatMap((g) => g.entries.map((e) => e.teamId));
}

/** 由瑞士轮排名导出决赛所需的 extra 奖项数据。 */
export function deriveExtras(
  standings: Standings,
  qualificationOrderedTeamIds: readonly string[],
): Pick<Awards, 'topSixteen' | 'honorableMention'> {
  return {
    topSixteen: swissEliminatedTeams(standings),
    // 排位赛第 17–22 名为优秀奖。
    honorableMention: qualificationOrderedTeamIds.slice(16),
  };
}

export { EMPTY_AWARDS };
export type { SwissMatch };
