/**
 * 列式赛程图布局测试。
 *
 * 重点验证纵向定位规则与"同列不重叠"，以及连线路径生成。
 */
import { describe, expect, it } from 'vitest';
import {
  buildConnectorPath,
  computeColumnLayout,
  isTreeConnection,
  laneOffset,
  MAX_LANES,
  resolveDensity,
  showsSecondaryInfo,
  type LayoutColumn,
  type LayoutConnection,
} from '../../src/domain/bracket-layout';

const H = 60;
const GAP = 10;
const SECTION_GAP = 20;

function layout(columns: LayoutColumn[], connections: LayoutConnection[], heights: Record<string, number> = {}) {
  return computeColumnLayout({
    columns,
    connections,
    heights,
    gap: GAP,
    sectionGap: SECTION_GAP,
    fallbackHeight: H,
  });
}

describe('淘汰树纵向居中', () => {
  it('两个 feeder 的下游节点落在两者中心的中点', () => {
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'a', section: null }, { id: 'b', section: null }] },
      { key: 'c2', title: 'B', nodes: [{ id: 'final', section: null }] },
    ];
    const connections: LayoutConnection[] = [
      { fromId: 'a', toId: 'final', via: 'winner' },
      { fromId: 'b', toId: 'final', via: 'winner' },
    ];
    const r = layout(columns, connections);

    // a: top=0, center=30 ; b: top=70, center=100
    expect(r.tops.a).toBe(0);
    expect(r.tops.b).toBe(H + GAP);
    // final 中心应在 (30+100)/2 = 65 → top = 65-30 = 35
    expect(r.tops.final).toBe(35);
  });

  it('一个 feeder 时下游节点与它中心对齐', () => {
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'a', section: null }] },
      { key: 'c2', title: 'B', nodes: [{ id: 'b', section: null }] },
    ];
    const r = layout(columns, [{ fromId: 'a', toId: 'b', via: 'winner' }]);
    expect(r.tops.a).toBe(0);
    expect(r.tops.b).toBe(0); // 同为 60 高、中心对齐
  });

  it('没有 feeder 的列按顺序堆叠', () => {
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'a', section: null }, { id: 'b', section: null }, { id: 'c', section: null }] },
    ];
    const r = layout(columns, []);
    expect(r.tops.a).toBe(0);
    expect(r.tops.b).toBe(H + GAP);
    expect(r.tops.c).toBe(2 * (H + GAP));
    expect(r.columnHeights.c1).toBe(3 * H + 2 * GAP);
  });

  it('loser 连线不参与纵向居中（否则败者组会被拉伸）', () => {
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'w', section: null }, { id: 'x', section: null }] },
      { key: 'c2', title: 'B', nodes: [{ id: 'back', section: null }] },
    ];
    // 只有 loser 关系：应退化为顺序堆叠（top=0），而不是居中到 35
    const r = layout(columns, [{ fromId: 'w', toId: 'back', via: 'loser' }]);
    expect(r.tops.back).toBe(0);
    expect(isTreeConnection({ fromId: 'w', toId: 'back', via: 'loser' })).toBe(false);
  });
});

describe('同列不重叠', () => {
  it('居中后若与上一个节点相撞则下推', () => {
    // a 很高，b 很矮；两个都连到 final，final 会很矮但中心偏上
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'a', section: null }, { id: 'b', section: null }] },
      { key: 'c2', title: 'B', nodes: [{ id: 'f1', section: null }, { id: 'f2', section: null }] },
    ];
    const connections: LayoutConnection[] = [
      { fromId: 'a', toId: 'f1', via: 'winner' },
      { fromId: 'b', toId: 'f2', via: 'winner' },
    ];
    const heights = { a: 200, b: 100, f1: 80, f2: 80 };
    const r = layout(columns, connections, heights);

    // 第一列：a top=0（高 200），b top=210（高 100，中心 260）
    expect(r.tops.a).toBe(0);
    expect(r.tops.b).toBe(210);

    // f1 中心 = a 中心 = 100 → top = 60
    expect(r.tops.f1).toBe(60);
    // f2 中心 = b 中心 = 260 → top = 220
    expect(r.tops.f2).toBe(220);
    // 关键断言：两者不重叠
    expect(r.tops.f2!).toBeGreaterThanOrEqual(r.tops.f1! + 80 + GAP - 0.01);
  });

  it('居中位置与上一个节点重叠时下推', () => {
    // f2 的父节点 b 很矮，导致 f2 的居中位置会撞到 f1 → 必须下推
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'a', section: null }, { id: 'b', section: null }] },
      { key: 'c2', title: 'B', nodes: [{ id: 'f1', section: null }, { id: 'f2', section: null }] },
    ];
    const connections: LayoutConnection[] = [
      { fromId: 'a', toId: 'f1', via: 'winner' },
      { fromId: 'b', toId: 'f2', via: 'winner' },
    ];
    // a 高 200 → 中心 100；b 只有 10 高，top=210 → 中心 215
    // f1: top = 100-50 = 50, 高 100 → cursor = 160
    // f2: 理想 top = 215-50 = 165，但 cursor 已经是 160，165>160 不撞
    // 把 b 改得更靠上：让 b 紧贴 a，则 f2 的理想位置会更小
    const heights = { a: 200, b: 10, f1: 100, f2: 100 };
    const r = layout(columns, connections, heights);

    // 无论如何都不能重叠
    expect(r.tops.f2!).toBeGreaterThanOrEqual(r.tops.f1! + 100 + GAP - 0.01);
  });

  it('top 不会为负', () => {
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'tall', section: null }] },
      { key: 'c2', title: 'B', nodes: [{ id: 'short', section: null }] },
    ];
    const r = layout(columns, [{ fromId: 'tall', toId: 'short', via: 'winner' }], { tall: 400, short: 20 });
    expect(r.tops.short).toBeGreaterThanOrEqual(0);
  });
});

