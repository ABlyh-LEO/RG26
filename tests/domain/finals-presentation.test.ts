/**
 * 决赛分区改版的赛制回归：简化画线不能丢失、重复或编造晋级关系。
 * 使用合成赛事，不读取或改写正式赛果。
 */
import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { buildFinalsConnections } from '../../src/data/bracket-model';
import {
  FINAL_ROUNDS,
  FINALS_ZONES,
  finalsIncoming,
  finalsOutgoing,
  finalsZoneOf,
} from '../../src/data/finals-presentation';
import { FINALS_MATCH_ORDER, FINALS_NODES } from '../../src/domain/finals';
import type { EventFile } from '../../src/domain/schema';
import type { LayoutConnection } from '../../src/domain/bracket-layout';

function fixture(): EventFile {
  return buildSeedEvent('2026-10-02T12:00:00+08:00');
}

function edgeKey(edge: LayoutConnection): string {
  return `${edge.fromId}:${edge.via}:${edge.toId}`;
}

function allTransfers(event: EventFile) {
  return event.finals.series.flatMap((series) => finalsOutgoing(event, series.id));
}

describe('决赛分区完整性', () => {
  it('14 场竞技比赛在三个分区内各出现一次，展示演出和表演赛不混入', () => {
    const ids = FINALS_ZONES.flatMap((zone) => zone.columns.flatMap((column) => column.nodes.map((node) => node.id)));
    expect(FINALS_ZONES.map((zone) => zone.id)).toEqual(['winners', 'losers', 'championship']);
    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
    expect([...ids].sort()).toEqual([...FINALS_MATCH_ORDER].sort());
    expect(ids.every((id) => FINALS_NODES.find((node) => node.id === id)?.countsForStandings)).toBe(true);
  });

  it('轮次入口覆盖同一套正式比赛，保留原有轮次深链键', () => {
    expect(FINAL_ROUNDS.map((round) => round.key)).toEqual([
      'f-opening', 'f-r1', 'f-r2', 'f-semi', 'f-qual', 'f-gf',
    ]);
    const ids = FINAL_ROUNDS.flatMap((round) => round.ids);
    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
    expect([...ids].sort()).toEqual([...FINALS_MATCH_ORDER].sort());
  });

  it('首轮留在胜者组，败者组独立，最后两场 BO3 独立展示且没有总决赛重置', () => {
    for (const id of ['F-M1', 'F-M2', 'F-M3', 'F-M4', 'F-W1A', 'F-W1B', 'F-WSF']) {
      expect(finalsZoneOf(id), id).toBe('winners');
    }
    for (const id of ['F-L1A', 'F-L1B', 'F-L2A', 'F-L2B', 'F-LSF']) {
      expect(finalsZoneOf(id), id).toBe('losers');
    }
    const championship = FINALS_ZONES.find((zone) => zone.id === 'championship')!;
    const finalIds = championship.columns.flatMap((column) => column.nodes.map((node) => node.id));
    expect(finalIds).toEqual(['F-QUAL', 'F-GF']);
    expect(finalIds.every((id) => FINALS_NODES.find((node) => node.id === id)?.format === 'BO3')).toBe(true);
    expect(finalsOutgoing(fixture(), 'F-GF')).toEqual([]);
    expect(finalsZoneOf('F-GF-RESET')).toBeUndefined();
  });
});

