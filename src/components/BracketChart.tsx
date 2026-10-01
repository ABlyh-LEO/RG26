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

export interface BracketNodeContent {
  /** 卡片主体。 */
  title: string;
  /** 主行（对阵双方）。 */
  rows: { label: string; team: string | null; isWinner?: boolean; dim?: boolean }[];
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

    /** 每个节点所属的列序号，用来判断连线是否跨列。 */
    const columnOfNode = new Map<string, number>();
    columns.forEach((col, ci) => {
      for (const n of col.nodes) columnOfNode.set(n.id, ci);
    });

    /**
     * 列间通道要**分车道**。
     *
     * 同一段间隙里往往有多条线竖直穿过（八强赛→半决赛有 5 条）。
     * 如果它们都走同一个 x，就会重叠成一条，看起来像"少了几条线、
     * 连错了地方"。这里按竖直段的行进方向给每条线一个独立偏移，
     * 让它们在通道内并排。
     */
    const laneCount = new Map<number, number>();

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
       * 跨列连线（胜者组一路直通半决赛/总决赛，跳过败者组的列）走**列间通道**，
       * 不要横穿中间那一列的卡片：
       * 起点先水平走一小段进入通道，再竖直移动，最后水平进入目标。
       *
       * 车道与相邻列共用同一套 offset 公式（见 buildConnectorPath），
       * 否则两套方案会在 x=212 附近撞到同一个位置。
       */
      let d: string;
      const laneKey = Math.round(x1);
      const used = laneCount.get(laneKey) ?? 0;
      laneCount.set(laneKey, used + 1);

      if (spansColumns) {
        // 通道就是本列右侧那段间隙：x1 → x1 + GAP。
        // 与相邻列共用 laneOffset，否则两套方案会在同一 x 上撞车。
        const laneX = x1 + GAP / 2 + laneOffset(GAP, used);
        d = `M ${x1} ${y1} H ${laneX} V ${y2} H ${x2}`;
      } else {
        d = buildConnectorPath(x1, y1, x2, y2, used);
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