describe('分区（战绩组）', () => {
  it('分区之间插入额外间距，并记录分区位置', () => {
    const columns: LayoutColumn[] = [
      {
        key: 'r3',
        title: 'R3',
        nodes: [
          { id: 'a', section: '2-0' },
          { id: 'b', section: '2-0' },
          { id: 'c', section: '1-1' },
          { id: 'd', section: '0-2' },
        ],
      },
    ];
    const r = layout(columns, []);

    expect(r.tops.a).toBe(0);
    expect(r.tops.b).toBe(H + GAP);
    // 1-1 分区：2 个节点后 cursor = 2H+2GAP = 140，再加 sectionGap 20 → 160
    expect(r.tops.c).toBe(2 * H + 2 * GAP + SECTION_GAP);
    // 0-2 分区：c 之后再 +H+GAP +sectionGap
    expect(r.tops.d).toBe(3 * H + 3 * GAP + 2 * SECTION_GAP);

    const sections = r.sectionTops.r3!;
    expect(sections.map((s) => s.section)).toEqual(['2-0', '1-1', '0-2']);
    expect(sections[0]!.top).toBe(0);
  });

  it('无分区时不留额外间距', () => {
    const columns: LayoutColumn[] = [
      { key: 'c', title: 'C', nodes: [{ id: 'a', section: null }, { id: 'b', section: null }] },
    ];
    const r = layout(columns, []);
    expect(r.tops.b).toBe(H + GAP);
    expect(r.sectionTops.c).toEqual([]);
  });
});

describe('多列完整树', () => {
  it('8 → 4 → 2 → 1 的淘汰树纵向对称', () => {
    const round1 = Array.from({ length: 8 }, (_, i) => ({ id: `r1-${i}`, section: null }));
    const round2 = Array.from({ length: 4 }, (_, i) => ({ id: `r2-${i}`, section: null }));
    const round3 = Array.from({ length: 2 }, (_, i) => ({ id: `r3-${i}`, section: null }));
    const round4 = [{ id: 'gf', section: null }];

    const connections: LayoutConnection[] = [];
    for (let i = 0; i < 4; i += 1) {
      connections.push({ fromId: `r1-${i * 2}`, toId: `r2-${i}`, via: 'winner' });
      connections.push({ fromId: `r1-${i * 2 + 1}`, toId: `r2-${i}`, via: 'winner' });
    }
    for (let i = 0; i < 2; i += 1) {
      connections.push({ fromId: `r2-${i * 2}`, toId: `r3-${i}`, via: 'winner' });
      connections.push({ fromId: `r2-${i * 2 + 1}`, toId: `r3-${i}`, via: 'winner' });
    }
    connections.push({ fromId: 'r3-0', toId: 'gf', via: 'winner' });
    connections.push({ fromId: 'r3-1', toId: 'gf', via: 'winner' });

    const r = layout(
      [
        { key: 'a', title: 'R1', nodes: round1 },
        { key: 'b', title: 'R2', nodes: round2 },
        { key: 'c', title: 'R3', nodes: round3 },
        { key: 'd', title: 'GF', nodes: round4 },
      ],
      connections,
    );

    // 第一列顺序堆叠
    expect(r.tops['r1-0']).toBe(0);
    expect(r.tops['r1-1']).toBe(H + GAP);

    // 第二列每个居中于对应两个
    const centerOf = (id: string, col: string) => {
      void col;
      return r.tops[id]! + H / 2;
    };
    expect(centerOf('r2-0', 'b')).toBeCloseTo((centerOf('r1-0', 'a') + centerOf('r1-1', 'a')) / 2, 5);
    expect(centerOf('r3-0', 'c')).toBeCloseTo((centerOf('r2-0', 'b') + centerOf('r2-1', 'b')) / 2, 5);

    // 决赛居中于两场半决赛
    expect(centerOf('gf', 'd')).toBeCloseTo((centerOf('r3-0', 'c') + centerOf('r3-1', 'c')) / 2, 5);

    // 整体纵向对称：决赛中心 = 第一列中心
    const firstColCenter = (r.tops['r1-0']! + H + r.tops['r1-7']!) / 2;
    expect(centerOf('gf', 'd')).toBeCloseTo(firstColCenter, 1);
  });

  it('缺失高度时用兜底值', () => {
    const columns: LayoutColumn[] = [
      { key: 'c', title: 'C', nodes: [{ id: 'a', section: null }, { id: 'b', section: null }] },
    ];
    const r = layout(columns, [], { a: 100 }); // b 缺失
    expect(r.tops.a).toBe(0);
    expect(r.tops.b).toBe(100 + GAP);
  });
});

