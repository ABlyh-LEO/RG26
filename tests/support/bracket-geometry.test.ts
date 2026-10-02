import { describe, expect, it } from 'vitest';
import { pathPoints, treeGeometryProblems, type MeasuredBoard } from './bracket-geometry';

const board = (paths: MeasuredBoard['paths']): MeasuredBoard => ({
  zone: 'test', paths,
  nodes: [
    { id: 'upper', left: 0, right: 100, top: 0, bottom: 100 },
    { id: 'lower', left: 0, right: 100, top: 200, bottom: 300 },
    { id: 'target', left: 200, right: 300, top: 100, bottom: 200 },
  ],
});

describe('浏览器晋级线路径交叉检测', () => {
  it('允许两个分支在同一个目标中心汇合及共享最后水平段', () => {
    expect(treeGeometryProblems(board([
      { from: 'upper', to: 'target', d: 'M 100 50 H 150 V 150 H 200' },
      { from: 'lower', to: 'target', d: 'M 100 250 H 150 V 150 H 200' },
    ]))).toEqual([]);
  });
  it('捕获旧路由错开汇入口导致的十字交叉，而不只检测平行重叠', () => {
    const issues = treeGeometryProblems(board([
      { from: 'upper', to: 'target', d: 'M 100 50 H 145 V 150 H 200' },
      { from: 'lower', to: 'target', d: 'M 100 250 H 155 V 132 H 200' },
    ]));
    expect(issues.some(issue => issue.includes('十字交叉'))).toBe(true);
    expect(issues.some(issue => issue.includes('同一目标出现不同汇入口'))).toBe(true);
  });
  it('目标被长卡片推到两来源同侧时允许真实共享树干', () => {
    const measured = board([
      { from: 'upper', to: 'target', d: 'M 100 50 H 150 V 350 H 200' },
      { from: 'lower', to: 'target', d: 'M 100 250 H 150 V 350 H 200' },
    ]);
    measured.nodes[2] = { id: 'target', left: 200, right: 300, top: 300, bottom: 400 };
    expect(treeGeometryProblems(measured)).toEqual([]);
  });
  it('拒绝在共同终点之外重叠的线及多余竖直折返', () => {
    const issues = treeGeometryProblems(board([
      { from: 'upper', to: 'target', d: 'M 100 50 H 140 V 130 H 160 V 150 H 200' },
      { from: 'lower', to: 'target', d: 'M 100 250 H 140 V 130 H 180 V 150 H 200' },
    ]));
    expect(issues.some(issue => issue.includes('非汇入段水平重叠'))).toBe(true);
    expect(issues.some(issue => issue.includes('多余竖直折返'))).toBe(true);
  });
  it('拒绝两个分支竖直段重叠后才分开，防止错误的汇点被忽略', () => {
    const issues = treeGeometryProblems(board([
      { from: 'upper', to: 'target', d: 'M 100 50 H 150 V 200 H 175 V 150 H 200' },
      { from: 'lower', to: 'target', d: 'M 100 250 H 150 V 150 H 200' },
    ]));
    expect(issues.some(issue => issue.includes('竖直段重叠'))).toBe(true);
  });
  it('不能解析的 SVG 命令不得悄悄跳过检查', () => {
    expect(() => pathPoints('M 100 50 Q 150 100 200 150')).toThrow('未支持的路径命令');
  });
});
