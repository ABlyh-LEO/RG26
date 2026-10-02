import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema, type EventFile } from '../../src/domain/schema';
import { currentResult, proposeResult, resultParticipants, type ResultInput, type ResultTarget } from '../../src/operator/result-edit';
import { applyQualificationRanking, generateNextRound, publishRound } from '../../src/operator/draft';
import { validateEvent } from '../../src/domain/validation';

const form = (winnerId: string | null, extra: Partial<ResultInput> = {}): ResultInput => ({
  homeScore: '16', awayScore: '10', homeSeconds: '121', awaySeconds: '233', winnerId,
  resultKind: 'normal', note: '', rawResult: '完成', operation: 'entry', reason: '', disposition: 'pending', dispositionNote: '', ...extra,
});
function base(): EventFile {
  const event = eventFileSchema.parse(buildSeedEvent('2026-10-02T12:00:00+08:00'));
  const ids = event.teams.filter((team) => team.division === 'competitive').map((team) => team.id);
  event.finals.seeding = { version: 1, publicationStatus: 'published', publishedAt: '2026-10-04T10:00:00+08:00', basisNote: null,
    seeds: { W1: ids[0]!, W2: ids[1]!, W3: ids[2]!, W4: ids[3]!, L1: ids[4]!, L2: ids[5]!, L3: ids[6]!, L4: ids[7]! } };
  return event;
}
function firstFinal(event: EventFile): ResultTarget {
  const first = event.finals.series.find((series) => series.slots?.every((slot) => slot.kind === 'finals-seed'))!;
  return { kind: 'finals', id: first.id, gameIndex: 1 };
}