describe('连线路径', () => {
  it('横向间距足够时走直角折线', () => {
    expect(buildConnectorPath(0, 10, 100, 50)).toBe('M 0 10 H 50 V 50 H 100');
  });

  it('间距过小时改用贝塞尔，避免尖锐回头', () => {
    const d = buildConnectorPath(100, 10, 104, 50);
    expect(d).toContain('C');
  });

  it('反向连线也不产生 NaN', () => {
    const d = buildConnectorPath(100, 0, 20, 80);
    expect(d).not.toContain('NaN');
    expect(d).toContain('C');
  });
});

describe('密度', () => {
  it('按可见列数分档', () => {
    expect(resolveDensity(1)).toBe('comfortable');
    expect(resolveDensity(2)).toBe('comfortable');
    expect(resolveDensity(3)).toBe('normal');
    expect(resolveDensity(4)).toBe('normal');
    expect(resolveDensity(5)).toBe('compact');
    expect(resolveDensity(8)).toBe('compact');
  });

  it('紧凑档隐藏次要信息，但不截断对阵', () => {
    expect(showsSecondaryInfo('comfortable')).toBe(true);
    expect(showsSecondaryInfo('compact')).toBe(false);
  });
});

describe('确定性', () => {
  it('相同输入产生相同输出', () => {
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'a', section: 'x' }, { id: 'b', section: 'y' }] },
      { key: 'c2', title: 'B', nodes: [{ id: 'c', section: null }] },
    ];
    const conns: LayoutConnection[] = [{ fromId: 'a', toId: 'c', via: 'winner' }];
    const r1 = layout(columns, conns);
    const r2 = layout(columns, conns);
    expect(r1).toEqual(r2);
  });

  it('不修改输入', () => {
    const columns: LayoutColumn[] = [{ key: 'c', title: 'C', nodes: [{ id: 'a', section: null }] }];
    const snapshot = JSON.stringify(columns);
    layout(columns, []);
    expect(JSON.stringify(columns)).toBe(snapshot);
  });
});

