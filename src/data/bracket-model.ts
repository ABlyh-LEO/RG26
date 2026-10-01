/**
 * 把领域数据转成列式赛程图所需的 columns + connections。
 *
 * 这是**纯映射**：不重新计算任何赛制规则，
 * 一切以 domain 层的解析结果（finals / standings）为准。
 */
import type { EventFile, Series, SwissMatch } from '../domain/schema';
import type { Standings } from '../domain/standings';
import type { FinalsResolution } from '../domain/finals';
import { FINALS_MATCH_ORDER, FINALS_NODES } from '../domain/finals';
import type { LayoutColumn, LayoutConnection, LayoutNode } from '../domain/bracket-layout';

/* ------------------------------------------------------------------ *
 * 瑞士轮
 * ------------------------------------------------------------------ */

/** 各轮的战绩组展示顺序（与配对顺序一致）。 */
const ROUND_SECTION_ORDER: Record<number, string[]> = {
  1: ['0-0'],
  2: ['1-0', '0-1'],
  3: ['2-0', '1-1', '0-2'],
  4: ['2-1', '1-2'],
  5: ['2-2'],
};

/** 瑞士轮每轮一列，列内按战绩组分区。 */
export function buildSwissColumns(event: EventFile): LayoutColumn[] {
  const rounds = [...event.swiss.rounds].sort((a, b) => a.index - b.index);

  return rounds.map((round) => {
    const matches = round.matchIds
      .map((id) => event.swiss.matches.find((m) => m.id === id))
      .filter((m): m is SwissMatch => m !== undefined);

    const order = ROUND_SECTION_ORDER[round.index] ?? [];
    const sorted = [...matches].sort((a, b) => {
      const oa = order.indexOf(a.groupRecord);
      const ob = order.indexOf(b.groupRecord);
      if (oa !== ob) return (oa < 0 ? 99 : oa) - (ob < 0 ? 99 : ob);
      return a.orderInGroup - b.orderInGroup;
    });

    const nodes: LayoutNode[] = sorted.map((m) => ({ id: m.id, section: m.groupRecord }));

    return {
      key: round.id,
      title: `R${round.index}`,
      nodes,
    };
  });
}

/**
 * 瑞士轮的连线：同一个**队伍**在相邻两轮的位置之间连线。
 *
 * 瑞士轮不是淘汰树（每轮重新配对），因此用"同队跨轮"表示流向，
 * 而不是 winner/loser 关系 —— 这符合实际赛制。
 */
export function buildSwissConnections(event: EventFile): LayoutConnection[] {
  const connections: LayoutConnection[] = [];

  // 队伍 → 它参加过的比赛（按轮次）
  const byTeam = new Map<string, SwissMatch[]>();
  for (const match of event.swiss.matches) {
    const teams = match.participantSnapshot;
    if (!teams) continue;
    for (const teamId of teams) {
      const list = byTeam.get(teamId) ?? [];
      list.push(match);
      byTeam.set(teamId, list);
    }
  }

  for (const list of byTeam.values()) {
    const sorted = [...list].sort((a, b) => a.roundIndex - b.roundIndex);
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const from = sorted[i]!;
      const to = sorted[i + 1]!;
      // 只连相邻轮次，避免跨轮长线
      if (to.roundIndex !== from.roundIndex + 1) continue;
      connections.push({ fromId: from.id, toId: to.id, via: 'winner' });
    }
  }

  return connections;
}

/* ------------------------------------------------------------------ *
 * 决赛
 * ------------------------------------------------------------------ */

/**
 * 决赛按"图深度"分列，而不是按比赛时间。
 *
 * 时间顺序里 F-LSF 与 F-WSF 同处一段时间，但它们在依赖图上属于同一层，
 * 因此放在同一列，连线才是水平流向。
 *
 * **八强首轮的四场必须在同一列。** F-L1A/F-L1B（败者组）与 F-W1A/F-W1B（胜者组）
 * 是同一轮的比赛，且交叉向前喂给败者组第二轮与半决赛：
 *   F-L1B → F-L2A、F-L1A → F-L2B、F-W1A → F-WSF、F-W1B → F-WSF
 * 若把胜者组与败者组拆成左右两列，这四条线就会各自横穿一整列无关卡片，
 * 看起来像"连错了"。合成一列后全部是相邻列连接。
 */
const FINALS_COLUMN_OF: Record<string, { key: string; title: string }> = {
  'F-L1A': { key: 'f-r1', title: '八强赛' },
  'F-L1B': { key: 'f-r1', title: '八强赛' },
  'F-W1A': { key: 'f-r1', title: '八强赛' },
  'F-W1B': { key: 'f-r1', title: '八强赛' },
  'F-L2A': { key: 'f-r2', title: '败者组第二轮' },
  'F-L2B': { key: 'f-r2', title: '败者组第二轮' },
  'F-LSF': { key: 'f-semi', title: '半决赛' },
  'F-WSF': { key: 'f-semi', title: '半决赛' },
  'F-QUAL': { key: 'f-qual', title: '名额争夺战' },
  'F-GF': { key: 'f-gf', title: '总决赛' },
};

/** 决赛各列的展示顺序。 */
const FINALS_COLUMN_ORDER = ['f-r1', 'f-r2', 'f-semi', 'f-qual', 'f-gf'];

