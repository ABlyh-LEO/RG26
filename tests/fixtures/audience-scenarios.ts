/** 合成回归数据，绝不写入正式源或公开快照。 */
import { buildSeedEvent } from '../../scripts/seed-data';
import { FINALS_MATCH_ORDER, resolveFinals } from '../../src/domain/finals';
import type { EventFile, PublicSnapshot } from '../../src/domain/schema';
import { swapPairingSlots, type PairingAdjustment } from '../../src/domain/swiss';
import { applyBo1Entry, applyBo3Game, applyFinalsBo1, applyQualificationRun, confirmQualificationRanking, confirmRound, generateNextRound, publishFinalsSeeding, publishRound } from '../../src/operator/draft';

export type AudienceScenario = 'before' | 'qualification' | 'qualification-partial' | 'swiss' | 'swiss-adjusted' | 'bo3' | 'after' | 'rescheduled';
export function audienceEvent(scenario: AudienceScenario): EventFile {
  let event = buildSeedEvent('2026-10-02T12:00:00+08:00');
  if (scenario === 'before') return event;
  if (scenario === 'rescheduled') {
    const slot = event.scheduleItems.find(s => s.referenceId === event.qualification.runs[0]!.id)!;
    slot.revisedStart = '2026-10-03T15:30:00+08:00'; slot.adjustmentNote = '场地维护，延至下午';
    return event;
  }
  if (scenario === 'qualification') {
    for (const run of event.qualification.runs.slice(0, 2)) {
      run.executionStatus = 'running';
      event.scheduleItems.find(s => s.id === run.scheduleItemId)!.executionStatus = 'running';
    }
    return event;
  }
  if (scenario === 'qualification-partial') {
    // 只确认 7 条成绩，且**不定榜**。用于验证观众端只显示「当前排行」、绝不断言晋级：
    // - 索引 0–21 为第 1 轮，22–43 为第 2 轮，同一队伍同序号；
    // - 前两支队伍两轮成绩完全相同 → 触发并列标记；
    // - 第四支队伍只跑了一轮 → 触发"仅一轮"标记；
    // - 其余 18 支没有成绩 → 触发"无成绩"标记。
    const plan: Array<[index: number, score: string, elapsed: string]> = [
      [0, '20', '40'], [22, '20', '40'],
      [1, '20', '40'], [23, '20', '40'],
      [2, '18', '45'], [24, '17', '46'],
      [3, '16', '50'],
    ];
    for (const [index, score, elapsed] of plan) {
      const run = event.qualification.runs[index]!;
      const result = applyQualificationRun(event, {
        runId: run.id, score, elapsedSeconds: elapsed,
        rawResult: '测试成绩', judgeNote: null, confirm: true,
      });
      if (!result.ok) throw new Error(result.messages.join('；'));
      event = result.event;
    }
    return event;
  }
  for (const run of event.qualification.runs) {
    const rank = event.teams.find(t => t.id === run.teamId)!.thirdReviewRank!;
    const result = applyQualificationRun(event, { runId: run.id, score: String(24 - rank), elapsedSeconds: String(30 + rank), rawResult: '测试成绩', judgeNote: null, confirm: true });
    if (!result.ok) throw new Error(result.messages.join('；'));
    event = result.event;
  }
  const ranked = confirmQualificationRanking(event);
  if (!ranked.ok) throw new Error(ranked.messages.join('；'));
  event = ranked.event;
  for (let index = 1; index <= 5; index += 1) {
    const proposal = generateNextRound(event, index);
    if (!proposal.ok || !proposal.proposal) throw new Error(proposal.messages.join('；'));
    /*
     * `swiss-adjusted`：第一轮对阵由组委会人工微调 —— 交换前两场的对手。
     * 其他场景一律使用自动配对。写入路径完全相同，只有 `pairs` 的来源不同。
     */
    const adjustment: PairingAdjustment | null =
      scenario === 'swiss-adjusted' && index === 1
        ? {
            pairs: swapPairingSlots(
              proposal.proposal.pairs,
              { matchIndex: 0, side: 'away' },
              { matchIndex: 1, side: 'away' },
            ),
            note: '两队设备故障经裁判组同意交换对手',
          }
        : null;
    const published = publishRound(event, index, proposal.proposal, adjustment);
    if (!published.ok) throw new Error(published.messages.join('；'));
    event = published.event;
    const matches = event.swiss.matches.filter(m => m.roundIndex === index);
    if (scenario === 'swiss' && index === 2) {
      const current = matches[0]!; current.executionStatus = 'running';
      event.scheduleItems.find(s => s.id === current.scheduleItemId)!.executionStatus = 'running';
      return event;
    }
    for (const match of matches) {
      event = applyBo1Entry(event, { matchId: match.id, homeScore: '16', awayScore: '6', homeSeconds: '90', awaySeconds: '160', winnerId: match.participantSnapshot![0], resultKind: 'normal', note: null }).event;
    }
    event = confirmRound(event, index).event;
    // 微调场景：第一轮打完即可，用于验证"实际对阵 + 修订说明"在观众端同时可见。
    if (scenario === 'swiss-adjusted' && index === 1) return event;
  }
  event = publishFinalsSeeding(event).event;
  for (const id of FINALS_MATCH_ORDER) {
    const series = event.finals.series.find(s => s.id === id)!;
    const slots = resolveFinals(event.finals.series, event.finals.seeding).series.get(id)!.slots;
    if (slots[0].state !== 'resolved' || slots[1].state !== 'resolved') throw new Error(`测试对阵未就绪 ${id}`);
    const [home, away] = [slots[0].teamId, slots[1].teamId];
    for (let gameIndex = 1; gameIndex <= (series.format === 'BO1' ? 1 : 2); gameIndex += 1) {
      const input = { seriesId: id, gameIndex, homeTeamId: home, awayTeamId: away, homeScore: '16', awayScore: '7', homeReachedSeconds: '85', awayReachedSeconds: '145', winnerId: home, resultKind: 'normal' as const };
      const result = series.format === 'BO1' ? applyFinalsBo1(event, input) : applyBo3Game(event, input);
      if (!result.ok) throw new Error(result.messages.join('；'));
      event = result.event;
      if (scenario === 'bo3' && id === 'F-QUAL' && gameIndex === 1) return event;
    }
  }
  return event;
}

export function audienceSnapshot(scenario: AudienceScenario): PublicSnapshot {
  return { schemaVersion: 1, revision: `test-${scenario}`, builtAt: '2026-10-02T04:00:00Z', sourceCommit: null, data: audienceEvent(scenario) };
}
