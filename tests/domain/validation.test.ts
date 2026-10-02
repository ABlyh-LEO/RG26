/**
 * 数据校验的验收用例（D16）与空赛果构建。
 */
import { describe, expect, it } from 'vitest';
import { validateEvent, formatValidation, validateSwiss } from '../../src/domain/validation';
import { eventFileSchema } from '../../src/domain/schema';
import { buildSeedEvent } from '../../scripts/seed-data';
import { makeEmptyEvent, makeAttempt, makeMatch, makeRound, makeTeams, t } from '../fixtures/swiss-scenario';
import type { EventFile } from '../../src/domain/schema';

/** 带瑞士轮比赛与轮次的最小事件。 */
function eventWith(matches: ReturnType<typeof makeMatch>[], rounds: ReturnType<typeof makeRound>[] = []): EventFile {
  const base = makeEmptyEvent();
  return {
    ...base,
    swiss: {
      matches,
      rounds: rounds.length > 0 ? rounds : [makeRound(1, matches)],
    },
  };
}

describe('空赛果的种子数据必须校验通过', () => {
  it('buildSeedEvent 生成的骨架没有错误', () => {
    const event = buildSeedEvent('2026-09-30T00:00:00+08:00');
    const parsed = eventFileSchema.safeParse(event);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 5), null, 2)).toBe(true);

    const result = validateEvent(parsed.data!);
    // 队名与场地名均已确认（provisionalName: false），因此应当**零错误零警告**
    expect(result.errors, formatValidation(result)).toEqual([]);
    expect(result.warnings, formatValidation(result)).toEqual([]);
  });

  it('空赛果的种子数据包含正确的队伍与赛程规模', () => {
    const event = buildSeedEvent('2026-09-30T00:00:00+08:00');
    expect(event.teams.filter((x) => x.division === 'competitive')).toHaveLength(22);
    expect(event.teams.filter((x) => x.division === 'showcase')).toHaveLength(3);
    expect(event.qualification.runs).toHaveLength(44);
    expect(event.swiss.rounds).toHaveLength(5);
    expect(event.swiss.matches).toHaveLength(33);
    expect(event.finals.series).toHaveLength(18);
    // 没有任何赛果
    expect(event.qualification.runs.every((r) => r.resultStatus === 'none')).toBe(true);
    expect(event.swiss.matches.every((m) => m.attempts.length === 0)).toBe(true);
    expect(event.finals.series.every((s) => s.games.every((g) => g.resultStatus === 'none'))).toBe(true);
  });

  it('没有任何赛果被标成已完成', () => {
    const event = buildSeedEvent('2026-09-30T00:00:00+08:00');
    // 未发生的比赛不得标为 finished
    expect(event.swiss.matches.every((m) => m.executionStatus !== 'finished')).toBe(true);
    expect(event.finals.series.every((s) => s.executionStatus !== 'finished')).toBe(true);
  });

  it('第三轮八场均在10月3日晚，上午增加四场八强首轮', () => {
    const event = buildSeedEvent('2026-09-30T00:00:00+08:00');
    const r3 = event.swiss.rounds.find((r) => r.index === 3)!;
    expect(r3.matchIds).toHaveLength(8);
    const items = r3.matchIds.map((id) => {
      const m = event.swiss.matches.find((x) => x.id === id)!;
      return event.scheduleItems.find((s) => s.id === m.scheduleItemId)!;
    });
    expect(items.filter((s) => s.date === '2026-10-03')).toHaveLength(8);
    expect(items.filter((s) => s.date === '2026-10-04')).toHaveLength(0);
  });

  it('瑞士轮逐场进行（同轮时间不重叠）', () => {
    const event = buildSeedEvent('2026-09-30T00:00:00+08:00');
    for (const round of event.swiss.rounds) {
      const items = round.matchIds
        .map((id) => {
          const m = event.swiss.matches.find((x) => x.id === id)!;
          return event.scheduleItems.find((s) => s.id === m.scheduleItemId)!;
        })
        .sort((a, b) => Date.parse(a.plannedStart) - Date.parse(b.plannedStart));
      for (let i = 1; i < items.length; i += 1) {
        const prev = items[i - 1]!;
        const cur = items[i]!;
        // 同一轮内不少于 10 分钟间隔（逐场进行）
        const gap = Date.parse(cur.plannedStart) - Date.parse(prev.plannedStart);
        expect(gap).toBeGreaterThanOrEqual(10 * 60 * 1000);
      }
    }
  });
});

