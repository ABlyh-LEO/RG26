/**
 * 列式赛程图。
 *
 * 设计参考 docs/reference/rm-schedule-ui-notes.md：
 * - 列为阶段，卡片纵向堆叠，SVG 连线表示流向
 * - 高度**实测**（队名可能换行），不估算
 * - 列数自适应屏幕宽度，窄屏横向滚动
 * - 密度随可见列数变化，但纵向对阵永不截断
 *
 * 布局计算在 domain/bracket-layout.ts（纯函数，已单测）。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  buildConnectorPath,
  computeColumnLayout,
  laneOffset,
  resolveDensity,
  showsSecondaryInfo,
  type LayoutColumn,
  type LayoutConnection,
} from '../domain/bracket-layout';
import { SideBadge } from './ui';
import type { Side } from '../domain/sides';

export interface BracketNodeContent {
  /** 卡片主体。 */
  title: string;
  /** 主行（对阵双方）。 */
  rows: {
    label: string;
    team: string | null;
    isWinner?: boolean;
    dim?: boolean;
    /** 该行的红蓝方；未确定对阵时为 null，**不猜测**。 */
    side?: Side | null;
  }[];
  /** 次要行（比分、状态）。 */
  meta?: string | null;
  status?: 'upcoming' | 'live' | 'done';
  /** 点击跳转的链接。 */
  to?: string;
}

export interface BracketChartProps {
  columns: LayoutColumn[];
  connections: LayoutConnection[];
  /** 渲染单个节点。 */
  renderNode: (nodeId: string) => BracketNodeContent;
  /** 分区标题（例如战绩组）。 */
  sectionLabel?: (section: string) => string;
  /** 每列最少宽度。 */
  minColumnWidth?: number;
  /** 说明这组图表达什么（可访问性）。 */
  ariaLabel: string;
  /** 图例。 */
  legend?: ReactNode;
}

/**
 * 列间距。连线走的是列与列之间的**通道**，因此这个值不能太小：
 * 12px 时折线的竖直段几乎贴在卡片边缘，上下相邻的线会挤在一起，
 * 看起来像一团乱麻。64px 让同一通道里的多条线有足够间距并排。
 */
const GAP = 64;
const SECTION_GAP = 20;
const FALLBACK_HEIGHT = 84;

/**
 * 横线离卡片的最小留白。也是横向段被占用后左右挪动的**步长**：
 * 两条同高度的横线分开 18px，视觉上一眼能看出是两条。
 */
const CLEAR = 18;
const CLEAR_STEP = CLEAR;

