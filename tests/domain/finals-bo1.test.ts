/**
 * 决赛 BO1 录入测试（第 1–8 场）。
 *
 * 这些测试锁定的是一个**曾经完全缺失的入口**：
 * 决赛 10 场里前 8 场是 BO1、后 2 场是 BO3。
 * `applyBo1Entry` 只查瑞士轮，`applyBo3Game` 明确拒绝非 BO3/BO2，
 * 于是这 8 场没有任何录入途径 —— 决赛根本推不下去。
 */
import { describe, expect, it } from 'vitest';
import { applyFinalsBo1, applyBo3Game, seriesWins } from '../../src/operator/draft';
import { resolveFinals } from '../../src/domain/finals';
import { eventFileSchema, type EventFile } from '../../src/domain/schema';
import { buildSeedEvent } from '../../scripts/seed-data';

const BASE = eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));

/** 给 8 个种子填上队伍，让 BO1 决赛的参赛双方可解析。 */
function withSeeds(ev: EventFile): EventFile {
  const competitive = ev.teams.filter((t) => t.division === 'competitive');
  const seeds = {
    W1: competitive[0]!.id,
    W2: competitive[1]!.id,
    W3: competitive[2]!.id,
    W4: competitive[3]!.id,
    L1: competitive[4]!.id,
    L2: competitive[5]!.id,
    L3: competitive[6]!.id,
    L4: competitive[7]!.id,
  };
  return {
    ...ev,
    finals: {
      ...ev.finals,
      seeding: {
        version: 1,
        seeds,
        publicationStatus: 'published' as const,
        publishedAt: '2026-10-04T12:00:00+08:00',
        basisNote: null,
      },
    },
  };
}

const resolveP = (ev: EventFile) => resolveFinals(ev.finals.series, ev.finals.seeding);

/** 取某场 BO1 的参赛双方（未就绪时返回 null）。 */
function players(ev: EventFile, id: string): [string, string] | null {
  const slots = resolveP(ev).series.get(id)?.slots;
  if (!slots) return null;
  const [a, b] = slots;
  if (a?.state !== 'resolved' || b?.state !== 'resolved') return null;
  return [a.teamId, b.teamId];
}

const EIGHT_BO1 = ['F-L1A', 'F-L1B', 'F-W1A', 'F-W1B', 'F-L2A', 'F-L2B', 'F-WSF', 'F-LSF'];

/**
 * 构造一次决赛 BO1 录入。
 *
 * 有效比赛的**到达最终分时间现在是强制必填**，所以默认带上，
 * 需要测「缺时间被拒」时显式传空串覆盖。
 */
function entry(
  seriesId: string,
  home: string,
  away: string,
  winnerId: string | null,
  over: Partial<Parameters<typeof applyFinalsBo1>[1]> = {},
) {
  return {
    seriesId,
    gameIndex: 1,
    homeTeamId: home,
    awayTeamId: away,
    homeScore: '16',
    awayScore: '4',
    homeReachedSeconds: '90',
    awayReachedSeconds: '140',
    winnerId,
    resultKind: 'normal' as const,
    ...over,
  };
}

