/**
 * 红蓝方归属测试。
 *
 * 口径（组委会确认）：
 * 1. 默认：第一个席位 = **蓝方**，第二个席位 = **红方**。
 * 2. 瑞士轮**偶数轮（R2/R4）反向**。
 * 3. 八强双败（决赛）**不反向**。
 * 4. 决赛 BO3 **全系列赛不换边**，每局第一席位蓝、第二席位红。
 * 5. 决赛 BO1 **不换边**。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDES,
  SWAPPED_SIDES,
  assignSides,
  isSwissRoundSwapped,
  sideLabel,
  sideOfTeam,
  sideOfTeamInSeriesGame,
  sideOfTeamInSwiss,
  sidesForFinals,
  sidesForSeriesGame,
  sidesForSwiss,
  swissSidesOf,
} from '../../src/domain/sides';

describe('红蓝方：默认与瑞士轮', () => {
  it('默认第一个席位是蓝方、第二个是红方', () => {
    expect(DEFAULT_SIDES).toEqual({ first: 'blue', second: 'red' });
  });

  it('瑞士轮奇数轮（R1/R3/R5）用默认：第一蓝、第二红', () => {
    for (const round of [1, 3, 5]) {
      expect(isSwissRoundSwapped(round), `R${round} 不应反向`).toBe(false);
      expect(sidesForSwiss(round)).toEqual(DEFAULT_SIDES);
    }
  });

  it('瑞士轮偶数轮（R2/R4）反向：第一红、第二蓝', () => {
    for (const round of [2, 4]) {
      expect(isSwissRoundSwapped(round), `R${round} 应反向`).toBe(true);
      expect(sidesForSwiss(round)).toEqual(SWAPPED_SIDES);
    }
  });

  it('assignSides 把席位映射到颜色（默认）', () => {
    expect(assignSides('A', 'B', DEFAULT_SIDES)).toEqual({ blue: 'A', red: 'B' });
  });

  it('assignSides 把席位映射到颜色（反向）', () => {
    expect(assignSides('A', 'B', SWAPPED_SIDES)).toEqual({ blue: 'B', red: 'A' });
  });

  it('sideOfTeam 按席位返回颜色', () => {
    expect(sideOfTeam('A', 'A', 'B', DEFAULT_SIDES)).toBe('blue');
    expect(sideOfTeam('B', 'A', 'B', DEFAULT_SIDES)).toBe('red');
    expect(sideOfTeam('C', 'A', 'B', DEFAULT_SIDES)).toBeNull();
  });

  it('颜色标签是中文', () => {
    expect(sideLabel('red')).toBe('红方');
    expect(sideLabel('blue')).toBe('蓝方');
  });
});

describe('红蓝方：从比赛推出', () => {
  it('R1 第一席位蓝、第二席位红', () => {
    const r = swissSidesOf({ roundIndex: 1, participantSnapshot: ['A', 'B'] })!;
    expect(r.blue).toBe('A');
    expect(r.red).toBe('B');
  });

  it('R2 换边：第一席位红、第二席位蓝', () => {
    const r = swissSidesOf({ roundIndex: 2, participantSnapshot: ['A', 'B'] })!;
    expect(r.blue).toBe('B');
    expect(r.red).toBe('A');
  });

  it('R4 换边', () => {
    const r = swissSidesOf({ roundIndex: 4, participantSnapshot: ['A', 'B'] })!;
    expect(r.blue).toBe('B');
    expect(r.red).toBe('A');
  });

  it('对阵未公布时返回 null（不猜红蓝方）', () => {
    expect(swissSidesOf({ roundIndex: 1, participantSnapshot: null })).toBeNull();
  });

  it('sideOfTeamInSwiss 按队查询颜色', () => {
    expect(sideOfTeamInSwiss({ roundIndex: 1, participantSnapshot: ['A', 'B'] }, 'A')).toBe('blue');
    expect(sideOfTeamInSwiss({ roundIndex: 2, participantSnapshot: ['A', 'B'] }, 'A')).toBe('red');
    expect(sideOfTeamInSwiss({ roundIndex: 1, participantSnapshot: null }, 'A')).toBeNull();
  });

  it('同一对队伍在不同轮次颜色不同（红蓝大致均衡）', () => {
    const r1 = swissSidesOf({ roundIndex: 1, participantSnapshot: ['A', 'B'] })!;
    const r2 = swissSidesOf({ roundIndex: 2, participantSnapshot: ['A', 'B'] })!;
    expect(r1.blue).not.toBe(r2.blue);
  });
});

describe('红蓝方：决赛', () => {
  it('八强双败不反向：第一蓝、第二红', () => {
    expect(sidesForFinals()).toEqual(DEFAULT_SIDES);
    expect(sidesForFinals()).toEqual({ first: 'blue', second: 'red' });
  });

  it('决赛 BO1（第 1 局）不换边', () => {
    expect(sidesForSeriesGame(1)).toEqual(DEFAULT_SIDES);
  });

  it('BO3 全系列赛固定颜色：第 1、2、3 局都是第一蓝、第二红', () => {
    expect(sidesForSeriesGame(1)).toEqual({ first: 'blue', second: 'red' });
    expect(sidesForSeriesGame(2)).toEqual({ first: 'blue', second: 'red' });
    expect(sidesForSeriesGame(3)).toEqual({ first: 'blue', second: 'red' });
  });

  it('BO3 同一队的颜色不随局号改变', () => {
    for (const index of [1, 2, 3]) {
      expect(sideOfTeamInSeriesGame('A', 'A', 'B', index)).toBe('blue');
      expect(sideOfTeamInSeriesGame('B', 'A', 'B', index)).toBe('red');
    }
  });

  it('BO3 双方每局恰好一红一蓝', () => {
    for (const idx of [1, 2, 3]) {
      const a = sideOfTeamInSeriesGame('A', 'A', 'B', idx);
      const b = sideOfTeamInSeriesGame('B', 'A', 'B', idx);
      expect([a, b].sort(), `第 ${idx} 局`).toEqual(['blue', 'red']);
    }
  });

  it('BO3 逐局颜色映射保持相同的实际队伍归属', () => {
    const teams = [1, 2, 3].map((index) => assignSides('蓝方队伍', '红方队伍', sidesForSeriesGame(index)));
    expect(teams).toEqual(Array.from({ length: 3 }, () => ({ blue: '蓝方队伍', red: '红方队伍' })));
  });

  it('非参赛队伍没有颜色', () => {
    expect(sideOfTeamInSeriesGame('C', 'A', 'B', 1)).toBeNull();
  });
});

describe('红蓝方：纯函数性质', () => {
  it('同样输入产生同样结果（确定性）', () => {
    for (const round of [1, 2, 3, 4, 5]) {
      expect(sidesForSwiss(round)).toEqual(sidesForSwiss(round));
    }
    for (const idx of [1, 2, 3]) {
      expect(sidesForSeriesGame(idx)).toEqual(sidesForSeriesGame(idx));
    }
  });

  it('不修改输入', () => {
    const snapshot = ['A', 'B'] as [string, string];
    const before = JSON.stringify(snapshot);
    swissSidesOf({ roundIndex: 2, participantSnapshot: snapshot });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('每场对抗比赛都有确定的红蓝方（席位数不为 1）', () => {
    for (const round of [1, 2, 3, 4, 5]) {
      const r = swissSidesOf({ roundIndex: round, participantSnapshot: ['A', 'B'] })!;
      expect(new Set([r.blue, r.red]).size, `R${round} 应恰好两队`).toBe(2);
    }
  });
});
