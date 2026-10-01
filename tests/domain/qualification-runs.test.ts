/**
 * 维护工具草稿操作测试：排位赛跑图成绩录入。
 *
 * 覆盖用户报告的问题：「排位赛没有写进去」——即跑图成绩此前没有录入入口。
 */
import { describe, expect, it } from 'vitest';
import {
  applyQualificationRun,
  confirmQualificationRuns,
  qualificationProgress,
} from '../../src/operator/draft';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema } from '../../src/domain/schema';
import { validateEvent } from '../../src/domain/validation';

const EVENT = eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));

describe('排位赛跑图成绩录入', () => {
  it('种子数据包含 44 条跑图记录，全部未录入', () => {
    const p = qualificationProgress(EVENT);
    expect(p.total).toBe(44);
    expect(p.pending).toBe(44);
    expect(p.confirmed).toBe(0);
  });

  it('每一轮各 22 条', () => {
    const r1 = EVENT.qualification.runs.filter((r) => r.round === 1);
    const r2 = EVENT.qualification.runs.filter((r) => r.round === 2);
    expect(r1).toHaveLength(22);
    expect(r2).toHaveLength(22);
  });

  it('可以录入成绩并标记为已确认', () => {
    const run = EVENT.qualification.runs[0]!;
    const result = applyQualificationRun(EVENT, {
      runId: run.id,
      rawResult: '2.35 米',
      score: '88',
      elapsedSeconds: '12.5',
      judgeNote: '第一次尝试',
      confirm: true,
    });

    expect(result.ok).toBe(true);
    const updated = result.event.qualification.runs.find((r) => r.id === run.id)!;
    expect(updated.rawResult).toBe('2.35 米');
    expect(updated.score).toBe('88');
    expect(updated.elapsedSeconds).toBe('12.5');
    expect(updated.resultStatus).toBe('confirmed');
    expect(updated.confirmedAt).not.toBeNull();
    expect(updated.executionStatus).toBe('finished');

    // 只影响这一条
    const others = result.event.qualification.runs.filter((r) => r.id !== run.id);
    expect(others.every((r) => r.resultStatus === 'none')).toBe(true);

    // 进度随之更新
    const p = qualificationProgress(result.event);
    expect(p.confirmed).toBe(1);
    expect(p.pending).toBe(43);
  });

  it('「仅保存」记为待确认，不算完成', () => {
    const run = EVENT.qualification.runs[1]!;
    const result = applyQualificationRun(EVENT, {
      runId: run.id,
      rawResult: '完成',
      score: null,
      elapsedSeconds: null,
      judgeNote: null,
      confirm: false,
    });

    expect(result.ok).toBe(true);
    const updated = result.event.qualification.runs.find((r) => r.id === run.id)!;
    expect(updated.resultStatus).toBe('provisional');
    expect(updated.confirmedAt).toBeNull();

    const p = qualificationProgress(result.event);
    expect(p.confirmed).toBe(0);
    expect(p.provisional).toBe(1);
  });

  it('拒绝非数值的积分或用时', () => {
    const run = EVENT.qualification.runs[0]!;
    for (const bad of ['abc', '-5', '1e3']) {
      const r = applyQualificationRun(EVENT, {
        runId: run.id,
        rawResult: 'x',
        score: bad,
        elapsedSeconds: null,
        judgeNote: null,
        confirm: true,
      });
      expect(r.ok, `score=${bad}`).toBe(false);
    }
    const negTime = applyQualificationRun(EVENT, {
      runId: run.id,
      rawResult: 'x',
      score: null,
      elapsedSeconds: '-3',
      judgeNote: null,
      confirm: true,
    });
    expect(negTime.ok).toBe(false);
  });

  it('拒绝确认一条完全没有内容的记录', () => {
    const run = EVENT.qualification.runs[0]!;
    const r = applyQualificationRun(EVENT, {
      runId: run.id,
      rawResult: '   ',
      score: null,
      elapsedSeconds: null,
      judgeNote: null,
      confirm: true,
    });
    expect(r.ok).toBe(false);
    expect(r.messages.join(' ')).toContain('至少要填写');
  });

  it('找不到记录时给出可读错误', () => {
    const r = applyQualificationRun(EVENT, {
      runId: 'nope',
      rawResult: 'x',
      score: null,
      elapsedSeconds: null,
      judgeNote: null,
      confirm: true,
    });
    expect(r.ok).toBe(false);
    expect(r.messages.join(' ')).toContain('nope');
  });

  it('批量确认待确认的成绩', () => {
    let event = EVENT;
    // 先录入 3 条待确认
    for (const run of event.qualification.runs.slice(0, 3)) {
      event = applyQualificationRun(event, {
        runId: run.id,
        rawResult: '完成',
        score: null,
        elapsedSeconds: null,
        judgeNote: null,
        confirm: false,
      }).event;
    }
    expect(qualificationProgress(event).provisional).toBe(3);

    const confirmed = confirmQualificationRuns(event);
    expect(confirmed.ok).toBe(true);
    expect(qualificationProgress(confirmed.event).provisional).toBe(0);
    expect(qualificationProgress(confirmed.event).confirmed).toBe(3);
  });

  it('批量确认可按轮次筛选，不误伤另一轮', () => {
    let event = EVENT;
    // 明确各取一轮的一条，确保两轮都有待确认项
    const r1Run = event.qualification.runs.find((r) => r.round === 1)!;
    const r2Run = event.qualification.runs.find((r) => r.round === 2)!;
    for (const run of [r1Run, r2Run]) {
      event = applyQualificationRun(event, {
        runId: run.id,
        rawResult: '完成',
        score: null,
        elapsedSeconds: null,
        judgeNote: null,
        confirm: false,
      }).event;
    }
    expect(qualificationProgress(event).provisional).toBe(2);

    // 只确认第 1 轮
    const r1Only = confirmQualificationRuns(event, { round: 1 });
    expect(r1Only.ok).toBe(true);

    const after = r1Only.event.qualification.runs;
    expect(after.find((r) => r.id === r1Run.id)!.resultStatus).toBe('confirmed');
    expect(after.find((r) => r.id === r2Run.id)!.resultStatus).toBe('provisional');
    expect(qualificationProgress(r1Only.event).provisional).toBe(1);
  });

  it('没有待确认项时批量确认给出提示而非报错崩溃', () => {
    const r = confirmQualificationRuns(EVENT);
    expect(r.ok).toBe(false);
    expect(r.messages.join(' ')).toContain('没有待确认');
  });

  it('录入跑图成绩不会破坏整体数据校验', () => {
    let event = EVENT;
    for (const run of event.qualification.runs.slice(0, 6)) {
      event = applyQualificationRun(event, {
        runId: run.id,
        rawResult: `${run.round === 1 ? 2.1 : 2.4} 米`,
        score: '80',
        elapsedSeconds: '15',
        judgeNote: null,
        confirm: true,
      }).event;
    }
    const result = validateEvent(event);
    expect(result.errors, JSON.stringify(result.errors.slice(0, 3))).toEqual([]);
  });
});

