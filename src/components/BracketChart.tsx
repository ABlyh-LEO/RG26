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

const GAP = 12;
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

  /**
   * 实测每个节点高度，再交给纯函数布局。队名换行时高度会变，必须实测。
   *
   * 可用宽度取**滚动容器**的宽度，绝不能取 board 自己的宽度：
   * board 的宽度是由 columnWidth 算出来的，用它会形成自反馈，
   * 宽度会一轮轮放大到几百万像素。
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

    const scroller = scrollerRef.current;
    if (scroller) {
      const w = scroller.clientWidth;
      setViewportWidth((prev) => (prev === w ? prev : w));
    }
  }, []);

  // 首帧与数据变化后测量
  useLayoutEffect(() => {
    measure();
  }, [measure, columns, connections]);

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

  // 首次渲染 viewportWidth 还是 0，用 minColumnWidth 兜底，测量后再收敛
  const columnWidth =
    viewportWidth > 0
      ? Math.max(minColumnWidth, Math.floor(viewportWidth / visibleColumns) - GAP)
      : minColumnWidth;
  const totalWidth = columns.length * (columnWidth + GAP) - GAP;

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
      out.push({ key: `${conn.fromId}->${conn.toId}-${conn.via}`, d: buildConnectorPath(x1, y1, x2, y2), via: conn.via });
    }
    return out;
    // 依赖的是已经应用到 DOM 上的 top/left 与实测高度：位置变化必须重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, heights, columnWidth]);

  const maxHeight = Math.max(
    ...columns.map((c) => (layout.columnOffsets[c.key] ?? 0) + (layout.columnHeights[c.key] ?? 0)),
    FALLBACK_HEIGHT,
  );

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
          {/* 连线层：绝对定位、不接收指针事件 */}
          <svg
            className="bracket__connectors"
            width={totalWidth}
            height={maxHeight}
            aria-hidden="true"
          >
            {paths.map((p) => (
              <path key={p.key} className={`bracket__link bracket__link--${p.via}`} d={p.d} fill="none" />
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
              <div className="bracket__column-body" style={{ height: maxHeight }}>
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
