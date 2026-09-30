/**
 * 决赛依赖图、BO3 与小局处理（D12、D13、D15、D16）。
 */
import { describe, expect, it } from 'vitest';
import type { FinalsSeeding, Series } from '../../src/domain/schema';
import {
  assignFinalsSeeds,
  computeAwards,
  FINALS_MATCH_ORDER,
  FINALS_NODES,
  requiredWins,
  resolveFinals,
  resolveSeriesGames,
  validateFinalsGraph,
  deriveExtras,
} from '../../src/domain/finals';
import { calculateSwissStandings } from '../../src/domain/standings';
import { makeAttempt, makeMatch, rankingFixtureFrom, simulateSwiss, t } from '../fixtures/finals-scenario';

/** 构造一个空系列赛（通过真实的 seed 工厂以保持结构一致）。 */
function emptySeries(id: string, format: 'BO1' | 'BO2' | 'BO3'): Series {
  const node = FINALS_NODES.find((n) => n.id === id)!;
  const gameCount = format === 'BO1' ? 1 : format === 'BO2' ? 2 : 3;
  return {
    id,
    format,
    stage: node.stage,
    countsForStandings: node.countsForStandings,
    slots: node.slots,
    participantSnapshot: null,
    games: Array.from({ length: gameCount }, (_, i) => ({
      id: `${id}-g${i + 1}`,
      index: i + 1,
      homeTeamId: null,
      awayTeamId: null,
      homeScore: null,
      awayScore: null,
      winnerId: null,
      resultKind: 'normal' as const,
      resultStatus: 'none' as const,
      confirmedAt: null,
      note: null,
    })),
    executionStatus: 'scheduled' as const,
    scheduleItemId: `sched-${id}`,
    showcaseTeamId: null,
    note: null,
  };
}

function allEmptySeries(): Series[] {
  return FINALS_NODES.map((n) => emptySeries(n.id, n.format));
}

function seeding(seeds: Record<string, string>): FinalsSeeding {
  return {
    seeds,
    basisNote: '测试',
    version: 1,
    publicationStatus: 'published',
    publishedAt: '2026-10-04T12:00:00+08:00',
  };
}

/** 给一个 BO1 系列赛填入结果。 */
function playBo1(series: Series, homeId: string, awayId: string, winnerId: string): Series {
  return {
    ...series,
    participantSnapshot: [homeId, awayId],
    executionStatus: 'finished',
    games: series.games.map((g, i) =>
      i === 0
        ? {
            ...g,
            homeTeamId: homeId,
            awayTeamId: awayId,
            homeScore: winnerId === homeId ? '16' : '0',
            awayScore: winnerId === awayId ? '16' : '0',
            winnerId,
            resultStatus: 'confirmed' as const,
            confirmedAt: '2026-10-04T15:00:00+08:00',
          }
        : g,
    ),
  };
}