export function BracketChart({
  columns,
  connections,
  renderNode,
  sectionLabel,
  minColumnWidth = 190,
  ariaLabel,
  legend,
}: BracketChartProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState(columns.length);
  const [measuredHeight, setMeasuredHeight] = useState(0);

  /**
   * 列宽。首次渲染 viewportWidth 还是 0，用 minColumnWidth 兜底，
   * 测量后再收敛。
   *
   * 注意可用宽度取的是**滚动容器**宽度（外部给的），不是 board 宽度。
   * 用 board 宽度会形成"测量→改宽→再测量"的自反馈，宽度会一轮轮
   * 放大到几百万像素。
   */
  const columnWidth =
    viewportWidth > 0
      ? Math.max(minColumnWidth, Math.floor(viewportWidth / visibleColumns) - GAP)
      : minColumnWidth;
  const totalWidth = columns.length * (columnWidth + GAP) - GAP;

  /**
   * 实测每个节点高度，再交给纯函数布局。队名换行时高度会变，必须实测。
   */
  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;

    const next: Record<string, number> = {};
    board.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
      const id = el.dataset.nodeId;
      if (!id) return;
      next[id] = el.offsetHeight;
    });

    setHeights((prev) => {
      // 避免无意义的重渲染
      const same =
        Object.keys(prev).length === Object.keys(next).length &&
        Object.keys(next).every((k) => prev[k] === next[k]);
      return same ? prev : next;
    });

    // 画布真实高度：最高的那一列（含列标题）延伸到哪里
    let bottom = 0;
    board.querySelectorAll<HTMLElement>('.bracket__column').forEach((col) => {
      const b = col.offsetTop + col.offsetHeight;
      if (b > bottom) bottom = b;
    });
    setMeasuredHeight((prev) => (prev === bottom ? prev : bottom));

    const scroller = scrollerRef.current;
    if (scroller) {
      const w = scroller.clientWidth;
      setViewportWidth((prev) => (prev === w ? prev : w));
    }
  }, []);

  // 首帧、数据变化、以及**列宽变化**后都要重测。
  //
  // 列宽变化必须重测：窄屏下 columnWidth 收敛到 minColumnWidth，
  // 卡片变窄会让队名多换一行，节点高度随之变大。不重测就会一直
  // 用旧的偏小高度，最下面一场被裁掉。
  useLayoutEffect(() => {
    measure();
  }, [measure, columns, connections, columnWidth]);

  /**
   * 容器尺寸变化（旋转、窗口缩放）后重测。
   *
   * 观察的是**滚动容器**：它是外部给的宽度，不会因为内部布局改变而改变。
   * 观察 board 会形成"测量→改宽度→再测量"的自反馈。
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [measure]);

  // 字体加载完成后高度可能变化
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let cancelled = false;
    void fonts.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [measure]);

  /** 按视口宽度决定可见列数（不做拖拽缩放）。 */
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      // 手机 2 列、平板 3 列、桌面按屏宽尽量多
      const byWidth = w >= 1400 ? 6 : w >= 1100 ? 5 : w >= 860 ? 4 : w >= 620 ? 3 : 2;
      setVisibleColumns(Math.max(1, Math.min(byWidth, columns.length)));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [columns.length]);
  const layout = useMemo(
    () =>
      computeColumnLayout({
        columns,
        connections,
        heights,
        gap: GAP,
        sectionGap: SECTION_GAP,
        fallbackHeight: FALLBACK_HEIGHT,
      }),
    [columns, connections, heights],
  );

  const density = resolveDensity(visibleColumns);
  const showSecondary = showsSecondaryInfo(density);

  /** 连线端点坐标：基于实测 DOM 位置，而不是自己算。 */
  const paths = useMemo(() => {
    const board = boardRef.current;
    if (!board) return [];
    const boardRect = board.getBoundingClientRect();

    const nodeEls = new Map<string, HTMLElement>();
    board.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
      const id = el.dataset.nodeId;
      if (id && !nodeEls.has(id)) nodeEls.set(id, el);
    });

    const out: { key: string; d: string; via: 'winner' | 'loser' }[] = [];

    const columnOfNode = new Map<string, number>();
    const columnBounds: { left: number; right: number }[] = [];
    const columnEls = board.querySelectorAll<HTMLElement>('.bracket__column');
    columns.forEach((col, ci) => {
      for (const n of col.nodes) columnOfNode.set(n.id, ci);
      const el = columnEls[ci];
      if (el) {
        columnBounds[ci] = {
          left: el.getBoundingClientRect().left - boardRect.left + board.scrollLeft,
          right: el.getBoundingClientRect().right - boardRect.left + board.scrollLeft,
        };
      }
    });

    /**
     * 列间通道要**分车道**。
     *
     * 同一段间隙里往往有多条线竖直穿过（八强赛→半决赛有 5 条）。
     * 如果它们都走同一个 x，就会重叠成一条，看起来像"少了几条线、
     * 连错了地方"。这里按竖直段的行进方向给每条线一个独立偏移，
     * 让它们在通道内并排。
     *
     * 车道的**作用域是通道本身**，不是起点：跨列连线与相邻列连线可能
     * 共用同一条通道（例如 `F-WSF→F-GF` 与别的线都从第 8 列左边过），
     * 用起点 x 当 key 会让它们各自从 0 开始、撞在同一个 x 上。
     */
    const laneCount = new Map<number, number>();

    /**
     * 中间列 k 里离目标高度 targetY 最近的**卡片空隙**。
     *
     * 跨列连线的水平穿越段必须落在这种空隙里，否则会压在卡片上。
     * 取不到空隙时退到该列最低卡片的下方（那里必定是空的）。
     */
    const nodeSpanOfColumn = new Map<number, { top: number; bottom: number }[]>();
    for (const [id, colIdx] of columnOfNode) {
      const el = nodeEls.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const span = {
        top: r.top - boardRect.top + board.scrollTop,
        bottom: r.bottom - boardRect.top + board.scrollTop,
      };
      const list = nodeSpanOfColumn.get(colIdx) ?? [];
      list.push(span);
      nodeSpanOfColumn.set(colIdx, list);
    }

    /**
     * **横向段占位表**：key 为 `通道 x : 高度 y`，值为已占用次数。
     *
     * 为什么必须按 (通道, 高度) 而不是只按高度：两条线只有
     * **同在一条通道、同一高度**时才会共线重叠；不同通道的同高度横线
     * 在图上完全分得开，不该互相排挤。
     *
     * 为什么必须覆盖**每一段**横线（进入 / 横穿 / 离开）而不只是横穿段：
     * 实测最严重的重叠根本不在横穿段，而在**进入段**——
     * `F-W1A→F-WSF` 从八强赛 (cy 370.99) 出发，而「败者组第二轮」的
     * `F-L2B` 恰好也在 cy 370.99，于是"离开 F-W1A 的横线"与
     * "进入 F-L2B 的横线"在 x=1376..1440 通道里完全重合（基线实测
     * 最长一条重叠达 250px）。只给横穿段分车道改不到它。
     *
     * 车道偏移过去只作用于竖直段（`laneCount`），横线一直无人管理，
     * 这正是"图上看起来只有一条线、却代表两条晋级路径"的根源。
     */
    const horizontalUsed = new Map<string, number>();

    /** 横向段最多尝试多少个左右交替的候选高度，避免病态输入下死循环。 */
    const MAX_HORIZONTAL_TRIES = 40;

    /**
     * 为一段横线挑一个**未被占用**的高度，并登记占用。
     *
     * 沿 y 左右交替寻找最近空位（步长 `step`），让线尽量贴回它
     * 本该在的高度，而不是被弹到很远的地方。
     */
    function reserveHorizontal(channelX: number, y: number, step: number): number {
      const key = (yy: number) => `${Math.round(channelX)}:${Math.round(yy)}`;
      if ((horizontalUsed.get(key(y)) ?? 0) === 0) {
        horizontalUsed.set(key(y), 1);
        return y;
      }
      for (let i = 1; i <= MAX_HORIZONTAL_TRIES; i += 1) {
        for (const cand of [y - i * step, y + i * step]) {
          if ((horizontalUsed.get(key(cand)) ?? 0) === 0) {
            horizontalUsed.set(key(cand), 1);
            return cand;
          }
        }
      }
      // 候选用尽（极窄通道）：叠加计数，宁可重叠也不能发散出去
      horizontalUsed.set(key(y), (horizontalUsed.get(key(y)) ?? 0) + 1);
      return y;
    }

    /**
     * 中间列里可用的**横向穿越高度**（该处没有卡片）。
     *
     * 只列候选，不在这里挑：挑哪个必须看整条路径，
     * 见下方 pickCrossingY 的评分。
     */
    function crossingCandidates(colIdx: number): number[] {
      const spans = (nodeSpanOfColumn.get(colIdx) ?? []).slice().sort((a, b) => a.top - b.top);
      if (spans.length === 0) return [];

      const candidates: number[] = [spans[0]!.top - CLEAR];
      for (let i = 0; i < spans.length; i += 1) {
        candidates.push(spans[i]!.bottom + CLEAR);
        if (i + 1 < spans.length) {
          const gap = spans[i + 1]!.top - spans[i]!.bottom;
          // 只在空隙足够宽时才当候选，避免贴着卡片边
          if (gap >= CLEAR * 2) candidates.push((spans[i]!.bottom + spans[i + 1]!.top) / 2);
        }
      }
      candidates.push(spans[spans.length - 1]!.bottom + CLEAR);
      return candidates;
    }

    /**
     * 选中间列的穿越高度。
     *
     * **判据是整条路径的垂直总行程最小，不是"离终点最近"。**
     * 只朝终点靠会画出"大回环"：例如 `F-WSF(cy 445) → F-GF(cy 297)`，
     * 中间隔着「名额争夺战」(y 255..339)，离终点 297 最近的空档在其
     * **上方**(≈241)，于是线先冲到 241 再落回 297 —— 白白多走 200px，
     * 看起来像接错了地方。
     *
     * 改成沿 y1→y2 的**趋势**挑：以 y1、y2 之间距起点约 (k-ci) 比例处的
     * 高度为期望值，让线在穿越时自然"斜着过去"。
     *
     * 另外**避开已被别的线占用的高度**：几何算出来的穿越高度常常撞车
     * （`F-W1A→F-WSF` 与 `F-W1B→F-WSF` 就都算出同一个高度），两条线
     * 重叠成一条后，图上看起来只有一条晋级路径。宁可稍微绕一点，也要分开。
     *
     * **评分必须包含"腾挪后的实际高度"，不能先挑最好的再硬挪。**
     * 早先的写法先按 `|c - ideal|` 挑中一个候选，再交给
     * `reserveHorizontal` 让位；该候选被占用时会被推到最远
     * `MAX_HORIZONTAL_TRIES × CLEAR = 720px` 之外，实测把
     * `F-W1B→F-WSF` 顶到 y=265（要跨过第 5 场），绕行比冲到 **2.27**、
     * 还多出一次竖直折返 —— 比修复前的 1.41 更糟。
     * 现在对每个候选先算出它**腾挪后会落在哪里**，再按该实际位置评分，
     * 于是"稍微偏一点但不用让位"的候选会胜过"正中理想但会被推很远"的候选。
     */
    function pickCrossingY(
      colIdx: number,
      startY: number,
      endY: number,
      progress: number,
      channelX: number,
    ): number {
      const candidates = crossingCandidates(colIdx);
      if (candidates.length === 0) return endY;

      // 期望穿越高度：沿起点到终点的直线，按列序进度插值
      const ideal = startY + (endY - startY) * progress;

      const key = (yy: number) => `${Math.round(channelX)}:${Math.round(yy)}`;

      let best = candidates[0]!;
      let bestCost = Infinity;
      for (const c of candidates) {
        // 该候选腾挪后的实际落点（未被占用时就是它自己）
        const landing = occupiedLookup(channelX, c);
        // 评分：实际落点离理想点多远。腾挪越远，代价越大，
        // 于是"偏一点但不用挪"会赢过"正理想却被推 700px"。
        const cost = Math.abs(landing - ideal);
        if (cost < bestCost) {
          bestCost = cost;
          best = landing;
        }
      }

      horizontalUsed.set(key(best), (horizontalUsed.get(key(best)) ?? 0) + 1);
      return best;
    }

    /**
     * 若 `y` 已被占用，返回附近最近的空位；否则返回 `y` 本身。
     *
     * 与 `reserveHorizontal` 的区别：**只查询、不登记**，
     * 让 `pickCrossingY` 能先比较各候选的落点再决定占用哪一个。
     */
    function occupiedLookup(channelX: number, y: number): number {
      const key = (yy: number) => `${Math.round(channelX)}:${Math.round(yy)}`;
      if ((horizontalUsed.get(key(y)) ?? 0) === 0) return y;
      for (let i = 1; i <= MAX_HORIZONTAL_TRIES; i += 1) {
        for (const cand of [y - i * CLEAR_STEP, y + i * CLEAR_STEP]) {
          if ((horizontalUsed.get(key(cand)) ?? 0) === 0) return cand;
        }
      }
      return y;
    }

    /**
     * 去掉冗余顶点：连续的同向指令（H 后接 H、V 后接 V）会留下
     * 无意义的折点，视觉上是"线在这里莫名其妙拐了一下"。
     * 同时把坐标收敛到 2 位小数，避免 `444.9921875` 这种噪声。
     */
    function dedupe(pts: string[]): string[] {
      const out: string[] = [];
      for (const p of pts) {
        const cmd = p[0];
        const prev = out[out.length - 1];
        // 同向连续 → 用后一个覆盖前一个
        if (prev && prev[0] === cmd) out[out.length - 1] = p;
        else out.push(p);
      }
      return out;
    }

    function round2(n: number): number {
      return Math.round(n * 100) / 100;
    }

    for (const conn of connections) {
      const fromEl = nodeEls.get(conn.fromId);
      const toEl = nodeEls.get(conn.toId);
      if (!fromEl || !toEl) continue;
      const f = fromEl.getBoundingClientRect();
      const t = toEl.getBoundingClientRect();
      const x1 = f.right - boardRect.left + board.scrollLeft;
      const y1 = f.top + f.height / 2 - boardRect.top + board.scrollTop;
      const x2 = t.left - boardRect.left + board.scrollLeft;
      const y2 = t.top + t.height / 2 - boardRect.top + board.scrollTop;
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

      const ci = columnOfNode.get(conn.fromId);
      const cj = columnOfNode.get(conn.toId);
      const spansColumns = ci !== undefined && cj !== undefined && cj - ci > 1;

      /**
       * 跨列连线必须走**阶梯路径**，沿中间每一列的间隙逐段推进，
       * 不能从起点直接平推到目标。
       *
       * 为什么：起点列与目标列之间隔着整整一列卡片。任何"先平推到某个
       * x、再竖直走"的画法，那条水平段都会压在中间那列上（实测
       * `F-W1A→F-WSF` 的 y=371 水平段正好穿过第 6 列整列）。
       *
       * 阶梯走法：在**每条间隙里只做竖直移动**，进入下一列时
       * 走该列**上方或下方的空档**（那里没有卡片）水平穿过去。
       * 这样每一段水平线都落在空档里，绝不压卡片。
       */
      let d: string;
      let laneKey: number;

      /**
       * 通道中线。相邻列连线的竖段走这里，跨列连线也走这里，
       * 因此两条路径的**竖直段会共用同一个 x**，必须共享车道计数。
       */
      const channelBetween = (left: number, right: number): number => {
        const l = columnBounds[left]?.right ?? x1;
        const r = columnBounds[right]?.left ?? x2;
        return l + Math.max(0, r - l) / 2;
      };

      if (spansColumns) {
        /**
         * 跨列连线：借中间列的**上方或下方空档**越过去。
         *
         * 走法（以 八强赛 → 半决赛，中间隔着败者组第二轮为例）：
         *   1. 从起点水平进入两列之间的**通道**；
         *   2. 在通道里竖直移动到"穿越高度"（该处没有卡片）；
         *   3. 水平越过中间列，进入下一段通道；
         *   4. 在目标列左侧通道里竖直对齐到目标高度；
         *   5. 水平进入目标。
         *
         * 关键是**横穿只发生一次、且只在穿越高度上**：早先的写法在
         * 循环末尾就把 x 推到中间列右侧，导致多出一条横跨整列的
         * 长横线（实测 `F-WSF→F-GF` 横穿了整个「名额争夺战」列）。
         *
         * 穿越高度沿 y1→y2 的直线按列序插值选取（见 pickCrossingY）：
         * 只朝终点靠会画出"大回环"——先冲到无关高度再折回，
         * 看起来像接错了地方。
         *
         * **每一段横线都要过 `reserveHorizontal`**：进入段的横线
         * 与别的线在通道里同高度时同样会重叠，且那才是最严重的一类。
         */
        const pts: string[] = [`M ${round2(x1)} ${round2(y1)}`];

        for (let k = ci + 1; k <= cj - 1; k += 1) {
          const colL = columnBounds[k]?.left ?? x1;
          const colR = columnBounds[k]?.right ?? colL;
          const prevR = columnBounds[k - 1]?.right ?? x1;
          const gapL = Math.max(0, colL - prevR);
          const gapR = Math.max(0, (columnBounds[k + 1]?.left ?? colR) - colR);

          // 竖段车道：左侧通道（与相邻列连线共用同一套计数）
          const laneKeyL = Math.round(prevR + gapL / 2);
          const usedL = laneCount.get(laneKeyL) ?? 0;
          laneCount.set(laneKeyL, usedL + 1);
          const enterX = prevR + gapL / 2 + laneOffset(gapL, usedL);
          pts.push(`H ${round2(enterX)}`);

          // 穿越高度：沿 y1→y2 的直线按列序比例插值，取最近的可穿越空档。
          // 传起点而不只是终点，线才不会先绕到无关高度再折回。
          const progress = (k - ci) / (cj - ci);
          const crossY = pickCrossingY(k, y1, y2, progress, colR + gapR / 2);

          // 竖直挪到穿越高度，再横穿本列到右侧通道
          const crossY2 = reserveHorizontal(colR + gapR / 2, crossY, CLEAR_STEP);
          pts.push(`V ${round2(crossY2)}`);
          pts.push(`H ${round2(colR + gapR / 2)}`);
        }

        // 最后一段：在目标列左侧通道里竖直对齐，再进入目标
        const center = channelBetween(cj - 1, cj);
        const gap = Math.max(
          0,
          (columnBounds[cj]?.left ?? x2) - (columnBounds[cj - 1]?.right ?? x1),
        );
        laneKey = Math.round(center);
        const used = laneCount.get(laneKey) ?? 0;
        laneCount.set(laneKey, used + 1);
        const laneX = center + laneOffset(gap, used);

        /**
         * 在通道里竖直对齐到目标高度。
         *
         * 这段竖线的 x 由 `laneOffset` 决定，而 `laneOffset` 只保证
         * **同一条通道内**不同车道不撞；跨列连线与相邻列连线现在共用
         * 同一套 `laneCount`，所以这里不会再落到别人用过的 x 上
         * （基线上曾出现 74px 的竖直重叠，就是两套计数各自从 0 开始）。
         */
        const alignY = reserveHorizontal(center, y2, CLEAR_STEP);
        pts.push(`H ${round2(laneX)}`);
        pts.push(`V ${round2(alignY)}`);

        // 进入目标卡片。指向同一张卡左边中点的收敛段天然会重合
        // （例如 `F-LSF→F-QUAL` 与 `F-WSF→F-QUAL` 都落到 cy 296.99），
        // 这是规则决定的必经汇聚，无法在进入处分开；登记占用是为了
        // 别再叠上第三条无关的横线。
        reserveHorizontal(x2, alignY, CLEAR_STEP);
        pts.push(`H ${round2(x2)}`);
        d = dedupe(pts).join(' ');
      } else {
        /**
         * 相邻列连线：竖段走两列正中间的通道，并**登记横线占用**。
         *
         * `buildConnectorPath` 只负责竖段分车道；同高度的两条横线
         * （例如 `F-L1A→F-L2A` 与另一条恰好同高的线）仍会重叠，
         * 因此这里显式登记起止高度。
         */
        const center = channelBetween(ci ?? 0, cj ?? 0);
        laneKey = Math.round(center);
        const used = laneCount.get(laneKey) ?? 0;
        laneCount.set(laneKey, used + 1);

        if (Math.abs(y2 - y1) < 0.5 && x2 > x1) {
          // 同一行直连：整条都是横线，必须独占一个高度
          const y = reserveHorizontal(center, y1, CLEAR_STEP);
          d = `M ${round2(x1)} ${round2(y)} H ${round2(x2)}`;
        } else {
          const fromY = reserveHorizontal(center, y1, CLEAR_STEP);
          const toY = reserveHorizontal(center, y2, CLEAR_STEP);
          d = buildConnectorPath(x1, fromY, x2, toY, used);
        }
      }

      out.push({ key: `${conn.fromId}->${conn.toId}-${conn.via}`, d, via: conn.via });
    }
    return out;
    // 依赖的是已经应用到 DOM 上的 top/left 与实测高度：位置变化必须重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, heights, columnWidth, columns]);

  /**
   * 画布高度。
   *
   * 关键：这里**不能只看实测高度**。`heights` 状态永远是上一帧的，
   * 而列宽又会随视口变化（窄屏 `minColumnWidth` 兜底 → 卡片更窄 →
   * 队名多换一行 → 真实高度比上一帧记录的大）。只看实测值就会把
   * 最下面那场比赛裁掉，而且因为 `overflow-x: auto` 会把 `overflow-y`
   * 提升成 `auto`，被裁掉的部分**滚都滚不到**。
   *
   * 因此取三条线的最大值，保证只会偏高、永不低于真实内容：
   * 1. `layout.totalHeight` —— 按**当前** heights 算出的内容底边；
   * 2. `measuredHeight` —— DOM 实测底边（含列标题），兜住换行/字体晚加载；
   * 3. `FALLBACK_HEIGHT` —— 首帧兜底。
   *
   * 多出来的几像素是透明的，不影响观感；少一像素就是一场比赛看不见。
   */
  const maxHeight = Math.max(layout.totalHeight, measuredHeight, FALLBACK_HEIGHT);

  return (
    <div className="bracket">
      {legend ? <div className="bracket__legend">{legend}</div> : null}

      <div
        className="bracket__scroller"
        ref={scrollerRef}
        role="group"
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <div
          className="bracket__board"
          ref={boardRef}
          data-density={density}
          style={{ width: totalWidth, minHeight: maxHeight }}
        >
          {/*
            连线层：绝对定位、不接收指针事件。

            先画一遍"背景外衣"再画线：两种颜色（胜者实线／败者虚线）
            在通道里交叉时，外衣会把下层线切断一小段，
            视觉上能看清是两条线，而不是混成一色。
          */}
          <svg
            className="bracket__connectors"
            width={totalWidth}
            height={maxHeight}
            aria-hidden="true"
          >
            {paths.map((p) => (
              <path key={`c-${p.key}`} className="bracket__link-casing" d={p.d} />
            ))}
            {paths.map((p) => (
              <path key={p.key} className={`bracket__link bracket__link--${p.via}`} d={p.d} />
            ))}
          </svg>

          {layout.bands.map((band) => (
            <div
              key={band.band}
              className="bracket__band"
              style={{ top: band.top, height: band.height }}
              data-band={band.band}
            />
          ))}

          {columns.map((col, ci) => (
            <div
              key={col.key}
              className="bracket__column"
              style={{
                left: ci * (columnWidth + GAP),
                width: columnWidth,
                top: layout.columnOffsets[col.key] ?? 0,
              }}
            >
              <div className="bracket__column-title">{col.title}</div>
              {/*
                高度取**本列**内容高度，不是全局 maxHeight。
                取全局值会让矮列（决赛只有 2 张卡）的 body 撑到 6000px，
                而它的节点是绝对定位在 body 内的，于是 body 溢出列与画布，
                页面出现双倍高度的滚动区，各列在视觉上糊成一团。
              */}
              <div
                className="bracket__column-body"
                style={{ height: layout.columnHeights[col.key] ?? 0 }}
              >
                {layout.sectionTops[col.key]?.map((sec) => (
                  <div
                    key={sec.section}
                    className="bracket__section"
                    style={{ top: sec.top, height: sec.height }}
                  >
                    <span className="bracket__section-label">
                      {sectionLabel ? sectionLabel(sec.section) : sec.section}
                    </span>
                  </div>
                ))}

                {col.nodes.map((node) => {
                  const content = renderNode(node.id);
                  const top = layout.tops[node.id] ?? 0;
                  return (
                    <div
                      key={node.id}
                      data-node-id={node.id}
                      className="bracket__node"
                      style={{ top }}
                    >
                      <NodeCard content={content} showSecondary={showSecondary} linkable={Boolean(content.to)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeCard({
  content,
  showSecondary,
  linkable,
}: {
  content: BracketNodeContent;
  showSecondary: boolean;
  linkable: boolean;
}) {
  const statusClass =
    content.status === 'live'
      ? 'bracket-card--live'
      : content.status === 'done'
        ? 'bracket-card--done'
        : '';

  const body = (
    <>
      <div className="bracket-card__title">{content.title}</div>
      <div className="bracket-card__rows">
        {content.rows.map((row, i) => (
          <div key={i} className={`bracket-card__row${row.isWinner ? ' is-winner' : ''}`}>
            {row.side ? <SideBadge side={row.side} /> : null}
            <span className={`bracket-card__team${row.dim ? ' is-dim' : ''}`} title={row.team ?? row.label}>
              {row.team ?? <span className="muted">{row.label}</span>}
            </span>
            {row.isWinner ? <span aria-label="胜者">✔</span> : null}
          </div>
        ))}
      </div>
      {showSecondary && content.meta ? (
        <div className="bracket-card__meta">{content.meta}</div>
      ) : null}
    </>
  );

  if (linkable && content.to) {
    return (
      <Link to={content.to} className={`bracket-card ${statusClass}`}>
        {body}
      </Link>
    );
  }
  return <div className={`bracket-card ${statusClass}`}>{body}</div>;
}
