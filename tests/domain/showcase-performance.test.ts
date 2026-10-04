/**
 * 展示组是**单独演出**，不是两队对阵。
 *
 * 用户报告：登记展示组抽签后，工作台预检报 6 条错误——
 * 「showcase-final-N 的两个槽位来源完全相同，构成自我对阵」与
 * 「showcase-final-N 的参赛快照中出现自我对阵」（三场各两条），
 * 因为是 error 级别，整份草稿都发不出去。
 *
 * 根因：抽签实现把同一支队同时写进两个席位和"参赛双方"快照，
 * 而校验按竞技比赛检查自我对阵。这里守住两条：
 * 1. 演出只登记演出队伍，不伪造双方；
 * 2. 校验按"演出"对待展示组，同时**不放宽**竞技场次的自我对阵检查。
 */
import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema, type EventFile } from '../../src/domain/schema';
import { validateEvent } from '../../src/domain/validation';
import { validateFinalsGraph } from '../../src/domain/finals';
import { applyShowcaseDraw, updateShowcaseStatus } from '../../src/operator/draft';

const BASE = eventFileSchema.parse(buildSeedEvent('2026-10-04T08:00:00+08:00'));
const SHOWCASE = BASE.teams.filter((team) => team.division === 'showcase');
const SHOWCASE_SERIES_IDS = ['showcase-final-1', 'showcase-final-2', 'showcase-final-3'];

function drawn(event: EventFile = BASE): EventFile {
  const result = applyShowcaseDraw(event, SHOWCASE.map((team) => team.id));
  if (!result.ok) throw new Error(result.messages.join('；'));
  return result.event;
}

describe('展示组抽签只登记演出队伍', () => {
  it('不写入两个席位，也不写"参赛双方"快照', () => {
    const event = drawn();
    SHOWCASE_SERIES_IDS.forEach((id, index) => {
      const series = event.finals.series.find((entry) => entry.id === id)!;
      expect(series.showcaseTeamId, id).toBe(SHOWCASE[index]!.id);
      expect(series.slots, id).toBeNull();
      expect(series.participantSnapshot, id).toBeNull();
    });
    // 抽签顺序本身仍然登记。
    expect(event.showcase.drawOrder).toEqual(SHOWCASE.map((team) => team.id));
  });

  it('抽签后数据校验零错误（用户报告的 6 条误报必须消失）', () => {
    const result = validateEvent(drawn());
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  });

  it('登记抽签同时完成抽签日程，不提前完成正式演出', () => {
    const event = drawn();
    expect(event.scheduleItems.find((item) => item.id === 'sched-showcase-draw')!.executionStatus).toBe('finished');
    expect(event.finals.series.filter((series) => series.stage === 'showcase').every((series) => series.executionStatus === 'scheduled')).toBe(true);
  });

  it('历史草稿里遗留的同队两席位不再被当成自我对阵', () => {
    // 模拟旧版本登记过的草稿：同队写进两个席位与快照。
    const legacy: EventFile = {
      ...BASE,
      finals: {
        ...BASE.finals,
        series: BASE.finals.series.map((series) =>
          series.stage === 'showcase'
            ? {
                ...series,
                showcaseTeamId: SHOWCASE[0]!.id,
                participantSnapshot: [SHOWCASE[0]!.id, SHOWCASE[0]!.id],
                slots: [
                  { kind: 'team' as const, teamId: SHOWCASE[0]!.id },
                  { kind: 'team' as const, teamId: SHOWCASE[0]!.id },
                ],
              }
            : series,
        ),
      },
    };

    const graphErrors = validateFinalsGraph(legacy.finals.series);
    expect(graphErrors.filter((text) => text.includes('自我对阵'))).toEqual([]);
    const messages = validateEvent(legacy).errors.map((error) => error.message);
    expect(messages.filter((text) => text.includes('自我对阵'))).toEqual([]);
  });

  it('竞技场次的自我对阵仍然被拒绝（豁免不能过宽）', () => {
    const broken: EventFile = {
      ...BASE,
      finals: {
        ...BASE.finals,
        series: BASE.finals.series.map((series) =>
          series.countsForStandings
            ? { ...series, slots: [{ kind: 'finals-seed' as const, seed: 'W1' as const }, { kind: 'finals-seed' as const, seed: 'W1' as const }] }
            : series,
        ),
      },
    };
    const errors = validateFinalsGraph(broken.finals.series);
    expect(errors.some((text) => text.includes('自我对阵'))).toBe(true);
  });
});