describe('D12 决赛按映射推进', () => {
  it('两场败者组第二轮是交叉来源，对手对应准确', () => {
    const nodes = new Map(FINALS_NODES.map((n) => [n.id, n]));

    // F-L2A: loser(F-W1A) 对 winner(F-L1B)
    const l2a = nodes.get('F-L2A')!;
    expect(l2a.slots).toEqual([
      { kind: 'loser', seriesId: 'F-W1A' },
      { kind: 'winner', seriesId: 'F-L1B' },
    ]);

    // F-L2B: loser(F-W1B) 对 winner(F-L1A)
    const l2b = nodes.get('F-L2B')!;
    expect(l2b.slots).toEqual([
      { kind: 'loser', seriesId: 'F-W1B' },
      { kind: 'winner', seriesId: 'F-L1A' },
    ]);

    // 与原文附一一致：W1/W4 负者对 L2/L3 胜者、W2/W3 负者对 L1/L4 胜者
    expect(nodes.get('F-L1A')!.slots).toEqual([
      { kind: 'finals-seed', seed: 'L1' },
      { kind: 'finals-seed', seed: 'L4' },
    ]);
    expect(nodes.get('F-L1B')!.slots).toEqual([
      { kind: 'finals-seed', seed: 'L2' },
      { kind: 'finals-seed', seed: 'L3' },
    ]);
    expect(nodes.get('F-W1A')!.slots).toEqual([
      { kind: 'finals-seed', seed: 'W1' },
      { kind: 'finals-seed', seed: 'W4' },
    ]);
    expect(nodes.get('F-W1B')!.slots).toEqual([
      { kind: 'finals-seed', seed: 'W2' },
      { kind: 'finals-seed', seed: 'W3' },
    ]);
  });

  it('完整推进一轮：胜败流转到正确的下游槽位', () => {
    const seeds = {
      W1: 'w1',
      W2: 'w2',
      W3: 'w3',
      W4: 'w4',
      L1: 'l1',
      L2: 'l2',
      L3: 'l3',
      L4: 'l4',
    };
    const list = allEmptySeries();
    const get = (id: string) => list.find((s) => s.id === id)!;
    const set = (s: Series) => {
      const i = list.findIndex((x) => x.id === s.id);
      list[i] = s;
    };

    // 八强败者组首轮：L1 胜 L4（l4 淘汰）；L2 胜 L3（l3 淘汰）
    set(playBo1(get('F-L1A'), 'l1', 'l4', 'l1'));
    set(playBo1(get('F-L1B'), 'l2', 'l3', 'l2'));
    // 八强胜者组：W1 胜 W4；W2 胜 W3
    set(playBo1(get('F-W1A'), 'w1', 'w4', 'w1'));
    set(playBo1(get('F-W1B'), 'w2', 'w3', 'w2'));

    const r1 = resolveFinals(list, seeding(seeds));

    // F-L2A = loser(F-W1A)=w4 对 winner(F-L1B)=l2
    const l2a = r1.series.get('F-L2A')!;
    expect(l2a.slots[0]).toEqual({ state: 'resolved', teamId: 'w4' });
    expect(l2a.slots[1]).toEqual({ state: 'resolved', teamId: 'l2' });

    // F-L2B = loser(F-W1B)=w3 对 winner(F-L1A)=l1
    const l2b = r1.series.get('F-L2B')!;
    expect(l2b.slots[0]).toEqual({ state: 'resolved', teamId: 'w3' });
    expect(l2b.slots[1]).toEqual({ state: 'resolved', teamId: 'l1' });

    // 下游尚未决定时保持 pending，并给出可读的来源说明
    const pendingLabel = (id: string, index: 0 | 1): string => {
      const slot = r1.series.get(id)!.slots[index];
      expect(slot.state).toBe('pending');
      return slot.state === 'pending' ? slot.label : '';
    };
    expect(pendingLabel('F-LSF', 0)).toBe('F-L2A 胜者');
    expect(pendingLabel('F-QUAL', 0)).toBe('F-LSF 胜者');
    expect(pendingLabel('F-GF', 0)).toBe('F-WSF 胜者');
  });

  it('完整结算出冠军、亚军与季军', () => {
    const seeds = { W1: 'w1', W2: 'w2', W3: 'w3', W4: 'w4', L1: 'l1', L2: 'l2', L3: 'l3', L4: 'l4' };
    const list = allEmptySeries();
    const get = (id: string) => list.find((s) => s.id === id)!;
    const set = (s: Series) => {
      list[list.findIndex((x) => x.id === s.id)] = s;
    };

    set(playBo1(get('F-L1A'), 'l1', 'l4', 'l1'));
    set(playBo1(get('F-L1B'), 'l2', 'l3', 'l2'));
    set(playBo1(get('F-W1A'), 'w1', 'w4', 'w1'));
    set(playBo1(get('F-W1B'), 'w2', 'w3', 'w2'));
    set(playBo1(get('F-L2A'), 'w4', 'l2', 'w4'));
    set(playBo1(get('F-L2B'), 'w3', 'l1', 'l1'));
    set(playBo1(get('F-LSF'), 'w4', 'l1', 'w4'));
    set(playBo1(get('F-WSF'), 'w1', 'w2', 'w1'));

    // F-QUAL: winner(F-LSF)=w4 对 loser(F-WSF)=w2 → w4 胜（BO3 2-0）
    const qual = get('F-QUAL');
    set({
      ...qual,
      participantSnapshot: ['w4', 'w2'],
      executionStatus: 'finished',
      games: [
        { ...qual.games[0]!, homeTeamId: 'w4', awayTeamId: 'w2', winnerId: 'w4', resultStatus: 'confirmed' as const, homeScore: '16', awayScore: '0' },
        { ...qual.games[1]!, homeTeamId: 'w4', awayTeamId: 'w2', winnerId: 'w4', resultStatus: 'confirmed' as const, homeScore: '16', awayScore: '5' },
        qual.games[2]!,
      ],
    });

    // F-GF: winner(F-WSF)=w1 对 winner(F-QUAL)=w4 → w1 胜（BO3 2-1）
    const gf = get('F-GF');
    set({
      ...gf,
      participantSnapshot: ['w1', 'w4'],
      executionStatus: 'finished',
      games: [
        { ...gf.games[0]!, homeTeamId: 'w1', awayTeamId: 'w4', winnerId: 'w1', resultStatus: 'confirmed' as const, homeScore: '16', awayScore: '10' },
        { ...gf.games[1]!, homeTeamId: 'w1', awayTeamId: 'w4', winnerId: 'w4', resultStatus: 'confirmed' as const, homeScore: '5', awayScore: '16' },
        { ...gf.games[2]!, homeTeamId: 'w1', awayTeamId: 'w4', winnerId: 'w1', resultStatus: 'confirmed' as const, homeScore: '16', awayScore: '12' },
      ],
    });

    const result = resolveFinals(list, seeding(seeds));
    expect(result.awards.champion).toBe('w1');
    expect(result.awards.runnerUp).toBe('w4');
    expect(result.awards.third).toBe('w2');
    // 四强 = 半决赛败者（F-LSF 败者 l1）
    expect(result.awards.topFour).toEqual(['l1']);
    // 八强 = 两场败者组首轮败者 + 两场败者组第二轮败者
    expect(result.awards.topEight.sort()).toEqual(['l3', 'l4', 'l2', 'w3'].sort());
  });

  it('不得为并列奖项编造精确第 5–8 名', () => {
    const resolved = new Map();
    const awards = computeAwards(resolved);
    // 没有结果时全部为 null / 空数组，而不是编造名次
    expect(awards.champion).toBeNull();
    expect(awards.runnerUp).toBeNull();
    expect(awards.third).toBeNull();
    expect(awards.topFour).toEqual([]);
    expect(awards.topEight).toEqual([]);
  });
});