/** 决赛列（只含计入排名的系列赛）。 */
export function buildFinalsColumns(event: EventFile): LayoutColumn[] {
  const ranked = event.finals.series.filter(
    (s) => s.countsForStandings && FINALS_MATCH_ORDER.includes(s.id),
  );

  const byColumn = new Map<string, Series[]>();
  for (const s of ranked) {
    const col = FINALS_COLUMN_OF[s.id];
    if (!col) continue;
    const list = byColumn.get(col.key) ?? [];
    list.push(s);
    byColumn.set(col.key, list);
  }

  return FINALS_COLUMN_ORDER.filter((key) => (byColumn.get(key)?.length ?? 0) > 0).map((key) => {
    const series = byColumn.get(key)!;
    // 列内按 FINALS_MATCH_ORDER 排序，保证连线上下关系稳定
    const sorted = [...series].sort(
      (a, b) => FINALS_MATCH_ORDER.indexOf(a.id) - FINALS_MATCH_ORDER.indexOf(b.id),
    );
    const title = FINALS_COLUMN_OF[sorted[0]!.id]!.title;
    return {
      key,
      title,
      nodes: sorted.map((s) => ({ id: s.id, section: null })),
    };
  });
}

/** 决赛连线：直接来自文档定义的 winner/loser 依赖。 */
export function buildFinalsConnections(event: EventFile): LayoutConnection[] {
  const connections: LayoutConnection[] = [];
  const rankedIds = new Set(
    event.finals.series.filter((s) => s.countsForStandings).map((s) => s.id),
  );

  for (const series of event.finals.series) {
    if (!rankedIds.has(series.id)) continue;
    for (const ref of series.slots ?? []) {
      if (ref.kind !== 'winner' && ref.kind !== 'loser') continue;
      if (!rankedIds.has(ref.seriesId)) continue;
      connections.push({ fromId: ref.seriesId, toId: series.id, via: ref.kind });
    }
  }

  return connections;
}

/* ------------------------------------------------------------------ *
 * 组合：排位赛 → 瑞士轮 → 决赛
 * ------------------------------------------------------------------ */

/** 排位赛作为一列（单队跑图，不是对抗）。 */
export function buildQualificationColumn(event: EventFile): LayoutColumn | null {
  const runs = event.qualification.runs;
  if (runs.length === 0) return null;

  // 按三审排名顺序（即出场顺序），而不是按 ID
  const rankOf = new Map(
    event.teams.filter((t) => t.thirdReviewRank !== null).map((t) => [t.id, t.thirdReviewRank!]),
  );
  const sorted = [...runs].sort((a, b) => {
    const ra = rankOf.get(a.teamId) ?? 99;
    const rb = rankOf.get(b.teamId) ?? 99;
    if (ra !== rb) return ra - rb;
    return a.round - b.round;
  });

  return {
    key: 'qualification',
    title: '排位赛',
    nodes: sorted.map((r) => ({ id: r.id, section: r.round === 1 ? '第一轮' : '第二轮' })),
  };
}

export interface BracketModel {
  columns: LayoutColumn[];
  connections: LayoutConnection[];
  /** 是否为淘汰树结构（决定纵向是否按父子居中对齐）。 */
  knockout: boolean;
}

/** 构建决赛图模型。 */
export function buildFinalsModel(event: EventFile): BracketModel {
  return {
    columns: buildFinalsColumns(event),
    connections: buildFinalsConnections(event),
    knockout: true,
  };
}

/** 构建瑞士轮图模型。 */
export function buildSwissModel(event: EventFile): BracketModel {
  return {
    columns: buildSwissColumns(event),
    connections: buildSwissConnections(event),
    // 瑞士轮每轮重新配对，不是淘汰树 → 顺序堆叠，不按父子居中
    knockout: false,
  };
}

/**
 * 构建完整晋级图：瑞士轮 R1–R5 → 决赛。
 *
 * **不含排位赛。** 排位赛是 44 次单队跑图，与瑞士轮没有逐场对应关系。
 * 把它画进来会让一列占掉整张图 80% 的高度（44 张卡 vs 决赛 10 张），
 * 整张图糊成一团、看不到主线。排位赛保留它自己的独立页签。
 *
 * 瑞士轮与决赛**共用同一条纵向带**：两者都是横向推进的阶段，
 * 高度也相当（约 780px vs 324px），并排才能看出"R5 的胜者进入八强"。
 * 用分段把它们上下错开会读成"决赛发生在瑞士轮之后且无关"。
 */
export function buildFullModel(event: EventFile): BracketModel {
  return {
    columns: [...buildSwissColumns(event), ...buildFinalsColumns(event)],
    connections: [...buildSwissConnections(event), ...buildFinalsConnections(event)],
    knockout: false,
  };
}

/** 供 UI 显示的"某节点是否已确定参赛双方"。 */
export function nodeParticipants(
  nodeId: string,
  event: EventFile,
  finals: FinalsResolution,
): { home: string | null; away: string | null; pending: boolean } {
  const swiss = event.swiss.matches.find((m) => m.id === nodeId);
  if (swiss) {
    return {
      home: swiss.participantSnapshot?.[0] ?? null,
      away: swiss.participantSnapshot?.[1] ?? null,
      pending: swiss.participantSnapshot === null,
    };
  }

  const res = finals.series.get(nodeId);
  if (res) {
    return {
      home: res.slots[0].state === 'resolved' ? res.slots[0].teamId : null,
      away: res.slots[1].state === 'resolved' ? res.slots[1].teamId : null,
      pending: res.slots[0].state !== 'resolved' || res.slots[1].state !== 'resolved',
    };
  }

  const run = event.qualification.runs.find((r) => r.id === nodeId);
  if (run) {
    return { home: run.teamId, away: null, pending: false };
  }

  return { home: null, away: null, pending: true };
}

export type { Standings };
export { FINALS_NODES };