describe('展示组现场状态', () => {
  it.each(['running', 'finished', 'cancelled'] as const)('正式演出 %s 同步日程，保留单队演出身份且不产生赛果', (status) => {
    const event = drawn();
    const before = event.finals.series.find((series) => series.id === 'showcase-final-1')!;
    const result = updateShowcaseStatus(event, before.scheduleItemId, status);
    expect(result.ok, result.messages.join('；')).toBe(true);
    const after = result.event.finals.series.find((series) => series.id === before.id)!;
    expect(after).toEqual({ ...before, executionStatus: status });
    expect(result.event.scheduleItems.find((item) => item.id === before.scheduleItemId)!.executionStatus).toBe(status);
    expect(result.event.finals.series.filter((series) => series.id !== before.id)).toEqual(event.finals.series.filter((series) => series.id !== before.id));
    expect(result.event.swiss).toEqual(event.swiss);
    expect(result.event.qualification).toEqual(event.qualification);
    expect(validateEvent(result.event).errors).toEqual([]);
    expect(before.executionStatus).toBe('scheduled');
  });

  it.each(['ready', 'running', 'finished'] as const)('未抽签不能把正式演出设为 %s', (status) => {
    const result = updateShowcaseStatus(BASE, 'sched-showcase-final-1', status);
    expect(result.ok).toBe(false);
    expect(result.event).toBe(BASE);
    expect(result.messages.join('；')).toContain('抽签');
  });

  it('无法用无效或与抽签不一致的演出队伍登记完成', () => {
    const event = drawn();
    for (const performer of ['competitive-1', 'showcase-unknown', SHOWCASE[1]!.id]) {
      const invalid: EventFile = { ...event, finals: { ...event.finals, series: event.finals.series.map((series) =>
        series.id === 'showcase-final-1' ? { ...series, showcaseTeamId: performer } : series) } };
      expect(updateShowcaseStatus(invalid, 'sched-showcase-final-1', 'finished').ok).toBe(false);
    }
  });

  it.each(['sched-showcase-media', 'sched-showcase-preview-1', 'sched-showcase-draw'])('活动 %s 可独立记录完成', (id) => {
    const result = updateShowcaseStatus(BASE, id, 'finished');
    expect(result.ok).toBe(true);
    expect(result.event.scheduleItems.find((item) => item.id === id)!.executionStatus).toBe('finished');
    expect(result.event.finals).toEqual(BASE.finals);
    expect(result.event.showcase).toEqual(BASE.showcase);
  });

  it('拒绝不存在的项目和竞技比赛', () => {
    for (const id of ['missing', 'sched-F-M1', BASE.swiss.matches[0]!.scheduleItemId, BASE.qualification.runs[0]!.scheduleItemId]) {
      const result = updateShowcaseStatus(BASE, id, 'finished');
      expect(result.ok).toBe(false);
      expect(result.event).toBe(BASE);
    }
  });

  it('拒绝缺失演出关联或指向竞技系列赛的正式演出日程', () => {
    const event = drawn();
    const missing: EventFile = { ...event, finals: { ...event.finals, series: event.finals.series.filter((series) => series.id !== 'showcase-final-1') } };
    expect(updateShowcaseStatus(missing, 'sched-showcase-final-1', 'finished').ok).toBe(false);
    const wrongReference: EventFile = { ...event, scheduleItems: event.scheduleItems.map((item) => item.id === 'sched-showcase-final-1'
      ? { ...item, referenceId: 'F-M1' } : item) };
    expect(updateShowcaseStatus(wrongReference, 'sched-showcase-final-1', 'finished').ok).toBe(false);
  });

  it.each(['running', 'finished'] as const)('演出 %s 后重复登记原抽签保留状态，改派队伍被拒绝', (status) => {
    const event = updateShowcaseStatus(drawn(), 'sched-showcase-final-1', status).event;
    const order = event.showcase.drawOrder!;
    const repeated = applyShowcaseDraw(event, [...order]);
    expect(repeated.ok).toBe(true);
    expect(repeated.event.finals.series).toEqual(event.finals.series);
    expect(repeated.event.scheduleItems).toEqual(event.scheduleItems);
    const changed = applyShowcaseDraw(event, [order[1]!, order[0]!, order[2]!]);
    expect(changed.ok).toBe(false);
    expect(changed.event).toBe(event);
  });

  it('旧数据仅日程记录已完成时也不能改派该演出队伍', () => {
    const event = drawn();
    const legacy: EventFile = { ...event, scheduleItems: event.scheduleItems.map((item) => item.id === 'sched-showcase-final-1'
      ? { ...item, executionStatus: 'finished' } : item) };
    const order = legacy.showcase.drawOrder!;
    expect(applyShowcaseDraw(legacy, [order[1]!, order[0]!, order[2]!]).ok).toBe(false);
  });
});

describe('演出没有胜负', () => {
  it('演出记录可以确认，但不需要填胜者', () => {
    const event = drawn();
    const withRecord: EventFile = {
      ...event,
      finals: {
        ...event.finals,
        series: event.finals.series.map((series) =>
          series.id === 'showcase-final-1'
            ? { ...series, games: series.games.map((game) => ({ ...game, resultStatus: 'confirmed' as const, note: '演出顺利完成' })) }
            : series,
        ),
      },
    };

    const codes = validateEvent(withRecord).errors.map((error) => error.code);
    expect(codes).not.toContain('missing-winner');
  });

  it('给演出记胜者会被拒绝（那等于把演出当成比赛）', () => {
    const event = drawn();
    const withWinner: EventFile = {
      ...event,
      finals: {
        ...event.finals,
        series: event.finals.series.map((series) =>
          series.id === 'showcase-final-1'
            ? { ...series, games: series.games.map((game) => ({ ...game, winnerId: SHOWCASE[0]!.id })) }
            : series,
        ),
      },
    };

    const codes = validateEvent(withWinner).errors.map((error) => error.code);
    expect(codes).toContain('showcase-winner');
  });
});
