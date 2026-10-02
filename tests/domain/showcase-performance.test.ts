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
import { applyShowcaseDraw } from '../../src/operator/draft';

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
