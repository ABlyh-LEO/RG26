/**
 * 全局比赛编号：排位赛 1–44 → 瑞士轮 45–77 → 决赛 78–91。
 *
 * 编号是**派生**的（`domain/match-numbers.ts`），不落库；这里守住三件事：
 * 1. 区间与总数正确、无重复无缺号；
 * 2. 顺序 = 比赛实际发生的顺序（排位赛按轮次与出场顺序、瑞士轮按轮次与组内顺序、
 *    决赛按 `FINALS_MATCH_ORDER`），并且与计划时间不矛盾；
 * 3. 与 `FINALS_NODES` 里写死的决赛编号（78–91）逐场一致——两处若漂移必须报错。
 */
import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema } from '../../src/domain/schema';
import { buildMatchNumbers, matchNumberLabel, matchNumbersFor, MATCH_NUMBER_TOTAL } from '../../src/domain/match-numbers';
import { FINALS_MATCH_ORDER, FINALS_NODES } from '../../src/domain/finals';
import { ROUND_GROUP_ORDER } from '../../src/domain/swiss';

const EVENT = eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));
const NUMBERS = buildMatchNumbers(EVENT);

describe('编号区间与连续性', () => {
  it('共 91 场：排位赛 1–44、瑞士轮 45–77、决赛 78–91', () => {
    expect(NUMBERS.total).toBe(MATCH_NUMBER_TOTAL);
    expect(NUMBERS.total).toBe(91);
    expect(NUMBERS.qualification).toEqual({ first: 1, last: 44, count: 44 });
    expect(NUMBERS.swiss).toEqual({ first: 45, last: 77, count: 33 });
    expect(NUMBERS.finals).toEqual({ first: 78, last: 91, count: 14 });
  });

  it('编号连续无缺号、无重复', () => {
    const values = [...NUMBERS.byId.values()].sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: MATCH_NUMBER_TOTAL }, (_, i) => i + 1));
    expect(new Set(values).size).toBe(values.length);
  });

  it('展示组演出与表演赛没有编号', () => {
    for (const id of ['showcase-final-1', 'showcase-final-2', 'showcase-final-3', 'exhibition']) {
      expect(NUMBERS.byId.get(id), id).toBeUndefined();
      expect(matchNumberLabel(NUMBERS.byId.get(id))).toBeNull();
    }
  });

  it('「第 N 场」文案；没有编号时返回 null', () => {
    expect(matchNumberLabel(1)).toBe('第 1 场');
    expect(matchNumberLabel(91)).toBe('第 91 场');
    expect(matchNumberLabel(undefined)).toBeNull();
    expect(matchNumberLabel(null)).toBeNull();
    expect(matchNumberLabel(0)).toBeNull();
  });
});