describe('D13 BO3 2-0 与 2-1', () => {
  it('2-0 时有效 2 局，第三局标记为不需要进行', () => {
    const series = emptySeries('F-QUAL', 'BO3');
    const played: Series = {
      ...series,
      participantSnapshot: ['a', 'b'],
      games: [
        { ...series.games[0]!, homeTeamId: 'a', awayTeamId: 'b', winnerId: 'a', resultStatus: 'confirmed' as const },
        { ...series.games[1]!, homeTeamId: 'a', awayTeamId: 'b', winnerId: 'a', resultStatus: 'confirmed' as const },
        series.games[2]!,
      ],
    };
    const r = resolveSeriesGames(played);
    expect(r.playedGames).toBe(2);
    expect(r.decided).toBe(true);
    expect(r.winnerId).toBe('a');
    expect(r.homeWins).toBe(2);
    expect(r.notNeeded).toEqual([3]);
  });

  it('2-1 时有效 3 局，没有不需要进行的局', () => {
    const series = emptySeries('F-GF', 'BO3');
    const played: Series = {
      ...series,
      participantSnapshot: ['a', 'b'],
      games: [
        { ...series.games[0]!, homeTeamId: 'a', awayTeamId: 'b', winnerId: 'a', resultStatus: 'confirmed' as const },
        { ...series.games[1]!, homeTeamId: 'a', awayTeamId: 'b', winnerId: 'b', resultStatus: 'confirmed' as const },
        { ...series.games[2]!, homeTeamId: 'a', awayTeamId: 'b', winnerId: 'b', resultStatus: 'confirmed' as const },
      ],
    };
    const r = resolveSeriesGames(played);
    expect(r.playedGames).toBe(3);
    expect(r.decided).toBe(true);
    expect(r.winnerId).toBe('b');
    expect(r.awayWins).toBe(2);
    expect(r.notNeeded).toEqual([]);
  });

  it('BO3 需要 2 胜，BO1 需要 1 胜', () => {
    expect(requiredWins('BO1')).toBe(1);
    expect(requiredWins('BO2')).toBe(2);
    expect(requiredWins('BO3')).toBe(2);
  });

  it('只打一组总决赛，没有重置', () => {
    // 决赛图中 F-GF 只有一个节点，且其来源是 winner(F-WSF) 与 winner(F-QUAL)
    const gfNodes = FINALS_NODES.filter((n) => n.id === 'F-GF');
    expect(gfNodes).toHaveLength(1);
    expect(gfNodes[0]!.format).toBe('BO3');
    // 不存在“重置赛”节点
    const resetLike = FINALS_NODES.filter((n) => /reset|重置/i.test(n.id) || /重置/.test(n.label));
    expect(resetLike).toEqual([]);
  });

  it('系列赛未决出胜者时不向下游推进', () => {
    const seeds = { W1: 'w1', W2: 'w2', W3: 'w3', W4: 'w4', L1: 'l1', L2: 'l2', L3: 'l3', L4: 'l4' };
    const list = allEmptySeries();
    const get = (id: string) => list.find((s) => s.id === id)!;
    const set = (s: Series) => {
      list[list.findIndex((x) => x.id === s.id)] = s;
    };
    set(playBo1(get('F-L1A'), 'l1', 'l4', 'l1'));
    // F-L1B 只打了一局但未确认 → 未决出
    const l1b = get('F-L1B');
    set({
      ...l1b,
      participantSnapshot: ['l2', 'l3'],
      executionStatus: 'running',
      games: [{ ...l1b.games[0]!, homeTeamId: 'l2', awayTeamId: 'l3', resultStatus: 'none' as const }],
    });

    const r = resolveFinals(list, seeding(seeds));
    expect(r.series.get('F-L1B')!.decided).toBe(false);
    // F-L2A 依赖 winner(F-L1B) → 必须保持 pending
    const l2a = r.series.get('F-L2A')!;
    expect(l2a.slots[1].state).toBe('pending');
  });
});

