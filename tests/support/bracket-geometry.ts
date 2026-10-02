/** 浏览器实测 SVG 路径的几何约束；不依赖生产环境的路由算法。 */
export interface Point { x: number; y: number }
export interface MeasuredPath { from: string; to: string; d: string }
export interface MeasuredNode { id: string; left: number; right: number; top: number; bottom: number }
export interface MeasuredBoard { zone: string; paths: MeasuredPath[]; nodes: MeasuredNode[] }
interface Segment { start: Point; end: Point; axis: 'h' | 'v'; index: number }
const EPSILON = 0.2;
const close = (a: number, b: number) => Math.abs(a - b) <= EPSILON;
const same = (a: Point, b: Point) => close(a.x, b.x) && close(a.y, b.y);
const inside = (n: number, a: number, b: number) => n > Math.min(a, b) + EPSILON && n < Math.max(a, b) - EPSILON;

/** 只接受实际图中使用的绝对直角命令，避免无法解析时误报通过。 */
export function pathPoints(d: string): Point[] {
  const commands = [...d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)];
  const points: Point[] = [];
  for (const [, command, coordinates] of commands) {
    const values = coordinates!.trim().split(/[\s,]+/).map(Number);
    const previous = points.at(-1);
    if (values.some(value => !Number.isFinite(value))) throw new Error(`非有限路径坐标：${d}`);
    if ((command === 'M' || command === 'L') && values.length === 2) points.push({ x: values[0]!, y: values[1]! });
    else if (command === 'H' && values.length === 1 && previous) points.push({ x: values[0]!, y: previous.y });
    else if (command === 'V' && values.length === 1 && previous) points.push({ x: previous.x, y: values[0]! });
    else throw new Error(`未支持的路径命令：${d}`);
  }
  if (points.length < 2) throw new Error(`路径没有实际线段：${d}`);
  return points;
}

export function treeGeometryProblems(board: MeasuredBoard): string[] {
  const issues: string[] = [];
  const paths = board.paths.map(path => {
    const points = pathPoints(path.d);
    const segments: Segment[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]!, end = points[index]!;
      if (same(start, end)) continue;
      if (!close(start.x, end.x) && !close(start.y, end.y)) issues.push(`${path.from}→${path.to} 出现斜线`);
      segments.push({ start, end, axis: close(start.y, end.y) ? 'h' : 'v', index: segments.length });
    }
    const vertical = segments.filter(segment => segment.axis === 'v');
    if (vertical.length > 1) issues.push(`${path.from}→${path.to} 有多余竖直折返`);
    if (segments.some(segment => segment.end.x < segment.start.x - EPSILON)) issues.push(`${path.from}→${path.to} 向左折返`);
    const from = board.nodes.find(node => node.id === path.from), to = board.nodes.find(node => node.id === path.to);
    if (!from || !to) issues.push(`${path.from}→${path.to} 缺少比赛卡片`);
    else {
      if (!same(points[0]!, { x: from.right, y: (from.top + from.bottom) / 2 })) issues.push(`${path.from}→${path.to} 起点偏离来源中心`);
      if (!same(points.at(-1)!, { x: to.left, y: (to.top + to.bottom) / 2 })) issues.push(`${path.from}→${path.to} 终点偏离目标中心`);
    }
    return { ...path, points, segments };
  });
  for (let first = 0; first < paths.length; first += 1) for (let second = first + 1; second < paths.length; second += 1) {
    const a = paths[first]!, b = paths[second]!;
    const label = `${a.from}→${a.to} / ${b.from}→${b.to}`;
    const sharedTarget = a.to === b.to && same(a.points.at(-1)!, b.points.at(-1)!);
    if (a.to === b.to && !sharedTarget) issues.push(`${label} 同一目标出现不同汇入口`);
    for (const sa of a.segments) for (const sb of b.segments) {
      if (sa.axis !== sb.axis) {
        const h = sa.axis === 'h' ? sa : sb, v = sa.axis === 'v' ? sa : sb;
        if (inside(v.start.x, h.start.x, h.end.x) && inside(h.start.y, v.start.y, v.end.y)) issues.push(`${label} 十字交叉 (${v.start.x}, ${h.start.y})`);
        continue;
      }
      if (sa.axis === 'v') {
        const sharedTrunk = sharedTarget && same(sa.end, sb.end)
          && sa.index === a.segments.length - 2 && sb.index === b.segments.length - 2
          && a.segments.at(-1)?.axis === 'h' && b.segments.at(-1)?.axis === 'h';
        if (!sharedTrunk && close(sa.start.x, sb.start.x) && Math.min(Math.max(sa.start.y, sa.end.y), Math.max(sb.start.y, sb.end.y)) - Math.max(Math.min(sa.start.y, sa.end.y), Math.min(sb.start.y, sb.end.y)) > EPSILON) issues.push(`${label} 竖直段重叠`);
        continue;
      }
      const overlap = Math.min(sa.end.x, sb.end.x) - Math.max(sa.start.x, sb.start.x);
      if (!close(sa.start.y, sb.start.y) || overlap <= EPSILON) continue;
      // 只有共享实际终点的最后一段可以合并，不能放行任意同目标重叠。
      const finalMerge = sharedTarget && sa.index === a.segments.length - 1 && sb.index === b.segments.length - 1 && same(sa.end, sb.end);
      if (!finalMerge) issues.push(`${label} 非汇入段水平重叠`);
    }
  }
  return issues.map(issue => `${board.zone}: ${issue}`);
}
