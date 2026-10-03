import { describe, expect, it } from 'vitest';
import { buildSwissPresentation, selectSwissRound, type SwissPresentation } from '../../src/data/swiss-presentation';
import { deriveEvent, deriveRounds } from '../../src/data/view-model';
import type { EventFile, ResultKind, SwissMatch } from '../../src/domain/schema';
import { validateEvent } from '../../src/domain/validation';
import { applyBo1Entry } from '../../src/operator/draft';
import { audienceEvent } from '../fixtures/audience-scenarios';

const R4 = audienceEvent('swiss-r4');
const COMPLETE = audienceEvent('after');
const presentation = (event: EventFile) => buildSwissPresentation(deriveEvent(event));
const detailOf = (model: SwissPresentation, id: string) => model.rounds
  .flatMap((round) => round.groups.flatMap((group) => group.details)).find((detail) => detail.view.id === id)!;

function score(event: EventFile, match: SwissMatch, winnerId: string, resultKind: ResultKind = 'normal'): EventFile {
  const result = applyBo1Entry(event, {
    matchId: match.id, winnerId, resultKind,
    homeScore: '16', awayScore: '6', homeSeconds: '90', awaySeconds: '160', note: null,
  });
  if (!result.ok) throw new Error(result.messages.join('；'));
  return result.event;
}