describe('维护工作台的结果与更正命令', () => {
  it('公布瑞士轮后参赛快照与 ready 状态一致，通过完整领域校验', () => {
    let event = base(); event.finals.seeding = null;
    const order = event.teams.filter((team) => team.division === 'competitive')
      .sort((a, b) => a.thirdReviewRank! - b.thirdReviewRank!).map((team) => team.id);
    event = applyQualificationRanking(event, order, '裁判确认测试排名').event;
    const proposal = generateNextRound(event, 1); expect(proposal.ok).toBe(true);
    const published = publishRound(event, 1, proposal.proposal!); expect(published.ok).toBe(true);
    expect(validateEvent(published.event).errors).toEqual([]);
    for (const match of published.event.swiss.matches.filter((m) => m.roundIndex === 1)) {
      expect(match.executionStatus).toBe('ready');
      expect(published.event.scheduleItems.find((s) => s.id === match.scheduleItemId)?.executionStatus).toBe('ready');
    }
    const started = published.event.swiss.matches.find((m) => m.roundIndex === 1)!;
    started.executionStatus = 'running';
    const original = structuredClone(published.event);
    expect(publishRound(published.event, 1, proposal.proposal!).ok).toBe(false);
    expect(published.event).toEqual(original);
  });
  it('缺少比分或胜者返回可定位字段，且绝不改变输入事件', () => {
    const event = base(); const original = structuredClone(event); const target = firstFinal(event);
    const result = proposeResult(event, target, form(null, { homeScore: '' }));
    expect(result.ok).toBe(false); expect(result.fields.homeScore).toBeTruthy(); expect(result.fields.winnerId).toBeTruthy();
    expect(event).toEqual(original);
  });

  it('已完成决赛 BO1 可明确更正，保留完整旧值、新值和原因', () => {
    const event = base(); const target = firstFinal(event); const [home, away] = resultParticipants(event, target)!;
    const played = proposeResult(event, target, form(home)); expect(played.ok).toBe(true);
    const before = structuredClone(played.event);
    const corrected = proposeResult(played.event, target, form(away, { operation: 'correction', reason: '裁判复核计分表', homeScore: '9', awayScore: '16' }));
    expect(corrected.ok).toBe(true); expect(currentResult(corrected.event, target)).toMatchObject({ winnerId: away, homeScore: '9' });
    expect(corrected.event.corrections).toHaveLength(1);
    expect(JSON.parse(corrected.event.corrections[0]!.previousValue!)).toMatchObject({ winnerId: home, homeScore: '16' });
    expect(corrected.event.corrections[0]!.reason).toContain('裁判复核');
    expect(played.event).toEqual(before);
  });

  it('已确认结果不能当作普通录入覆盖，原因必填', () => {
    const event = base(); const target = firstFinal(event); const home = resultParticipants(event, target)![0];
    const played = proposeResult(event, target, form(home));
    const denied = proposeResult(played.event, target, form(home));
    expect(denied.ok).toBe(false); expect(denied.fields.operation).toBeTruthy(); expect(denied.fields.reason).toBeTruthy();
  });

  it('下游已开赛时要求组委会处置，保留既有参赛快照和比赛记录', () => {
    const event = base(); const target = firstFinal(event); const [home, away] = resultParticipants(event, target)!;
    const played = proposeResult(event, target, form(home));
    const downstream = played.event.finals.series.find((s) => s.slots?.some((slot) => (slot.kind === 'winner' || slot.kind === 'loser') && slot.seriesId === target.id))!;
    downstream.participantSnapshot = [home, 'competitive-2']; downstream.executionStatus = 'running';
    const before = structuredClone(downstream);
    const changes = { operation: 'correction' as const, reason: '录像复核', homeScore: '9', awayScore: '16' };
    const blocked = proposeResult(played.event, target, form(away, changes));
    expect(blocked.ok).toBe(false); expect(blocked.impact?.requiredDisposition).toBe('committee-revision-recorded');
    const accepted = proposeResult(played.event, target, form(away, { ...changes, disposition: 'committee-revision-recorded', dispositionNote: '裁判组决定保留已经进行的场次与双方。' }));
    expect(accepted.ok).toBe(true);
    expect(accepted.event.finals.series.find((s) => s.id === downstream.id)).toEqual(before);
    expect(accepted.event.corrections[0]?.affectedIds).toContain(downstream.id);
  });

  it('瑞士轮更正保留 attempt 身份，重赛才追加 supersedes 历史', () => {
    const event = base(); event.finals.seeding = null;
    const match = event.swiss.matches[0]!;
    match.participantSnapshot = ['competitive-1', 'competitive-2']; match.executionStatus = 'ready';
    const target: ResultTarget = { kind: 'swiss', id: match.id, gameIndex: 1 };
    const played = proposeResult(event, target, form('competitive-1')); expect(played.ok).toBe(true);
    const originalId = currentResult(played.event, target)!.id;
    const correction = proposeResult(played.event, target, form('competitive-1', { operation: 'correction', reason: '补记最终分时间', homeSeconds: '125' }));
    expect(correction.ok).toBe(true); expect(correction.event.swiss.matches[0]!.attempts).toHaveLength(1);
    expect(currentResult(correction.event, target)!.id).toBe(originalId);
    const replay = proposeResult(correction.event, target, form('competitive-2', { operation: 'replay', reason: '组委会要求重新比赛' }));
    expect(replay.ok).toBe(true); expect(replay.event.swiss.matches[0]!.attempts).toHaveLength(2);
    expect(replay.event.swiss.matches[0]!.attempts[1]!.supersedesId).toBe(originalId);
  });

  it('排位赛可先保存待确认，再确认；未确认成绩不伪装成有效赛果', () => {
    const event = base(); const target: ResultTarget = { kind: 'qualification', id: event.qualification.runs[0]!.id, gameIndex: 1 };
    const provisional = proposeResult(event, target, form(null), false);
    expect(provisional.ok).toBe(true); expect(currentResult(provisional.event, target)?.resultStatus).toBe('provisional');
    const confirmed = proposeResult(provisional.event, target, form(null));
    expect(confirmed.ok).toBe(true); expect(currentResult(confirmed.event, target)?.resultStatus).toBe('confirmed');
  });

  it('排位更正的影响预览显示真实名次变化', () => {
    let event = base(); event.finals.seeding = null;
    const first: ResultTarget = { kind: 'qualification', id: event.qualification.runs[0]!.id, gameIndex: 1 };
    const second: ResultTarget = { kind: 'qualification', id: event.qualification.runs[1]!.id, gameIndex: 1 };
    event = proposeResult(event, first, form(null, { homeScore: '16' })).event;
    event = proposeResult(event, second, form(null, { homeScore: '14' })).event;
    const corrected = proposeResult(event, first, form(null, { homeScore: '10', operation: 'correction', reason: '排位成绩复核' }));
    expect(corrected.ok).toBe(true);
    expect(corrected.impact?.rankingChanges).toHaveLength(2);
    expect(corrected.impact?.rankingChanges.map((change) => [change.before, change.after])).toEqual([[2, 1], [1, 2]]);
  });

  it('BO3 更正指定小局，不改变其他局的参赛队伍和比分', () => {
    const event = base(); const series = event.finals.series.find((s) => s.format === 'BO3')!;
    series.participantSnapshot = ['competitive-1', 'competitive-2'];
    const first: ResultTarget = { kind: 'finals', id: series.id, gameIndex: 1 };
    const p1 = proposeResult(event, first, form('competitive-1'));
    const p2 = proposeResult(p1.event, { ...first, gameIndex: 2 }, form('competitive-1'));
    expect(p2.ok).toBe(true);
    const otherGame = structuredClone(p2.event.finals.series.find((s) => s.id === series.id)!.games[1]!);
    const edit = proposeResult(p2.event, first, form('competitive-2', { operation: 'correction', reason: '裁判复核第一局', homeScore: '10', awayScore: '16' }));
    expect(edit.ok).toBe(true);
    expect(edit.event.finals.series.find((s) => s.id === series.id)!.games[1]).toEqual(otherGame);
    expect(edit.event.finals.series.find((s) => s.id === series.id)!.executionStatus).toBe('running');
  });

  it('对阵未知时不允许通过手填队伍录入决赛', () => {
    const event = base(); event.finals.seeding = null;
    const result = proposeResult(event, firstFinal(event), form('competitive-1'));
    expect(result.ok).toBe(false); expect(result.messages.join('')).toContain('参赛双方尚未确定');
  });
});
