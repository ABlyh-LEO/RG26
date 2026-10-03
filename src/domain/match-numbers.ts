/**
 * 全局比赛编号：1 起、连续、跨阶段唯一。
 *
 * 顺序 = 比赛实际发生的顺序：
 *
 * | 区间 | 阶段 | 内容 |
 * | --- | --- | --- |
 * | 1–44 | 排位赛 | 第一轮 22 次跑图 → 第二轮 22 次跑图 |
 * | 45–77 | 瑞士轮 | R1 8 → R2 8 → R3 8 → R4 6 → R5 3 |
 * | 78–91 | 决赛 | 八强双败首轮至总决赛共 14 场（`FINALS_MATCH_ORDER`） |
 *
 * **展示组演出（3 场）与赛后表演赛不发编号**：前者是"单独演出"不是比赛，
 * 后者不计竞技排名且开始时间由现场决定（手册：「根据现场情况安排」）。
 *
 * 编号是**派生**的，不落库：赛程固定为 44 + 33 + 14 场，因此编号在整届赛事中稳定——
 * 补录成绩、更正已确认成绩、重赛追加记录、作废后重新公布，都不会改变任何一场的编号。
 *
 * 展示/播报用途：「第 45 场」，见 `matchNumberLabel`。
 */
import { FINALS_MATCH_ORDER } from './finals';
import type { EventFile } from './schema';
import { ROUND_GROUP_ORDER } from './swiss';

/** 全部竞技比赛的场数：44 排位 + 33 瑞士轮 + 14 决赛。 */
export const MATCH_NUMBER_TOTAL = 91;

export interface MatchNumberRange {
  /** 该阶段第一场的编号。 */
  first: number;
  /** 该阶段最后一场的编号。 */
  last: number;
  count: number;
}

export interface MatchNumberIndex {
  total: number;
  /** 比赛 / 跑图 id → 编号。展示组演出与表演赛不在其中。 */
  byId: ReadonlyMap<string, number>;
  qualification: MatchNumberRange;
  swiss: MatchNumberRange;
  finals: MatchNumberRange;
}

/**
 * 计算全局编号。
 *
 * 组内排序完全按赛制与赛程结构，不看结果、不看公布状态：
 * - 排位赛：先第一轮后第二轮，同轮按出场顺序（数据里 runs 的顺序就是三审顺序）。
 * - 瑞士轮：轮次 → 该轮配对组顺序（R2 起 1-0/0-1 等）→ 组内场次序号。
 * - 决赛：`FINALS_MATCH_ORDER`（比赛实际发生顺序），只取计入排名的系列赛。
 */
export function buildMatchNumbers(event: EventFile): MatchNumberIndex {
  const byId = new Map<string, number>();
  let next = 1;

  const take = (ids: readonly string[]): MatchNumberRange => {
    const first = next;
    for (const id of ids) {
      byId.set(id, next);
      next += 1;
    }
    return { first, last: next - 1, count: ids.length };
  };

  const runIndex = new Map(event.qualification.runs.map((run, index) => [run.id, index]));
  const qualification = take(
    [...event.qualification.runs]
      .sort((a, b) => a.round - b.round || (runIndex.get(a.id) ?? 0) - (runIndex.get(b.id) ?? 0))
      .map((run) => run.id),
  );

  const groupRank = (roundIndex: number, record: string): number => {
    const order = ROUND_GROUP_ORDER[roundIndex] ?? [];
    const index = order.indexOf(record);
    return index === -1 ? order.length : index;
  };
  const swiss = take(
    [...event.swiss.matches]
      .sort(
        (a, b) =>
          a.roundIndex - b.roundIndex ||
          groupRank(a.roundIndex, a.groupRecord) - groupRank(b.roundIndex, b.groupRecord) ||
          a.orderInGroup - b.orderInGroup,
      )
      .map((match) => match.id),
  );

  const present = new Set(event.finals.series.map((series) => series.id));
  const finals = take(FINALS_MATCH_ORDER.filter((id) => present.has(id)));

  return { total: byId.size, byId, qualification, swiss, finals };
}

/**
 * 同一份 event 只算一次。
 *
 * 比赛视图是逐个构造的（赛程页、总览页、队伍页各调一次），逐场重算是浪费；
 * 这里按 event 对象缓存。维护端每次都产生新的 event 对象，因此不会读到旧编号。
 */
const cache = new WeakMap<EventFile, MatchNumberIndex>();

export function matchNumbersFor(event: EventFile): MatchNumberIndex {
  const hit = cache.get(event);
  if (hit) return hit;
  const built = buildMatchNumbers(event);
  cache.set(event, built);
  return built;
}

/** 编号 → 「第 N 场」；没有编号（展示演出 / 表演赛）时为 null。 */
export function matchNumberLabel(no: number | null | undefined): string | null {
  return typeof no === 'number' && Number.isInteger(no) && no > 0 ? `第 ${no} 场` : null;
}

/** 比赛 id → 「第 N 场」；未编号时为 null。 */
export function matchNumberLabelOf(event: EventFile, matchId: string): string | null {
  return matchNumberLabel(matchNumbersFor(event).byId.get(matchId));
}