describe('八强种子分配', () => {
  it('3-0 前两名为 W1/W2，3-1 前三名为 W3/W4/L1，3-2 三名为 L2/L3/L4', () => {
    // 用完整合成赛程产生真实的 2/3/3/3/3/2 分布
    const ids = Array.from({ length: 16 }, (_, i) => t(i + 1));
    const scenario = simulateSwiss(ids, (_r, home, away) => {
      const hn = Number(home.split('-')[1]);
      const an = Number(away.split('-')[1]);
      return hn < an ? home : away;
    }, ids);
    const standings = calculateSwissStandings(ids, scenario.matches, rankingFixtureFrom(ids));

    const { seeds, blockers } = assignFinalsSeeds(standings);
    expect(blockers).toEqual([]);

    const g30 = standings.groups.find((g) => g.record === '3-0')!.entries;
    const g31 = standings.groups.find((g) => g.record === '3-1')!.entries;
    const g32 = standings.groups.find((g) => g.record === '3-2')!.entries;

    expect(seeds.W1).toBe(g30[0]!.teamId);
    expect(seeds.W2).toBe(g30[1]!.teamId);
    expect(seeds.W3).toBe(g31[0]!.teamId);
    expect(seeds.W4).toBe(g31[1]!.teamId);
    expect(seeds.L1).toBe(g31[2]!.teamId);
    expect(seeds.L2).toBe(g32[0]!.teamId);
    expect(seeds.L3).toBe(g32[1]!.teamId);
    expect(seeds.L4).toBe(g32[2]!.teamId);

    // 每个种子互不相同
    expect(new Set(Object.values(seeds)).size).toBe(8);
  });

  it('战绩组不足时阻断并报因', () => {
    const ids = Array.from({ length: 16 }, (_, i) => t(i + 1));
    // 空赛程：所有队伍都是 0-0
    const standings = calculateSwissStandings(ids, [], rankingFixtureFrom(ids));
    const { blockers } = assignFinalsSeeds(standings);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.join(' ')).toContain('3-0');
  });
});