describe('D16 结构化错误', () => {
  it('缺少积分时给出可读错误', () => {
    const match = makeMatch(1, '0-0', 1, t(1), t(2), [
      makeAttempt('a1', t(1), t(2), t(1), { homeScore: null, awayScore: '5' }),
    ], 'a1');
    const result = validateEvent(eventWith([match]));
    expect(result.ok).toBe(false);
    const issue = result.errors.find((e) => e.code === 'missing-score');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('缺分不等于 0');
    expect(issue!.objectId).toBe(match.id);
  });

  it('未知胜者时给出可读错误', () => {
    const match = makeMatch(1, '0-0', 1, t(1), t(2), [
      makeAttempt('a1', t(1), t(2), t(3), { homeScore: '16', awayScore: '0' }),
    ], 'a1');
    const result = validateEvent(eventWith([match]));
    const issue = result.errors.find((e) => e.code === 'winner-not-participant');
    expect(issue).toBeDefined();
    expect(issue!.field).toContain('winnerId');
  });

  it('已确认但没有胜者时给出可读错误', () => {
    const bad = makeAttempt('a1', t(1), t(2), t(1), { homeScore: '16', awayScore: '0' });
    // schema 层就会拦截：已确认必须有胜者
    const parsed = eventFileSchema.safeParse(eventWith([makeMatch(1, '0-0', 1, t(1), t(2), [{ ...bad, winnerId: null }], 'a1')]));
    expect(parsed.success).toBe(false);
  });

  it('自我对阵时给出可读错误', () => {
    const match = makeMatch(1, '0-0', 1, t(1), t(1), [
      makeAttempt('a1', t(1), t(1), t(1), { homeScore: '16', awayScore: '0' }),
    ], 'a1');
    const result = validateEvent(eventWith([match]));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'self-match')).toBe(true);
  });

  it('重复 ID 时给出可读错误', () => {
    const m = makeMatch(1, '0-0', 1, t(1), t(2), [
      makeAttempt('a1', t(1), t(2), t(1), { homeScore: '16', awayScore: '0' }),
    ], 'a1');
    const result = validateEvent(eventWith([m, { ...m }]));
    expect(result.errors.some((e) => e.code === 'duplicate-id')).toBe(true);
  });

  it('引用不存在的队伍时给出可读错误', () => {
    const match = makeMatch(1, '0-0', 1, 'competitive-999', t(2), [
      makeAttempt('a1', 'competitive-999', t(2), 'competitive-999', { homeScore: '16', awayScore: '0' }),
    ], 'a1');
    const result = validateEvent(eventWith([match]));
    expect(result.errors.some((e) => e.code === 'unknown-team')).toBe(true);
  });

  it('轮次引用不存在的比赛时给出可读错误', () => {
    const event = eventWith([]);
    const broken: EventFile = {
      ...event,
      swiss: { matches: [], rounds: [makeRound(1, [])].map((r) => ({ ...r, matchIds: ['nope'] })) },
    };
    const result = validateEvent(broken);
    const issue = result.errors.find((e) => e.code === 'unknown-match');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('nope');
  });

  it('重赛链成环时给出可读错误', () => {
    const a1 = makeAttempt('a1', t(1), t(2), t(1), { homeScore: '16', awayScore: '0', supersedesId: 'a2' });
    const a2 = makeAttempt('a2', t(1), t(2), t(2), { homeScore: '0', awayScore: '16', supersedesId: 'a1' });
    const match = makeMatch(1, '0-0', 1, t(1), t(2), [a1, a2], 'a1');
    const result = validateEvent(eventWith([match]));
    expect(result.errors.some((e) => e.code === 'attempt-cycle')).toBe(true);
  });

  it('未处置的更正阻止导出', () => {
    const event = makeEmptyEvent();
    const withCorrection: EventFile = {
      ...event,
      corrections: [
        {
          id: 'c1',
          reason: '测试更正',
          at: '2026-10-04T00:00:00+08:00',
          previousValue: 'a',
          newValue: 'b',
          affectedIds: [],
          disposition: 'pending',
          allowsProgress: false,
          note: null,
        },
      ],
    };
    const result = validateEvent(withCorrection);
    const issue = result.errors.find((e) => e.code === 'correction-unhandled');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('阻止导出正式版本');
  });

  it('排位赛排名必须覆盖全部竞技组队伍且不重复', () => {
    const event = makeEmptyEvent(makeTeams(4));
    const incomplete: EventFile = {
      ...event,
      qualification: {
        runs: [],
        ranking: {
          ...event.qualification.ranking,
          status: 'confirmed',
          orderedTeamIds: [t(1), t(1), t(2)],
        },
      },
    };
    const result = validateEvent(incomplete);
    expect(result.errors.some((e) => e.code === 'ranking-incomplete')).toBe(true);
    expect(result.errors.some((e) => e.code === 'duplicate-team')).toBe(true);
  });

  it('展示组队伍不得出现在排位赛排名中', () => {
    const teams = [...makeTeams(4), { id: 'showcase-1', division: 'showcase' as const, number: 1, name: '展示队', nameVerified: true, nameNote: null, thirdReviewRank: null }];
    const event = makeEmptyEvent(teams);
    const bad: EventFile = {
      ...event,
      qualification: {
        runs: [],
        ranking: { ...event.qualification.ranking, status: 'confirmed', orderedTeamIds: [t(1), t(2), t(3), 'showcase-1'] },
      },
    };
    const result = validateEvent(bad);
    expect(result.errors.some((e) => e.code === 'non-competitive-team')).toBe(true);
  });

  it('validateSwiss 可单独调用', () => {
    const match = makeMatch(1, '0-0', 1, 'competitive-999', t(2), [
      makeAttempt('a1', 'competitive-999', t(2), 'competitive-999', { homeScore: '16', awayScore: '0' }),
    ], 'a1');
    const issues = validateSwiss(eventWith([match]), new Set([t(1), t(2)]), 0);
    expect(issues.some((i) => i.code === 'unknown-team')).toBe(true);
  });
});

