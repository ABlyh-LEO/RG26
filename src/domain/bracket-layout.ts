/**
 * 列式赛程图的布局计算。
 *
 * 设计参考 docs/reference/rm-schedule-ui-notes.md（只借鉴思路，不复制代码）：
 * - **列 = 阶段**（R1…R5 / 八强 / 半决赛 / 决赛），**节点 = 一场比赛**
 * - **连线 = 晋级流向**
 * - 纵向位置：淘汰赛中，右侧节点居中于其左侧两个 feeder 的中点
 *
 * 本模块是纯函数：不读时钟、不碰 DOM、不依赖 React。
 * 实测高度由调用方传入（队名可能换行，不能估算）。
 */

/** 一个可布局的节点。 */
export interface LayoutNode {
  /** 稳定 ID（比赛/系列赛 ID）。 */
  id: string;
  /** 该列内的分区键（例如战绩组 "2-0"）；无分区时为 null。 */
  section: string | null;
}

/** 一列 = 一个阶段。 */
export interface LayoutColumn {
  /** 阶段标题，例如 "R3"、"八强"。 */
  title: string;
  /** 用于连接的阶段标识。 */
  key: string;
  nodes: LayoutNode[];
  /**
   * 纵向分段名。同一段内的列共享纵向坐标，段与段**纵向依次串接**。
   *
   * 为什么需要它：排位赛一列有 44 张卡（约 5000px），而决赛一列只有 10 张。
   * 如果把三个阶段塞进同一条纵向带，决赛会被摆到最顶端，
   * 看起来像"决赛发生在排位赛之前"——那是假的。
   * 分段后：排位赛段 → 瑞士轮段 → 决赛段，纵向依次往下。
   */
  band?: string | null;
}

/** 一条流向连线：from 的 winner 或 loser 进入 to。 */
export interface LayoutConnection {
  fromId: string;
  toId: string;
  /** winner = 胜者进入；loser = 败者进入。 */
  via: 'winner' | 'loser';
}

export interface LayoutInput {
  columns: readonly LayoutColumn[];
  connections: readonly LayoutConnection[];
  /** 各节点的实测高度（px）。缺失时按 fallbackHeight 处理。 */
  heights: Readonly<Record<string, number>>;
  /** 同列节点之间的间距。 */
  gap: number;
  /** 分区之间的额外间距。 */
  sectionGap: number;
  /** 高度缺失时的兜底值。 */
  fallbackHeight: number;
}

export interface LayoutResult {
  /** 各节点相对所在列顶部的 offsetTop。 */
  tops: Record<string, number>;
  /** 各列内容区所需高度。 */
  columnHeights: Record<string, number>;
  /** 各分区在列内的起始 offset（用于画分区标题与分隔线）。 */
  sectionTops: Record<string, { columnKey: string; section: string; top: number; height: number }[]>;
  /** 各列整体相对画布顶部的偏移（分段串接产生）。 */
  columnOffsets: Record<string, number>;
  /** 画布总高度。 */
  totalHeight: number;
  /** 各分段的纵向范围，用于画分段标题。 */
  bands: { band: string; top: number; height: number }[];
}

/** 连线是否为"淘汰赛父子"关系（用于纵向居中对齐）。 */
export function isTreeConnection(conn: LayoutConnection): boolean {
  return conn.via === 'winner';
}

/**
 * 计算列式布局。
 *
 * 纵向规则（按列从左到右）：
 * 1. 收集该节点的**上一列** feeder（最多取最近的两个）
 * 2. 两个 feeder → top = 两者中心的中点 − 自身高度/2
 * 3. 一个 feeder  → top = 该 feeder 中心 − 自身高度/2
 * 4. 无 feeder    → 顺序堆叠（cursor）
 * 5. 同列不重叠：top 小于 cursor 时下推到 cursor
 *
 * 这样做出来的效果是：下游比赛自然落在它两场上游比赛的中间，
 * 连线是短的横线 + 竖线，而不是横跨整屏的斜线。
 */
