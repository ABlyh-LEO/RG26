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

describe('场地结构：主舞台 + A/B 副场地', () => {
  it('数据里恰好三个场地，且区分主舞台与副场地', () => {
    expect(EVENT.venues).toHaveLength(3);
    const main = EVENT.venues.find((v) => v.id === 'venue-main');
    const a = EVENT.venues.find((v) => v.id === 'venue-a');
    const b = EVENT.venues.find((v) => v.id === 'venue-b');
    expect(main?.label).toBe('主舞台');
    expect(a?.label).toBe('A 副场地');
    expect(b?.label).toBe('B 副场地');
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