describe('未公布轮次的槽位必须是 pending，不能编造具体对阵', () => {
  it('瑞士轮 33 个时间槽都不含具体的排位赛名次/种子', () => {
    for (const m of EVENT.swiss.matches) {
      for (const [i, ref] of m.slots.entries()) {
        expect(
          ref.kind,
          `${m.id} 的 slots[${i}] 不应是 ${ref.kind}（会显示成看似真实的配对）`,
        ).toBe('pending');
      }
    }
  });

  it('pending 槽位给出"在等什么"，且每轮说法不同', () => {
    const reasonOf = (matchId: string) => {
      const m = EVENT.swiss.matches.find((x) => x.id === matchId)!;
      const ref = m.slots[0];
      if (ref.kind !== 'pending') throw new Error(`${matchId} 不是 pending`);
      return ref.reason;
    };

    expect(reasonOf('swiss-r1-00-1')).toBe('等待排位赛排名公布');
    expect(reasonOf('swiss-r2-10-1')).toContain('第 1 轮');
    expect(reasonOf('swiss-r3-20-1')).toContain('第 2 轮');
    expect(reasonOf('swiss-r4-21-1')).toContain('第 3 轮');
    expect(reasonOf('swiss-r5-22-1')).toContain('第 4 轮');

    // 同一轮内：等的是同一个上一轮，但会带上战绩组提示，因此
    // 按"等第几轮"归并后只应有一种说法。
    const r3Stage = new Set(
      EVENT.swiss.matches
        .filter((m) => m.roundIndex === 3)
        .map((m) => {
          const ref = m.slots[0] as { reason: string };
          // 去掉组名后缀，只比较"在等哪一轮"
          return ref.reason.replace(/[0-9]-[0-9] 组$/, '').trim();
        }),
    );
    expect(r3Stage.size).toBe(1);
    // 且确实带上了组名，便于维护者分辨
    const r3WithGroup = EVENT.swiss.matches
      .filter((m) => m.roundIndex === 3 && m.groupRecord !== '0-0')
      .map((m) => (m.slots[0] as { reason: string }).reason);
    expect(r3WithGroup.every((r) => r.includes('组'))).toBe(true);
  });

  it('未公布轮次里没有 "排位赛第 N 名" 这种具体占位', () => {
    const allRefs = EVENT.swiss.matches.flatMap((m) => m.slots);
    expect(allRefs.some((r) => r.kind === 'qualification-rank')).toBe(false);
  });

  it('33 个槽位的 pending 说明按轮次分布（R1 一种，R2–R5 各一种）', () => {
    const byRound = new Map<number, string>();
    for (const m of EVENT.swiss.matches) {
      const ref = m.slots[0];
      if (ref.kind !== 'pending') continue;
      byRound.set(m.roundIndex, ref.reason);
    }
    expect([...byRound.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(byRound.values()).size).toBe(5);
  });

  it('决赛种子槽位用的是 finals-seed 引用（合法），不是 pending', () => {
    const ranked = EVENT.finals.series.filter((s) => s.countsForStandings);
    for (const s of ranked) {
      expect(s.slots, s.id).not.toBeNull();
      for (const ref of s.slots!) {
        expect(['finals-seed', 'winner', 'loser']).toContain(ref.kind);
      }
    }
  });
});

describe('场地结构：主舞台 + 副场地A/B', () => {  it('数据里恰好三个场地，且区分主舞台与副场地', () => {
    expect(EVENT.venues).toHaveLength(3);
    const main = EVENT.venues.find((v) => v.id === 'venue-main');
    const a = EVENT.venues.find((v) => v.id === 'venue-a');
    const b = EVENT.venues.find((v) => v.id === 'venue-b');
    expect(main?.label).toBe('主舞台');
    expect(a?.label).toBe('副场地A');
    expect(b?.label).toBe('副场地B');
  });

  it('排位赛只在 A/B 副场地进行，从不使用主舞台', () => {
    const venues = new Set(EVENT.qualification.runs.map((r) => r.venueId));
    expect([...venues].sort()).toEqual(['venue-a', 'venue-b']);
  });

  it('每支队伍两轮分别使用两个不同副场地', () => {
    const byTeam = new Map<string, string[]>();
    for (const run of EVENT.qualification.runs) {
      const list = byTeam.get(run.teamId) ?? [];
      list.push(run.venueId);
      byTeam.set(run.teamId, list);
    }
    expect(byTeam.size).toBe(22);
    for (const [teamId, venues] of byTeam) {
      expect(venues, teamId).toHaveLength(2);
      expect(new Set(venues).size, `${teamId} 两轮应在不同副场地`).toBe(2);
    }
  });

  it('第 1 轮与第 2 轮的场地对每队是互换的', () => {
    for (const teamId of new Set(EVENT.qualification.runs.map((r) => r.teamId))) {
      const r1 = EVENT.qualification.runs.find((r) => r.teamId === teamId && r.round === 1)!;
      const r2 = EVENT.qualification.runs.find((r) => r.teamId === teamId && r.round === 2)!;
      expect(r1.venueId, teamId).not.toBe(r2.venueId);
    }
  });

  it('对抗类比赛（瑞士轮、计排名的决赛）全部在主舞台', () => {
    const venueOf = (scheduleItemId: string) =>
      EVENT.scheduleItems.find((s) => s.id === scheduleItemId)?.venueId;

    const swissVenues = new Set(EVENT.swiss.matches.map((m) => venueOf(m.scheduleItemId)));
    expect([...swissVenues]).toEqual(['venue-main']);

    const finalsVenues = new Set(
      EVENT.finals.series.filter((s) => s.countsForStandings).map((s) => venueOf(s.scheduleItemId)),
    );
    expect([...finalsVenues]).toEqual(['venue-main']);
  });
});