export function computeColumnLayout(input: LayoutInput): LayoutResult {
  const { columns, connections, heights, gap, sectionGap, fallbackHeight } = input;

  const tops: Record<string, number> = {};
  const centers: Record<string, number> = {};
  const columnHeights: Record<string, number> = {};
  const columnOffsets: Record<string, number> = {};
  const sectionTops: LayoutResult['sectionTops'] = {};
  const bands: LayoutResult['bands'] = [];

  // 每列内节点 → 列序号
  const nodeColumn = new Map<string, number>();
  columns.forEach((col, ci) => {
    for (const n of col.nodes) nodeColumn.set(n.id, ci);
  });

  // 入边：toId → fromId[]（只取 winner，loser 不参与纵向居中，
  // 否则败者组第二轮会被胜者组的节点拉伸到奇怪的位置）
  const incoming = new Map<string, string[]>();
  for (const c of connections) {
    if (!isTreeConnection(c)) continue;
    const list = incoming.get(c.toId);
    if (list) list.push(c.fromId);
    else incoming.set(c.toId, [c.fromId]);
  }

  const heightOf = (id: string): number => {
    const h = heights[id];
    return Math.max(0, typeof h === 'number' && Number.isFinite(h) ? h : fallbackHeight);
  };

  /**
   * 纵向坐标是**分段累加**的。
   *
   * 同一段内所有列从同一个 origin 开始（这样淘汰树的父子居中才成立）；
   * 换段时 origin 下移到上一段的底部。跨段的连线（瑞士轮 → 决赛）
   * 因此是一条向下再向右的线，视觉上正好表达"下一阶段"。
   */
  let bandOrigin = 0;
  let currentBand: string | null | undefined;
  let bandTop = 0;
  let bandBottom = 0;

  const closeBand = () => {
    if (currentBand === undefined || currentBand === null) return;
    bands.push({ band: currentBand, top: bandTop, height: Math.max(0, bandBottom - bandTop) });
  };

  for (let ci = 0; ci < columns.length; ci += 1) {
    const col = columns[ci]!;

    // 换段：结算上一段，origin 下移到它的底部
    if (col.band !== currentBand) {
      closeBand();
      if (currentBand !== undefined && col.band) {
        bandOrigin = bandBottom + sectionGap;
      }
      currentBand = col.band;
      bandTop = bandOrigin;
      bandBottom = bandOrigin;
    }

    columnOffsets[col.key] = bandOrigin;

    let cursor = 0;
    let maxBottom = 0;
    let currentSection: string | null = null;
    let sectionStartTop = 0;
    const sections: LayoutResult['sectionTops'][string] = [];

    const flushSection = (endTop: number) => {
      if (currentSection === null) return;
      sections.push({
        columnKey: col.key,
        section: currentSection,
        top: sectionStartTop,
        height: Math.max(0, endTop - sectionStartTop - gap),
      });
    };

    for (const node of col.nodes) {
      // 分区切换：插入额外间距，并结算上一个分区
      if (node.section !== currentSection) {
        if (currentSection !== null) {
          flushSection(cursor);
          cursor += sectionGap;
        }
        currentSection = node.section;
        sectionStartTop = cursor;
      }

      const h = heightOf(node.id);
      const parents = resolveParents(node.id, ci, incoming, nodeColumn, centers, bandOrigin);

      let top: number;
      if (parents.length >= 2) {
        top = (centers[parents[0]!]! + centers[parents[1]!]!) / 2 - h / 2 - bandOrigin;
      } else if (parents.length === 1) {
        top = centers[parents[0]!]! - h / 2 - bandOrigin;
      } else {
        top = cursor;
      }

      // 同列不重叠；也不越过列顶
      if (top < cursor) top = cursor;
      if (top < 0) top = 0;

      tops[node.id] = top;
      centers[node.id] = top + h / 2 + bandOrigin;
      const bottom = top + h;
      cursor = bottom + gap;
      if (bottom > maxBottom) maxBottom = bottom;
    }

    flushSection(cursor);
    columnHeights[col.key] = maxBottom;
    sectionTops[col.key] = sections;

    if (bandOrigin + maxBottom > bandBottom) bandBottom = bandOrigin + maxBottom;
  }

  closeBand();

  const totalHeight = Math.max(bandBottom, fallbackHeight);

  return { tops, columnHeights, sectionTops, columnOffsets, totalHeight, bands };
}