describe('瑞士轮全景与实际历程', () => {
  it('R4 已公布状态为 2 队晋级、12 队继续、2 队淘汰，R5 仍隐藏对阵', () => {
    expect(validateEvent(R4).errors).toEqual([]);
    const model = presentation(R4);
    expect(model.summary.advanced).toHaveLength(2);
    expect(model.summary.active).toHaveLength(12);
    expect(model.summary.eliminated).toHaveLength(2);
    expect(model.currentRoundIndex).toBe(4);
    expect(model.rounds.map((round) => round.state)).toEqual(['complete', 'complete', 'complete', 'ready', 'unpublished']);
    expect(model.rounds[3]!.groups.map((group) => group.entries.length)).toEqual([6, 6]);
    expect(model.rounds[4]!.groups[0]!.details.every((detail) => detail.sides === null)).toBe(true);
    for (const entry of model.summary.advanced) expect(model.journeys.get(entry.teamId)).toHaveLength(3);
    for (const entry of model.summary.active) expect(model.journeys.get(entry.teamId)).toHaveLength(4);
    expect(model.rounds[3]!.groups[0]!.details[0]!.sides![0].condition).toBe('再胜 1 场晋级；再负 2 场淘汰');
  });

  it('未成立正式排位名单时没有已确定参赛、晋级或淘汰队伍', () => {
    const model = presentation(audienceEvent('qualification-partial'));
    expect(model.qualifiedTeamIds).toEqual([]);
    expect(model.summary).toEqual({ advanced: [], active: [], eliminated: [] });
    expect(model.journeys.size).toBe(0);
    expect(model.rounds.flatMap((round) => round.groups).every((group) => group.entries.length === 0)).toBe(true);
    expect(selectSwissRound(model, null)?.index).toBe(1);
  });

  it('历史分组保留实际参赛队的赛前战绩及组内名次，不随本轮和后续赛果移组', () => {
    const complete = presentation(COMPLETE);
    const early = presentation(audienceEvent('swiss'));
    expect(complete.rounds[1]!.groups.map((group) => group.entries)).toEqual(early.rounds[1]!.groups.map((group) => group.entries));
    expect(complete.rounds[0]!.groups[0]!.entries).toHaveLength(16);
    expect(complete.rounds[0]!.groups[0]!.entries.every((entry) => entry.record === '0-0')).toBe(true);
    expect(complete.rounds[1]!.groups.map((group) => group.entries.length)).toEqual([8, 8]);
    expect(deriveRounds(deriveEvent(COMPLETE))[1]!.groups.map((group) => group.entries)).toEqual(complete.rounds[1]!.groups.map((group) => group.entries));
  });

  it('跨组交换保留场次所属组，同时按真实赛前战绩计算胜负去向', () => {
    let event = structuredClone(R4);
    const upper = event.swiss.matches.find((match) => match.roundIndex === 4 && match.groupRecord === '2-1')!;
    const lower = event.swiss.matches.find((match) => match.roundIndex === 4 && match.groupRecord === '1-2')!;
    const movedTeam = lower.participantSnapshot![0];
    [upper.participantSnapshot![0], lower.participantSnapshot![0]] = [lower.participantSnapshot![0], upper.participantSnapshot![0]];
    upper.slots[0] = { kind: 'team', teamId: upper.participantSnapshot![0] };
    lower.slots[0] = { kind: 'team', teamId: lower.participantSnapshot![0] };
    event.swiss.rounds[3]!.revisionNote = '组委会跨组交换对手';
    const before = presentation(event);
    const matchBefore = detailOf(before, upper.id);
    expect(matchBefore.crossGroup).toBe(true);
    expect(matchBefore.view.stakes).toContain('按双方实际战绩分别计算');
    expect(matchBefore.sides![0].preRecord).toBe('1-2');
    expect(matchBefore.sides![0].condition).toBe('再胜 2 场晋级；再负 1 场淘汰');
    const movedEntry = before.rounds[3]!.groups[0]!.entries.find((entry) => entry.teamId === movedTeam)!;
    expect(movedEntry.record).toBe('1-2');
    expect(movedEntry.rankWithinGroup).toBe(presentation(R4).summary.active.find((entry) => entry.teamId === movedTeam)!.rankWithinGroup);
    event = score(event, upper, movedTeam);
    const after = presentation(event);
    expect(detailOf(after, upper.id).sides![0]).toMatchObject({ preRecord: '1-2', postRecord: '2-2', outcome: 'win' });
    expect(after.summary.advanced).toHaveLength(2);
    expect(after.journeys.get(movedTeam)!.at(-1)).toMatchObject({ roundIndex: 4, groupRecord: '2-1', side: { preRecord: '1-2', postRecord: '2-2' } });
    expect(after.rounds[3]!.revisionNote).toContain('跨组交换');
  });

  it('临时结果可展示比分，但不增加胜负或显示已获胜与晋级', () => {
    const match = R4.swiss.matches.find((candidate) => candidate.roundIndex === 4)!;
    const event = score(structuredClone(R4), match, match.participantSnapshot![0]);
    const source = event.swiss.matches.find((candidate) => candidate.id === match.id)!;
    source.attempts.find((attempt) => attempt.id === source.effectiveAttemptId)!.resultStatus = 'provisional';
    const model = presentation(event);
    const detail = detailOf(model, match.id);
    expect(detail.confirmed).toBe(false);
    expect(detail.sides!.every((side) => side.outcome === null && side.postRecord === null)).toBe(true);
    expect(detail.view.resultStatus).toBe('provisional');
    expect(detail.view.sides!.every((side) => !side.isWinner)).toBe(true);
    expect(model.summary.advanced).toHaveLength(2);
    expect(model.rounds[3]!.confirmedCount).toBe(0);
    expect(model.rounds[3]!.state).toBe('running');
  });

  it('重赛只采用有效结果，更正胜者后实际历程与晋级队伍一起更新', () => {
    const match = R4.swiss.matches.find((candidate) => candidate.roundIndex === 4 && candidate.groupRecord === '2-1')!;
    const [home, away] = match.participantSnapshot!;
    const first = score(structuredClone(R4), match, home);
    const replay = score(first, match, away);
    const model = presentation(replay);
    expect(replay.swiss.matches.find((candidate) => candidate.id === match.id)!.attempts).toHaveLength(2);
    expect(detailOf(model, match.id).sides).toMatchObject([
      { preRecord: '2-1', postRecord: '2-2', outcome: 'loss' },
      { preRecord: '2-1', postRecord: '3-1', outcome: 'win' },
    ]);
    expect(model.summary.advanced.map((entry) => entry.teamId)).toContain(away);
    expect(model.summary.advanced.map((entry) => entry.teamId)).not.toContain(home);
    expect(model.rounds[3]!.confirmedCount).toBe(1);
    const corrected = structuredClone(replay);
    const source = corrected.swiss.matches.find((candidate) => candidate.id === match.id)!;
    source.attempts.find((attempt) => attempt.id === source.effectiveAttemptId)!.winnerId = home;
    const correction = presentation(corrected);
    expect(correction.journeys.get(home)!.at(-1)!.side).toMatchObject({ postRecord: '3-1', outcome: 'win', condition: '已晋级八强' });
    expect(correction.summary.advanced.map((entry) => entry.teamId)).not.toContain(away);
  });

  it('弃权确认胜负参与晋级，保留特殊结果类型并且不编造比分', () => {
    const match = R4.swiss.matches.find((candidate) => candidate.roundIndex === 4 && candidate.groupRecord === '1-2')!;
    const event = score(structuredClone(R4), match, match.participantSnapshot![0], 'walkover-before-start');
    const model = presentation(event);
    const detail = detailOf(model, match.id);
    expect(detail.resultKind).toBe('walkover-before-start');
    expect(detail.confirmed).toBe(true);
    expect(detail.view.sides!.map((side) => side.score)).toEqual([null, null]);
    expect(detail.sides![1]).toMatchObject({ postRecord: '1-3', outcome: 'loss', condition: '已淘汰' });
    expect(model.summary.eliminated).toHaveLength(3);
  });

  it.each(['draft', 'superseded'] as const)('%s 轮次即使残留双方与已确认赛果也不泄露对阵、赛果或历程', (publicationStatus) => {
    const event = audienceEvent('swiss-adjusted');
    event.swiss.rounds[0]!.publicationStatus = publicationStatus;
    const model = presentation(event);
    const round = model.rounds[0]!;
    expect(round.state).toBe('unpublished');
    expect(round.complete).toBe(false);
    expect(round.revisionNote).toBeNull();
    expect(round.groups[0]!.entries).toEqual([]);
    for (const detail of round.groups[0]!.details) {
      expect(detail.sides).toBeNull();
      expect(detail.confirmed).toBe(false);
      expect(detail.resultKind).toBeNull();
      expect(detail.view.sides!.every((side) => side.team === null && side.sourceLabel === '对阵待公布' && side.score === null && !side.isWinner)).toBe(true);
      expect(detail.view.resultStatus).toBe('none');
    }
    expect(model.summary.active.every((entry) => entry.record === '0-0')).toBe(true);
    expect([...model.journeys.values()].every((steps) => steps.length === 0)).toBe(true);
  });

  it('全赛程结算保留 33 场且最终组人数为 2/3/3/3/3/2，链接合法轮次优先', () => {
    const model = presentation(COMPLETE);
    expect(model.rounds.reduce((sum, round) => sum + round.matchCount, 0)).toBe(33);
    expect(model.rounds.every((round) => round.state === 'complete')).toBe(true);
    expect(model.summary.active).toEqual([]);
    const entries = [...model.summary.advanced, ...model.summary.eliminated];
    expect(['3-0', '3-1', '3-2', '2-3', '1-3', '0-3'].map((record) => entries.filter((entry) => entry.record === record).length)).toEqual([2, 3, 3, 3, 3, 2]);
    expect(selectSwissRound(model, 2)?.index).toBe(2);
    expect(selectSwissRound(model, 999)?.index).toBe(5);
    expect(selectSwissRound(presentation(R4), Number.NaN)?.index).toBe(4);
    expect(selectSwissRound(presentation(R4), 5)?.state).toBe('unpublished');
  });
});