describe('编号顺序与赛场顺序一致', () => {
  it('排位赛：第一轮 22 次跑图在前，第二轮接续', () => {
    const runs = EVENT.qualification.runs;
    const firstRound = runs.filter((r) => r.round === 1);
    const secondRound = runs.filter((r) => r.round === 2);
    expect(firstRound).toHaveLength(22);
    expect(secondRound).toHaveLength(22);
    // 第一轮全部排在第二轮之前
    const maxFirst = Math.max(...firstRound.map((r) => NUMBERS.byId.get(r.id)!));
    const minSecond = Math.min(...secondRound.map((r) => NUMBERS.byId.get(r.id)!));
    expect(maxFirst).toBeLessThan(minSecond);
    // 同轮内按出场顺序（三审排名）递增
    const ordered = [...firstRound].sort((a, b) => NUMBERS.byId.get(a.id)! - NUMBERS.byId.get(b.id)!);
    expect(ordered.map((r) => r.teamId)).toEqual([...firstRound].map((r) => r.teamId));
  });

  it('瑞士轮：轮次 → 该轮组顺序 → 组内场次序号', () => {
    const sorted = [...EVENT.swiss.matches].sort((a, b) => NUMBERS.byId.get(a.id)! - NUMBERS.byId.get(b.id)!);
    const expected = [...EVENT.swiss.matches].sort((a, b) => {
      const groupRank = (m: typeof a) => {
        const order = ROUND_GROUP_ORDER[m.roundIndex] ?? [];
        const index = order.indexOf(m.groupRecord);
        return index === -1 ? order.length : index;
      };
      return a.roundIndex - b.roundIndex || groupRank(a) - groupRank(b) || a.orderInGroup - b.orderInGroup;
    });
    expect(sorted.map((m) => m.id)).toEqual(expected.map((m) => m.id));
  });

  it('瑞士轮 R3 的组顺序为 2-0 → 1-1 → 0-2（手册顺序）', () => {
    const r3 = [...EVENT.swiss.matches]
      .filter((m) => m.roundIndex === 3)
      .sort((a, b) => NUMBERS.byId.get(a.id)! - NUMBERS.byId.get(b.id)!);
    expect(r3.map((m) => m.groupRecord)).toEqual([
      '2-0', '2-0', '1-1', '1-1', '1-1', '1-1', '0-2', '0-2',
    ]);
  });

  it('决赛：按 FINALS_MATCH_ORDER，且是最后 14 场', () => {
    const ordered = FINALS_MATCH_ORDER.filter((id) => NUMBERS.byId.has(id));
    expect(ordered).toHaveLength(14);
    expect(ordered.map((id) => NUMBERS.byId.get(id))).toEqual(
      Array.from({ length: 14 }, (_, i) => 78 + i),
    );
    expect(NUMBERS.byId.get('F-M1')).toBe(78);
    expect(NUMBERS.byId.get('F-GF')).toBe(91);
  });

  it('编号与计划时间不矛盾：每个阶段内按编号递增时时间不倒退', () => {
    const scheduleById = new Map(EVENT.scheduleItems.map((item) => [item.id, item]));
    const planned = (scheduleItemId: string): number | null => {
      const item = scheduleById.get(scheduleItemId);
      if (!item) return null;
      const start = Date.parse(item.revisedStart ?? item.plannedStart);
      return Number.isNaN(start) ? null : start;
    };
    const checks: { id: string; at: number | null }[] = [
      ...EVENT.qualification.runs.map((r) => ({ id: r.id, at: planned(r.scheduleItemId) })),
      ...EVENT.swiss.matches.map((m) => ({ id: m.id, at: planned(m.scheduleItemId) })),
      ...EVENT.finals.series
        .filter((s) => s.countsForStandings)
        .map((s) => ({ id: s.id, at: planned(s.scheduleItemId) })),
    ]
      .filter((entry) => entry.at !== null)
      .sort((a, b) => NUMBERS.byId.get(a.id)! - NUMBERS.byId.get(b.id)!);

    for (let i = 1; i < checks.length; i += 1) {
      const previous = checks[i - 1]!;
      const current = checks[i]!;
      // 同一时刻并行的场次（两个场地）允许相等；不允许编号靠后的更早开始。
      expect(
        current.at!,
        `${current.id}（第 ${NUMBERS.byId.get(current.id)} 场）早于 ${previous.id}（第 ${NUMBERS.byId.get(previous.id)} 场）`,
      ).toBeGreaterThanOrEqual(previous.at!);
    }
  });
});

describe('与决赛节点表的一致性', () => {
  it('FINALS_NODES 写死的编号必须与派生结果逐场相同', () => {
    for (const node of FINALS_NODES) {
      const derived = NUMBERS.byId.get(node.id) ?? null;
      expect(derived, `${node.id} 的编号：节点表 ${node.matchNo} / 派生 ${derived}`).toBe(node.matchNo);
    }
  });

  it('同一份 event 缓存同一个索引', () => {
    expect(matchNumbersFor(EVENT)).toBe(matchNumbersFor(EVENT));
    expect(matchNumbersFor(EVENT).total).toBe(MATCH_NUMBER_TOTAL);
  });
});