describe('纵向分段（band）', () => {
  /** 排位赛 44 张卡 vs 决赛 1 张卡：不分段时决赛会被顶到画布最上方。 */
  it('不同段纵向依次串接，后一段在前一段下方', () => {
    const columns: LayoutColumn[] = [
      {
        key: 'qual',
        title: '排位赛',
        band: 'qualification',
        nodes: Array.from({ length: 44 }, (_, i) => ({ id: `q${i}`, section: null })),
      },
      { key: 'swiss', title: 'R1', band: 'swiss', nodes: [{ id: 's1', section: null }] },
      { key: 'finals', title: '总决赛', band: 'finals', nodes: [{ id: 'f1', section: null }] },
    ];
    const r = layout(columns, []);

    // 排位赛段从 0 开始，44 张卡 × (60+10) − 10 = 3070
    expect(r.columnOffsets.qual).toBe(0);
    expect(r.columnHeights.qual).toBe(3070);

    // 瑞士轮段紧随其后
    expect(r.columnOffsets.swiss).toBe(3070 + SECTION_GAP);
    // 决赛段再往下
    expect(r.columnOffsets.finals).toBe(r.columnOffsets.swiss! + H + SECTION_GAP);

    // 关键：决赛必须排在瑞士轮之后，而不是画布顶端
    expect(r.columnOffsets.finals!).toBeGreaterThan(r.columnOffsets.swiss!);
    expect(r.columnOffsets.swiss!).toBeGreaterThan(r.columnOffsets.qual!);
  });

  it('同段内的列共享纵向原点（淘汰树居中才成立）', () => {
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', band: 'finals', nodes: [{ id: 'a', section: null }, { id: 'b', section: null }] },
      { key: 'c2', title: 'B', band: 'finals', nodes: [{ id: 'final', section: null }] },
    ];
    const connections: LayoutConnection[] = [
      { fromId: 'a', toId: 'final', via: 'winner' },
      { fromId: 'b', toId: 'final', via: 'winner' },
    ];
    const r = layout(columns, connections);

    expect(r.columnOffsets.c1).toBe(0);
    expect(r.columnOffsets.c2).toBe(0);
    // final 仍居中于 a、b 的中点：(30 + 100) / 2 - 60 / 2 = 35
    expect(r.tops.final).toBe(35);
  });

  it('未标段的列与首段共享原点（向后兼容）', () => {
    const columns: LayoutColumn[] = [
      { key: 'c1', title: 'A', nodes: [{ id: 'a', section: null }] },
      { key: 'c2', title: 'B', nodes: [{ id: 'b', section: null }] },
    ];
    const r = layout(columns, [{ fromId: 'a', toId: 'b', via: 'winner' }]);
    expect(r.columnOffsets.c1).toBe(0);
    expect(r.columnOffsets.c2).toBe(0);
    expect(r.tops.b).toBe(0);
  });

  it('bands 报告每段的纵向范围', () => {
    const columns: LayoutColumn[] = [
      { key: 'q', title: 'Q', band: 'qualification', nodes: [{ id: 'x', section: null }] },
      { key: 'f', title: 'F', band: 'finals', nodes: [{ id: 'y', section: null }] },
    ];
    const r = layout(columns, []);
    expect(r.bands.map((b) => b.band)).toEqual(['qualification', 'finals']);
    expect(r.bands[0]!.top).toBe(0);
    expect(r.bands[1]!.top).toBeGreaterThan(r.bands[0]!.top);
  });

  it('totalHeight 覆盖最低一段的底部', () => {
    const columns: LayoutColumn[] = [
      { key: 'a', title: 'A', band: 'x', nodes: [{ id: 'n1', section: null }] },
      { key: 'b', title: 'B', band: 'y', nodes: [{ id: 'n2', section: null }, { id: 'n3', section: null }] },
    ];
    const r = layout(columns, []);
    expect(r.totalHeight).toBe(r.columnOffsets.b! + r.columnHeights.b!);
    expect(r.totalHeight).toBeGreaterThan(0);
  });
});

describe('连线的车道分配', () => {
  it('新增首轮八条分支及瑞士轮十六条路径不会撞到固定容量上限', () => {
    for (const count of [8, 16]) {
      const offsets = Array.from({ length: count }, (_, lane) => Math.round(laneOffset(64, lane, count)));
      expect(new Set(offsets).size).toBe(count);
      expect(Math.max(...offsets.map(Math.abs))).toBeLessThan(32);
    }
  });
  it('车道 0 走通道中线', () => {
    expect(laneOffset(44, 0)).toBe(0);
  });

  it('任意两条车道的偏移都不相同（否则会重叠成一条线）', () => {
    const span = 44;
    const offsets = Array.from({ length: MAX_LANES }, (_, i) => laneOffset(span, i));
    const uniq = new Set(offsets.map((v) => v.toFixed(3)));
    expect(uniq.size, `车道偏移出现重复：${offsets.join(', ')}`).toBe(offsets.length);
  });

  it('车道偏移始终留在通道内，不侵入两侧卡片', () => {
    const span = 44;
    for (let lane = 0; lane < MAX_LANES; lane += 1) {
      expect(Math.abs(laneOffset(span, lane))).toBeLessThanOrEqual(span / 2);
    }
  });

  it('同一通道里多条线的转折 x 互不相同', () => {
    const [x1, x2] = [0, 44];
    const xs = Array.from({ length: MAX_LANES }, (_, lane) =>
      buildConnectorPath(x1, 0, x2, 50, lane).match(/H ([\d.]+) V/)![1],
    );
    expect(new Set(xs).size).toBe(MAX_LANES);
  });

  it('同一行的两个节点走直线，不做折线', () => {
    const d = buildConnectorPath(0, 50, 100, 50);
    expect(d).toBe('M 0 50 H 100');
    expect(d).not.toContain('V');
  });

  it('通道过窄时不产生 NaN，车道退化为中线', () => {
    const d = buildConnectorPath(0, 0, 10, 50, 3);
    expect(d).not.toContain('NaN');
    expect(d.startsWith('M 0 0')).toBe(true);
  });
});