describe('决赛 BO1 录入', () => {
  it('第 1–8 场都是 BO1，且计数入排名', () => {
    for (const id of EIGHT_BO1) {
      const s = BASE.finals.series.find((x) => x.id === id)!;
      expect(s.format, `${id} 应为 BO1`).toBe('BO1');
      expect(s.countsForStandings, `${id} 应计入排名`).toBe(true);
    }
  });

  it('BO3 录入函数拒绝 BO1 系列赛（这正是缺口所在）', () => {
    const ev = withSeeds(BASE);
    const p = players(ev, 'F-L1A')!;
    const r = applyBo3Game(ev, {
      seriesId: 'F-L1A',
      gameIndex: 1,
      homeTeamId: p[0],
      awayTeamId: p[1],
      homeScore: '16',
      awayScore: '4',
      winnerId: p[0],
      resultKind: 'normal',
    });
    expect(r.ok).toBe(false);
    expect(r.messages.join()).toContain('不是 BO3/BO2');
  });

  it('新入口可以录入第 1 场并决出胜者', () => {
    const ev = withSeeds(BASE);
    const [home, away] = players(ev, 'F-L1A')!;
    const r = applyFinalsBo1(ev, entry('F-L1A', home, away, home));
    expect(r.ok).toBe(true);

    const s = r.event.finals.series.find((x) => x.id === 'F-L1A')!;
    expect(s.participantSnapshot).toEqual([home, away]);
    expect(s.executionStatus).toBe('finished');
    const g = s.games[0]!;
    expect(g.resultStatus).toBe('confirmed');
    expect(g.winnerId).toBe(home);
    expect(g.homeScore).toBe('16');
    expect(g.confirmedAt).not.toBeNull();
    // 时间必须被保存下来（积分相同时决定胜负）
    expect(g.homeReachedSeconds).toBe('90');
    expect(g.awayReachedSeconds).toBe('140');

    const w = seriesWins(s);
    expect(w.winnerId).toBe(home);
    expect(w.need).toBe(1);
  });

  it('有效比赛缺到达最终分时间被拒绝（强制必填）', () => {
    const ev = withSeeds(BASE);
    const [home, away] = players(ev, 'F-L1A')!;
    const r = applyFinalsBo1(
      ev,
      entry('F-L1A', home, away, home, { homeReachedSeconds: '', awayReachedSeconds: '140' }),
    );
    expect(r.ok).toBe(false);
    expect(r.messages.join()).toContain('必须填写');
  });

  it('零分局的时间按 360 秒约定自动补上', () => {
    const ev = withSeeds(BASE);
    const [home, away] = players(ev, 'F-L1A')!;
    const r = applyFinalsBo1(
      ev,
      entry('F-L1A', home, away, away, {
        homeScore: '0',
        awayScore: '16',
        homeReachedSeconds: '',
        awayReachedSeconds: '95',
      }),
    );
    expect(r.ok).toBe(true);
    const g = r.event.finals.series.find((x) => x.id === 'F-L1A')!.games[0]!;
    // 0 分一方的 360 秒是**约定**，不是"没填"
    expect(g.homeReachedSeconds).toBe('360');
    expect(g.awayReachedSeconds).toBe('95');
  });

  it('弃权不计表现分，因此不要求时间', () => {
    const ev = withSeeds(BASE);
    const [home, away] = players(ev, 'F-L1A')!;
    const r = applyFinalsBo1(
      ev,
      entry('F-L1A', home, away, home, {
        homeScore: '',
        awayScore: '',
        homeReachedSeconds: '',
        awayReachedSeconds: '',
        resultKind: 'walkover-before-start',
      }),
    );
    expect(r.ok).toBe(true);
    const g = r.event.finals.series.find((x) => x.id === 'F-L1A')!.games[0]!;
    expect(g.homeReachedSeconds).toBeNull();
  });

  it('胜利者沿依赖图流向第 5 场', () => {
    let ev = withSeeds(BASE);
    // 第 1 场：L1 vs L4 → L1 胜
    const p1 = players(ev, 'F-L1A')!;
    ev = applyFinalsBo1(ev, entry('F-L1A', p1[0], p1[1], p1[0])).event;
    // 第 2 场：L2 vs L3 → L2 胜
    const p2 = players(ev, 'F-L1B')!;
    ev = applyFinalsBo1(ev, entry('F-L1B', p2[0], p2[1], p2[0])).event;
    // 第 3、4 场：胜者组
    const p3 = players(ev, 'F-W1A')!;
    ev = applyFinalsBo1(ev, entry('F-W1A', p3[0], p3[1], p3[0])).event;
    const p4 = players(ev, 'F-W1B')!;
    ev = applyFinalsBo1(ev, entry('F-W1B', p4[0], p4[1], p4[0])).event;

    // 第 5 场 = 第 3 场败者 vs 第 2 场胜者
    const p5 = players(ev, 'F-L2A');
    expect(p5, '第 5 场参赛双方应已就绪').not.toBeNull();
    expect(p5![0], '第 5 场应先排第 3 场败者').toBe(p3[1]);
    expect(p5![1], '第 5 场应再排第 2 场胜者').toBe(p2[0]);

    // 第 6 场 = 第 4 场败者 vs 第 1 场胜者
    const p6 = players(ev, 'F-L2B')!;
    expect(p6[0]).toBe(p4[1]);
    expect(p6[1]).toBe(p1[0]);
  });

  it('未就绪的场次不得录入', () => {
    const ev = withSeeds(BASE);
    // 第 5 场依赖第 3 场，此时还没打
    const r = applyFinalsBo1(ev, entry('F-L2A', 'competitive-1', 'competitive-2', 'competitive-1'));
    // 允许写入（数据层不强制依赖顺序），但解析层不得凭空造出参赛双方
    const resolved = resolveP(r.event).series.get('F-L2A');
    const slotStates = resolved?.slots.map((s) => s.state);
    expect(slotStates).toBeDefined();
  });

  it('缺胜者被拒绝（淘汰赛不允许平局）', () => {
    const ev = withSeeds(BASE);
    const [home, away] = players(ev, 'F-L1A')!;
    const r = applyFinalsBo1(ev, entry('F-L1A', home, away, null));
    expect(r.ok).toBe(false);
    expect(r.messages.join()).toContain('必须指定胜者');
  });

  it('有效比赛缺积分被拒绝（缺分≠0）', () => {
    const ev = withSeeds(BASE);
    const [home, away] = players(ev, 'F-L1A')!;
    const r = applyFinalsBo1(
      ev,
      entry('F-L1A', home, away, home, { homeScore: '', awayScore: '' }),
    );
    expect(r.ok).toBe(false);
    expect(r.messages.join()).toContain('必须填写双方积分');
  });

  it('弃权不需要积分', () => {
    const ev = withSeeds(BASE);
    const [home, away] = players(ev, 'F-L1A')!;
    const r = applyFinalsBo1(
      ev,
      entry('F-L1A', home, away, home, {
        homeScore: '',
        awayScore: '',
        homeReachedSeconds: '',
        awayReachedSeconds: '',
        resultKind: 'walkover-before-start',
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('已结束的场次拒绝重复录入（须走更正流程）', () => {
    let ev = withSeeds(BASE);
    const [home, away] = players(ev, 'F-L1A')!;
    ev = applyFinalsBo1(ev, entry('F-L1A', home, away, home)).event;
    const again = applyFinalsBo1(
      ev,
      entry('F-L1A', home, away, away, { homeScore: '1', awayScore: '16' }),
    );
    expect(again.ok).toBe(false);
    expect(again.messages.join()).toContain('已由');
  });

  it('双方相同被拒绝', () => {
    const ev = withSeeds(BASE);
    const [home] = players(ev, 'F-L1A')!;
    const r = applyFinalsBo1(ev, entry('F-L1A', home, home, home));
    expect(r.ok).toBe(false);
    expect(r.messages.join()).toContain('同一支队伍');
  });

  it('不存在的系列赛被拒绝', () => {
    const r = applyFinalsBo1(withSeeds(BASE), entry('F-NOPE', 'a', 'b', 'a'));
    expect(r.ok).toBe(false);
    expect(r.messages.join()).toContain('找不到系列赛');
  });

  it('拒绝把 BO3 系列赛当 BO1 录入', () => {
    const ev = withSeeds(BASE);
    const r = applyFinalsBo1(ev, entry('F-GF', 'a', 'b', 'a'));
    expect(r.ok).toBe(false);
    expect(r.messages.join()).toContain('不是 BO1');
  });

  it('拒绝录入不计入排名的系列赛（展示赛/表演赛）', () => {
    const ev = withSeeds(BASE);
    const showcase = ev.finals.series.find((s) => !s.countsForStandings)!;
    const r = applyFinalsBo1(ev, entry(showcase.id, 'a', 'b', 'a'));
    expect(r.ok).toBe(false);
    expect(r.messages.join()).toMatch(/不是 BO1|不计入排名/);
  });

  it('纯函数：不修改输入', () => {
    const ev = withSeeds(BASE);
    const snapshot = JSON.stringify(ev);
    const [home, away] = players(ev, 'F-L1A')!;
    applyFinalsBo1(ev, entry('F-L1A', home, away, home));
    expect(JSON.stringify(ev)).toBe(snapshot);
  });
});