describe('schema 严格性', () => {
  it('拒绝未知字段', () => {
    const event = makeEmptyEvent();
    const withExtra = { ...event, unexpected: true };
    expect(eventFileSchema.safeParse(withExtra).success).toBe(false);
  });

  it('拒绝不合规的队伍 ID', () => {
    const bad = { ...makeTeams(1)[0]!, id: 'team-1' };
    expect(eventFileSchema.safeParse({ ...makeEmptyEvent(), teams: [bad] }).success).toBe(false);
  });

  it('拒绝非 ISO 带偏移的时间', () => {
    const event = makeEmptyEvent();
    const bad = {
      ...event,
      scheduleItems: [
        {
          id: 's1',
          kind: 'activity' as const,
          stage: 'swiss' as const,
          date: '2026-10-03',
          plannedStart: '2026-10-03 09:00',
          plannedEnd: null,
          afterSeriesId: null,
          venueId: null,
          referenceId: null,
          title: 't',
          executionStatus: 'scheduled' as const,
          adjustmentNote: null,
          revisedStart: null,
        },
      ],
    };
    expect(eventFileSchema.safeParse(bad).success).toBe(false);
  });

  it('拒绝负数或非数字的积分字符串', () => {
    for (const bad of ['-1', 'abc', '1e3']) {
      const match = makeMatch(1, '0-0', 1, t(1), t(2), [
        makeAttempt('a1', t(1), t(2), t(1), { homeScore: bad, awayScore: '5' }),
      ], 'a1');
      expect(eventFileSchema.safeParse(eventWith([match])).success, bad).toBe(false);
    }
  });
});