/**
 * 取该节点在上一列的 feeder。
 *
 * 优先上一列；凑不满两个再往更左侧已布局的节点找。
 * 多于两个时取**中心距最近**的一对，避免连到很远的分支上。
 *
 * **只在同一分段内居中。** 跨段（瑞士轮 → 决赛）的父节点在更上方的一段，
 * 拿它的绝对坐标来居中会把下游节点推到几万像素以外；
 * 跨段的列改为顺序堆叠，纵向由分段本身表达先后。
 */
function resolveParents(
  nodeId: string,
  columnIndex: number,
  incoming: Map<string, string[]>,
  nodeColumn: Map<string, number>,
  centers: Record<string, number>,
  bandOrigin: number,
): string[] {
  const raw = incoming.get(nodeId) ?? [];
  const placed = raw.filter((id) => centers[id] !== undefined && centers[id]! >= bandOrigin);

  const fromPrev = placed
    .filter((id) => nodeColumn.get(id) === columnIndex - 1)
    .sort((a, b) => centers[a]! - centers[b]!);
  if (fromPrev.length >= 2) return pickAdjacentPair(fromPrev, centers);
  if (fromPrev.length === 1) return fromPrev;

  const fromLeft = placed
    .filter((id) => (nodeColumn.get(id) ?? Number.MAX_SAFE_INTEGER) < columnIndex)
    .sort((a, b) => centers[a]! - centers[b]!);
  if (fromLeft.length >= 2) return pickAdjacentPair(fromLeft, centers);
  return fromLeft.slice(0, 1);
}

/** 在已按中心排序的候选中，取中心距最近的一对。 */
function pickAdjacentPair(sorted: string[], centers: Record<string, number>): string[] {
  if (sorted.length <= 2) return sorted.slice(0, 2);
  let best: string[] = [sorted[0]!, sorted[1]!];
  let bestSpan = centers[sorted[1]!]! - centers[sorted[0]!]!;
  for (let i = 1; i < sorted.length - 1; i += 1) {
    const span = centers[sorted[i + 1]!]! - centers[sorted[i]!]!;
    if (span < bestSpan) {
      bestSpan = span;
      best = [sorted[i]!, sorted[i + 1]!];
    }
  }
  return best;
}

/**
 * 生成 SVG 连线路径。
 *
 * 起点为 from 的右边缘中点，终点为 to 的左边缘中点。
 * 横向间距足够时走直角折线（H-V-H），否则用三次贝塞尔平滑过渡。
 */
export function buildConnectorPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  if (x2 > x1 + 8) {
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
  }
  // 反向或重叠：用曲线避免出现尖锐回头
  return `M ${x1} ${y1} C ${x1 + 24} ${y1}, ${x2 - 24} ${y2}, ${x2} ${y2}`;
}

/**
 * 按可见列数决定信息密度。
 *
 * 只收缩字号与内边距，**纵向对阵与席位来源永不截断**。
 */
export type BracketDensity = 'comfortable' | 'normal' | 'compact';

export function resolveDensity(visibleColumns: number): BracketDensity {
  if (visibleColumns <= 2) return 'comfortable';
  if (visibleColumns <= 4) return 'normal';
  return 'compact';
}

/** 该密度下是否显示次要信息（席位来源、类型标签）。 */
export function showsSecondaryInfo(density: BracketDensity): boolean {
  return density !== 'compact';
}
