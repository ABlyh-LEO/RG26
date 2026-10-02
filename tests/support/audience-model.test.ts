import { describe, expect, it } from 'vitest';
import { audienceEvent } from '../fixtures/audience-scenarios';
import { deriveEvent, deriveEventPhase, deriveNowPlaying, deriveTeamJourney, effectiveStart } from '../../src/data/view-model';
import { describeEventUpdate } from '../../src/data/updates';
import { buildSwissConnections, nodeParticipants } from '../../src/data/bracket-model';
import { validateEvent } from '../../src/domain/validation';
import { applyShowcaseDraw } from '../../src/operator/draft';

describe('观众派生数据', () => {
  it('所有阶段回归场景遵守正式 schema 和领域规则', () => {
    for (const phase of ['before', 'qualification', 'swiss', 'bo3', 'after', 'rescheduled'] as const) {
      const result = validateEvent(audienceEvent(phase));
      expect(result.errors, phase).toEqual([]);
    }
  });
  it('下一场包含排位赛，并按改期重排，同一时刻可并行', () => {
    const before = deriveEvent(audienceEvent('before'));
    const now = new Date('2026-10-03T08:00:00+08:00');
    const teamId = before.event.qualification.runs[0]!.teamId;
    expect(deriveTeamJourney(before, teamId, now)?.nextMatch?.kind).toBe('run');
    const changed = deriveEvent(audienceEvent('rescheduled'));
    const next = deriveTeamJourney(changed, teamId, now)?.nextMatch;
    expect(next?.schedule && effectiveStart(next.schedule)).toBe('2026-10-03T13:30:00+08:00');
    const games = deriveNowPlaying(before, now).upcoming;
    expect(games[0]?.schedule?.plannedStart).toBe(games[1]?.schedule?.plannedStart);
  });
  it('共享时钟推进当前安排，但不凭时间捏造开赛和赛事结束', () => {
    const event = audienceEvent('before'); const derived = deriveEvent(event);
    expect(deriveNowPlaying(derived, new Date('2026-10-03T08:59:00+08:00')).upcoming[0]?.schedule?.plannedStart).toContain('09:00');
    const later = deriveNowPlaying(derived, new Date('2026-10-03T09:01:00+08:00'));
    expect(later.upcoming[0]?.schedule?.plannedStart).toContain('09:10');
    expect(later.running).toHaveLength(0);
    expect(later.awaitingConfirmation).toHaveLength(2);
    expect(deriveEventPhase(audienceEvent('swiss'), new Date('2026-10-05'))).toBe('during');
    expect(deriveEventPhase(audienceEvent('after'), new Date('2026-10-04T19:00:00+08:00'))).toBe('after');
  });
  it('比赛取消后不再作为下一场，BO3一局结束仍能找到下一次出场', () => {
    const event = audienceEvent('before'); const run = event.qualification.runs[0]!;
    run.executionStatus = 'cancelled';
    expect(deriveTeamJourney(deriveEvent(event), run.teamId, new Date('2026-10-02'))?.nextMatch?.id).not.toBe(run.id);
    const bo3 = audienceEvent('bo3'); const qual = bo3.finals.series.find(s => s.id === 'F-QUAL')!;
    expect(deriveTeamJourney(deriveEvent(bo3), qual.participantSnapshot![0], new Date('2026-10-04T16:40:00+08:00'))?.nextMatch?.id).toBe('F-QUAL');
  });
  it('更新摘要区分结果与时间，仅元信息检查不会产生新比分', () => {
    const before = audienceEvent('before'); const after = structuredClone(before);
    after.qualification.runs[0]!.score = '10'; after.qualification.runs[1]!.score = '12';
    after.scheduleItems[0]!.revisedStart = '2026-10-03T10:00:00+08:00';
    expect(describeEventUpdate(before, after)).toBe('已更新：2 场成绩、1 项时间或场地');
    expect(describeEventUpdate(before, before)).toBeNull();
  });
  it('已决出的 BO3 即使残留 running 状态也不再显示为当前或下一场', () => {
    const event = audienceEvent('after');
    for (const series of event.finals.series.filter(s => s.format === 'BO3')) series.executionStatus = 'running';
    const derived = deriveEvent(event); const now = new Date('2026-10-04T19:00:00+08:00');
    expect(deriveNowPlaying(derived, now).running).toHaveLength(0);
    const champion = derived.finals.series.get('F-GF')!.winnerId!;
    expect(deriveTeamJourney(derived, champion, now)?.nextMatch).toBeNull();
  });
  it('表演活动不伪装成对阵，展示队伍按真实抽签找到下一次出场', () => {
    const event = audienceEvent('before');
    const now = new Date('2026-10-04T14:00:00+08:00');
    const showcase = event.finals.series.find(s => s.stage === 'showcase')!;
    const activity = event.finals.series.find(s => !s.countsForStandings && s.stage !== 'showcase')!;
    activity.executionStatus = 'running';
    const pending = deriveNowPlaying(deriveEvent(event), now);
    expect(pending.running).toHaveLength(0);
    expect(pending.upcoming.find(s => s.id === showcase.id)?.sides?.[0].sourceLabel).toBe('演出队伍待抽签');
    const team = event.teams.find(t => t.division === 'showcase')!;
    showcase.showcaseTeamId = team.id;
    const next = deriveTeamJourney(deriveEvent(event), team.id, now)?.nextMatch;
    expect(next?.id).toBe(showcase.id);
    expect(next?.sides?.[0].team?.name).toBe(team.name);
    expect(next?.sidesInfo).toBeNull();
  });
  it('展示组抽签后仍是单队演出：只登记演出队伍，没有对手席位', () => {
    const event = audienceEvent('before');
    const teams = event.teams.filter(t => t.division === 'showcase');
    const drawn = applyShowcaseDraw(event, teams.map(t => t.id));
    expect(drawn.ok).toBe(true);
    expect(validateEvent(drawn.event).errors).toEqual([]);

    const derived = deriveEvent(drawn.event);
    const now = new Date('2026-10-04T14:00:00+08:00');
    const next = deriveTeamJourney(derived, teams[0]!.id, now)?.nextMatch;
    expect(next?.id).toBe('showcase-final-1');
    expect(next?.sides?.[0].team?.name).toBe(teams[0]!.name);
    // 第二个席位是"单队展示"占位，不是对手。
    expect(next?.sides?.[1].team).toBeNull();
    expect(next?.sides?.[1].sourceLabel).toBe('单队展示');
  });
  it('未公布的瑞士轮候选不产生确定参赛队伍或晋级线', () => {
    const event = audienceEvent('swiss');
    event.swiss.rounds.find(r => r.index === 2)!.publicationStatus = 'draft';
    const derived = deriveEvent(event); const id = event.swiss.matches.find(m => m.roundIndex === 2)!.id;
    expect(buildSwissConnections(event)).toHaveLength(0);
    expect(nodeParticipants(id, event, derived.finals)).toEqual({ home: null, away: null, pending: true });
  });
});
