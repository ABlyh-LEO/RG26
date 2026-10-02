/** 决赛的展示分组。只映射正式依赖，不生成或改变赛制。 */
import { FINALS_NODES } from '../domain/finals';
import type { EventFile } from '../domain/schema';
import type { LayoutColumn } from '../domain/bracket-layout';

export type FinalsZoneId = 'winners' | 'losers' | 'championship';
export interface FinalsZone {
  id: FinalsZoneId;
  title: string;
  description: string;
  columns: LayoutColumn[];
}

const columns = (entries: [string, string, string[]][]): LayoutColumn[] => entries.map(([key, title, ids]) => ({
  key, title, nodes: ids.map((id) => ({ id, section: null })),
}));

/** 固定分区和配对顺序，不采用按开赛时间上下排列的混合布局。 */
export const FINALS_ZONES: readonly FinalsZone[] = [
  {
    id: 'winners', title: '胜者组', description: '从八强首轮出发，胜者沿实线前进；败者按卡片提示转入后续比赛。',
    columns: columns([
      ['f-opening', '八强双败首轮', ['F-M1', 'F-M4', 'F-M2', 'F-M3']],
      ['f-winners', '胜者组', ['F-W1A', 'F-W1B']],
      ['f-winners-semi', '胜者组半决赛', ['F-WSF']],
    ]),
  },
  {
    id: 'losers', title: '败者组', description: '保留最后一次晋级机会。每场败者结束竞技比赛，名次按赛制结算。',
    columns: columns([
      ['f-losers-r1', '败者组首轮', ['F-L1A', 'F-L1B']],
      ['f-losers-r2', '败者组第二轮', ['F-L2B', 'F-L2A']],
      ['f-losers-semi', '败者组半决赛', ['F-LSF']],
    ]),
  },
  {
    id: 'championship', title: '冠军争夺', description: '名额争夺战和总决赛均为 BO3，先胜两局获胜；总决赛不设重置赛。',
    columns: columns([
      ['f-qual', '总决赛名额争夺战 · BO3', ['F-QUAL']],
      ['f-gf', '总决赛 · BO3', ['F-GF']],
    ]),
  },
];

const ZONE_OF = new Map(FINALS_ZONES.flatMap((zone) => zone.columns.flatMap((column) => column.nodes.map((node) => [node.id, zone.id] as const))));

export function finalsZoneOf(id: string): FinalsZoneId | undefined {
  return ZONE_OF.get(id);
}

export const FINAL_ROUNDS: readonly { key: string; title: string; ids: readonly string[] }[] = [
  { key: 'f-opening', title: '双败首轮', ids: ['F-M1', 'F-M2', 'F-M3', 'F-M4'] },
  { key: 'f-r1', title: '胜 / 败者组首轮', ids: ['F-L1A', 'F-L1B', 'F-W1A', 'F-W1B'] },
  { key: 'f-r2', title: '败者组第二轮', ids: ['F-L2A', 'F-L2B'] },
  { key: 'f-semi', title: '胜 / 败者组半决赛', ids: ['F-WSF', 'F-LSF'] },
  { key: 'f-qual', title: '名额争夺战', ids: ['F-QUAL'] },
  { key: 'f-gf', title: '总决赛', ids: ['F-GF'] },
];

export interface FinalsTransfer {
  fromId: string;
  toId: string;
  via: 'winner' | 'loser';
  fromMatchNo: number;
  toMatchNo: number;
  fromLabel: string;
  toLabel: string;
}

function transfers(event: EventFile): FinalsTransfer[] {
  const nodes = new Map(FINALS_NODES.filter((node) => node.matchNo !== null).map((node) => [node.id, node]));
  const present = new Set(event.finals.series.filter((series) => series.countsForStandings).map((series) => series.id));
  return event.finals.series.flatMap((series) => {
    const to = nodes.get(series.id);
    if (!present.has(series.id) || !to || to.matchNo === null) return [];
    const toMatchNo = to.matchNo;
    return (series.slots ?? []).flatMap((slot): FinalsTransfer[] => {
      if (slot.kind !== 'winner' && slot.kind !== 'loser') return [];
      const from = nodes.get(slot.seriesId);
      if (!present.has(slot.seriesId) || !from || from.matchNo === null) return [];
      return [{
        fromId: from.id, toId: to.id, via: slot.kind,
        fromMatchNo: from.matchNo, toMatchNo,
        fromLabel: from.label, toLabel: to.label,
      }];
    });
  });
}

export function finalsIncoming(event: EventFile, id: string): FinalsTransfer[] {
  return transfers(event).filter((transfer) => transfer.toId === id);
}

export function finalsOutgoing(event: EventFile, id: string): FinalsTransfer[] {
  return transfers(event).filter((transfer) => transfer.fromId === id);
}

/** 画布与转移按钮共用同一份依赖划分，避免遗漏或重复表达比赛路线。 */
export function buildFinalsPresentation(event: EventFile): {
  zones: (FinalsZone & { connections: FinalsTransfer[] })[];
  transfers: FinalsTransfer[];
  crossZoneTransfers: FinalsTransfer[];
} {
  const present = new Set(event.finals.series.filter((series) => series.countsForStandings).map((series) => series.id));
  const routes = transfers(event);
  return {
    zones: FINALS_ZONES.map((zone) => ({
      ...zone,
      columns: zone.columns.map((column) => ({ ...column, nodes: column.nodes.filter((node) => present.has(node.id)) })),
      connections: routes.filter((route) => route.via === 'winner' && finalsZoneOf(route.fromId) === zone.id && finalsZoneOf(route.toId) === zone.id),
    })),
    transfers: routes,
    crossZoneTransfers: routes.filter((route) => finalsZoneOf(route.fromId) !== finalsZoneOf(route.toId)),
  };
}