describe('D16 图校验', () => {
  it('拒绝未知来源', () => {
    const list = allEmptySeries();
    const broken = list.map((s) =>
      s.id === 'F-GF' ? { ...s, slots: [{ kind: 'winner' as const, seriesId: 'NOPE' }, s.slots![1]] as typeof s.slots } : s,
    );
    const errors = validateFinalsGraph(broken);
    expect(errors.join(' ')).toContain('NOPE');
  });

  it('拒绝循环依赖', () => {
    const list = allEmptySeries();
    const broken = list.map((s) =>
      s.id === 'F-W1A'
        ? { ...s, slots: [{ kind: 'winner' as const, seriesId: 'F-L2A' }, s.slots![1]] as typeof s.slots }
        : s,
    );
    const errors = validateFinalsGraph(broken);
    expect(errors.join(' ')).toContain('循环');
  });

  it('拒绝自我依赖', () => {
    const list = allEmptySeries();
    const broken = list.map((s) =>
      s.id === 'F-LSF' ? { ...s, slots: [{ kind: 'winner' as const, seriesId: 'F-LSF' }, s.slots![1]] as typeof s.slots } : s,
    );
    const errors = validateFinalsGraph(broken);
    expect(errors.join(' ')).toContain('依赖自己');
  });

  it('拒绝自我对阵（两槽位来源相同）', () => {
    const list = allEmptySeries();
    const broken = list.map((s) =>
      s.id === 'F-W1A'
        ? { ...s, slots: [{ kind: 'finals-seed' as const, seed: 'W1' as const }, { kind: 'finals-seed' as const, seed: 'W1' as const }] as typeof s.slots }
        : s,
    );
    const errors = validateFinalsGraph(broken);
    expect(errors.join(' ')).toContain('自我对阵');
  });

  it('官方决赛图本身通过校验', () => {
    expect(validateFinalsGraph(allEmptySeries())).toEqual([]);
  });

  it('已保存的参赛快照优先于依赖解析，不一致时报冲突而不是静默改写', () => {
    const seeds = { W1: 'w1', W2: 'w2', W3: 'w3', W4: 'w4', L1: 'l1', L2: 'l2', L3: 'l3', L4: 'l4' };
    const list = allEmptySeries();
    const get = (id: string) => list.find((s) => s.id === id)!;
    const set = (s: Series) => {
      list[list.findIndex((x) => x.id === s.id)] = s;
    };

    set(playBo1(get('F-L1A'), 'l1', 'l4', 'l1'));
    set(playBo1(get('F-L1B'), 'l2', 'l3', 'l2'));
    set(playBo1(get('F-W1A'), 'w1', 'w4', 'w1'));
    set(playBo1(get('F-W1B'), 'w2', 'w3', 'w2'));

    // 人为把 F-L2A 的快照写成与依赖不符的队伍（模拟更正后旧下游已开赛）
    const l2a = get('F-L2A');
    set({
      ...l2a,
      participantSnapshot: ['XX', 'l2'],
      executionStatus: 'running',
      games: [{ ...l2a.games[0]!, homeTeamId: 'XX', awayTeamId: 'l2', resultStatus: 'none' as const }],
    });

    const r = resolveFinals(list, seeding(seeds));
    const resolved = r.series.get('F-L2A')!;
    // 必须保持快照记录的参赛队伍，并报冲突
    expect(resolved.slots[0].state).toBe('conflict');
    expect(resolved.conflicts.join(' ')).toContain('保持已发生的比赛记录');
  });
});