describe('分区晋级线与跨区来源', () => {
  it('11 条区内胜者连线与 9 条跨区引用恰好覆盖原有 20 条依赖，无丢失或重复', () => {
    const event = fixture();
    const edges = allTransfers(event);
    const local = edges.filter((edge) => finalsZoneOf(edge.fromId) === finalsZoneOf(edge.toId));
    const crossZone = edges.filter((edge) => finalsZoneOf(edge.fromId) !== finalsZoneOf(edge.toId));
    expect(edges).toHaveLength(20);
    expect(new Set(edges.map(edgeKey)).size).toBe(20);
    expect(local).toHaveLength(11);
    expect(local.every((edge) => edge.via === 'winner')).toBe(true);
    expect(crossZone).toHaveLength(9);
    expect(edges.map(edgeKey).sort()).toEqual(buildFinalsConnections(event).map(edgeKey).sort());
  });

  it('跨区落位保持交叉配对，胜者组半决赛双方分别进入总决赛与名额争夺战', () => {
    const crossZone = allTransfers(fixture())
      .filter((edge) => finalsZoneOf(edge.fromId) !== finalsZoneOf(edge.toId));
    expect(crossZone.map(edgeKey).sort()).toEqual([
      'F-M1:loser:F-L1A', 'F-M4:loser:F-L1A',
      'F-M2:loser:F-L1B', 'F-M3:loser:F-L1B',
      'F-W1A:loser:F-L2A', 'F-W1B:loser:F-L2B',
      'F-WSF:loser:F-QUAL', 'F-LSF:winner:F-QUAL',
      'F-WSF:winner:F-GF',
    ].sort());
    expect(finalsIncoming(fixture(), 'F-L2A').map(edgeKey)).toEqual([
      'F-W1A:loser:F-L2A', 'F-L1B:winner:F-L2A',
    ]);
    expect(finalsIncoming(fixture(), 'F-L2B').map(edgeKey)).toEqual([
      'F-W1B:loser:F-L2B', 'F-L1A:winner:F-L2B',
    ]);
  });

  it('每条依赖可从来源与去向双向查到，对外编号使用全局比赛编号', () => {
    const event = fixture();
    for (const edge of allTransfers(event)) {
      expect(finalsIncoming(event, edge.toId)).toContainEqual(edge);
      expect(finalsOutgoing(event, edge.fromId)).toContainEqual(edge);
      const from = FINALS_NODES.find((node) => node.id === edge.fromId)!;
      const to = FINALS_NODES.find((node) => node.id === edge.toId)!;
      expect(edge.fromMatchNo).toBe(from.matchNo);
      expect(edge.toMatchNo).toBe(to.matchNo);
      expect(edge.fromLabel).toBe(from.label);
      expect(edge.toLabel).toBe(to.label);
    }
    // 总决赛（第 91 场）的两个来源：胜者组半决赛（第 88 场）与名额争夺战（第 90 场）
    expect(finalsIncoming(event, 'F-GF').map((edge) => [edge.fromMatchNo, edge.via, edge.toMatchNo])).toEqual([
      [88, 'winner', 91], [90, 'winner', 91],
    ]);
  });

  it('依赖读取实际赛事 slots，而非把展示分区或固定节点表当作新赛果', () => {
    const event = fixture();
    const target = event.finals.series.find((series) => series.id === 'F-L2A')!;
    target.slots = [
      { kind: 'loser', seriesId: 'F-W1B' },
      { kind: 'winner', seriesId: 'F-L1A' },
    ];
    expect(finalsIncoming(event, target.id).map(edgeKey)).toEqual([
      'F-W1B:loser:F-L2A', 'F-L1A:winner:F-L2A',
    ]);
    expect(finalsOutgoing(event, 'F-W1A').some((edge) => edge.toId === target.id)).toBe(false);
  });

  it('来源缺失或不计竞技排名时，不留下无法定位的跨区关系', () => {
    const event = fixture();
    event.finals.series = event.finals.series.filter((series) => series.id !== 'F-W1A');
    const excluded = event.finals.series.find((series) => series.id === 'F-L1A')!;
    excluded.countsForStandings = false;
    const edges = allTransfers(event);
    expect(edges.some((edge) => ['F-W1A', 'F-L1A'].includes(edge.fromId) || ['F-W1A', 'F-L1A'].includes(edge.toId))).toBe(false);
    expect(finalsIncoming(event, 'F-W1A')).toEqual([]);
    expect(finalsOutgoing(event, 'F-L1A')).toEqual([]);
  });

  it('空席位或待公布席位不被补成确定晋级线，首次读取也不改写赛事', () => {
    const event = fixture();
    const target = event.finals.series.find((series) => series.id === 'F-L2A')!;
    target.slots = [{ kind: 'pending', reason: '等待裁判核对' }, { kind: 'pending', reason: '等待公布' }];
    const other = event.finals.series.find((series) => series.id === 'F-L2B')!;
    other.slots = null;
    const original = structuredClone(event);
    expect(finalsIncoming(event, target.id)).toEqual([]);
    expect(finalsIncoming(event, other.id)).toEqual([]);
    allTransfers(event);
    expect(event).toEqual(original);
  });
});