describe('D15 更正前置胜者且下游已开赛', () => {
  it('不把旧下游比分归给新队，并保留记录', () => {
    const seeds = { W1: 'w1', W2: 'w2', W3: 'w3', W4: 'w4', L1: 'l1', L2: 'l2', L3: 'l3', L4: 'l4' };
    const list = allEmptySeries();
    const get = (id: string) => list.find((s) => s.id === id)!;
    const set = (s: Series) => {
      list[list.findIndex((x) => x.id === s.id)] = s;
    };

    // 原本 F-W1A 是 w1 胜 w4
    set(playBo1(get('F-W1A'), 'w1', 'w4', 'w1'));
    // 下游 F-L2A 已经开赛，参赛方是 loser(F-W1A)=w4 与 winner(F-L1B)
    set(playBo1(get('F-L1B'), 'l2', 'l3', 'l2'));
    const l2a = get('F-L2A');
    set({
      ...l2a,
      participantSnapshot: ['w4', 'l2'],
      executionStatus: 'running',
      games: [{ ...l2a.games[0]!, homeTeamId: 'w4', awayTeamId: 'l2', resultStatus: 'none' as const }],
    });

    // 现在把 F-W1A 的胜者更正为 w4（那么 loser 变成 w1）
    set(playBo1(get('F-W1A'), 'w1', 'w4', 'w4'));

    const r = resolveFinals(list, seeding(seeds));
    const resolved = r.series.get('F-L2A')!;
    // 依赖现在解析为 w1，但快照记录的是 w4 → 冲突，且保持快照
    expect(resolved.slots[0]).toEqual({
      state: 'conflict',
      label: 'F-W1A 败者',
      reason: expect.stringContaining('保持已发生的比赛记录'),
    });
    // 已开赛比赛的记录没有被抹掉
    const stored = list.find((s) => s.id === 'F-L2A')!;
    expect(stored.participantSnapshot).toEqual(['w4', 'l2']);
  });
});

describe('奖项与瑞士轮淘汰者', () => {
  it('由瑞士轮排名导出十六强与优秀奖', () => {
    const ids = Array.from({ length: 16 }, (_, i) => t(i + 1));
    const scenario = simulateSwiss(ids, (_r, home, away) => {
      const hn = Number(home.split('-')[1]);
      const an = Number(away.split('-')[1]);
      return hn < an ? home : away;
    }, ids);
    const standings = calculateSwissStandings(ids, scenario.matches, rankingFixtureFrom(ids));
    // 排位赛 1–22，其中 17–22 为优秀奖；这里用 22 队顺序的前 16 名作为晋级
    const qualOrder = Array.from({ length: 22 }, (_, i) => t(i + 1));
    const extras = deriveExtras(standings, qualOrder);
    // 瑞士轮淘汰者 = 达到 3 负的队伍，即 2-3、1-3、0-3 三组，共 3+3+2 = 8 队
    expect(extras.topSixteen).toHaveLength(8);
    // 优秀奖 = 排位赛 17–22，共 6 队
    expect(extras.honorableMention).toHaveLength(6);
  });
});

describe('决赛比赛顺序', () => {
  it('手机纵向视图使用的顺序是拓扑序（依赖先于被依赖者）', () => {
    const position = new Map(FINALS_MATCH_ORDER.map((id, i) => [id, i]));
    for (const node of FINALS_NODES) {
      if (!position.has(node.id) || !node.slots) continue;
      for (const ref of node.slots) {
        if (ref.kind === 'winner' || ref.kind === 'loser') {
          const depPos = position.get(ref.seriesId);
          if (depPos !== undefined) {
            expect(depPos, `${ref.seriesId} 应排在 ${node.id} 之前`).toBeLessThan(position.get(node.id)!);
          }
        }
      }
    }
  });
});

void makeAttempt;
void makeMatch;
