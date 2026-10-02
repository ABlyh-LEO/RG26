/** Workbench result commands. Raw form state is separate from validated event data. */
import { eventFileSchema, type CorrectionDisposition, type EventFile, type ResultKind, type Series } from '../domain/schema';
import { buildCorrection, previewCorrection, type CorrectionImpact } from '../domain/corrections';
import { resolveFinals } from '../domain/finals';
import { applyBo1Entry, applyBo3Game, applyFinalsBo1, applyQualificationAutoRanking,
  applyQualificationRun, seriesWins, type ApplyResult } from './draft';

export type ResultTarget = { kind: 'qualification' | 'swiss' | 'finals'; id: string; gameIndex: number };
export interface ResultInput {
  homeScore: string; awayScore: string; homeSeconds: string; awaySeconds: string;
  winnerId: string | null; resultKind: ResultKind; note: string; rawResult: string;
  operation: 'entry' | 'correction' | 'replay'; reason: string;
  disposition: CorrectionDisposition; dispositionNote: string;
}
export interface ResultProposal extends ApplyResult {
  fields: Record<string, string>;
  impact: CorrectionImpact | null;
}

export function resultParticipants(event: EventFile, target: ResultTarget): [string, string] | null {
  if (target.kind === 'swiss') return event.swiss.matches.find((m) => m.id === target.id)?.participantSnapshot ?? null;
  if (target.kind !== 'finals') return null;
  const series = event.finals.series.find((s) => s.id === target.id);
  if (series?.participantSnapshot) return series.participantSnapshot;
  const slots = resolveFinals(event.finals.series, event.finals.seeding).series.get(target.id)?.slots;
  return slots?.[0].state === 'resolved' && slots[1].state === 'resolved' ? [slots[0].teamId, slots[1].teamId] : null;
}

export function currentResult(event: EventFile, target: ResultTarget) {
  if (target.kind === 'qualification') return event.qualification.runs.find((r) => r.id === target.id);
  if (target.kind === 'finals') return event.finals.series.find((s) => s.id === target.id)?.games.find((g) => g.index === target.gameIndex);
  const match = event.swiss.matches.find((m) => m.id === target.id);
  return match?.attempts.find((a) => a.id === match.effectiveAttemptId);
}

function downstreamIds(event: EventFile, sourceId: string): string[] {
  const affected = new Set([sourceId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const series of event.finals.series) {
      if (!affected.has(series.id) && series.slots?.some((slot) =>
        (slot.kind === 'winner' || slot.kind === 'loser') && affected.has(slot.seriesId))) {
        affected.add(series.id); changed = true;
      }
    }
  }
  return [...affected].filter((id) => id !== sourceId);
}

const hasStarted = (series: Series) => series.executionStatus === 'running' || series.executionStatus === 'finished' ||
  series.games.some((game) => game.resultStatus === 'confirmed');

/** Swiss corrections use the existing full-field dependency analysis; finals use their actual graph. */
export function resultImpact(event: EventFile, next: EventFile, target: ResultTarget, reason: string): CorrectionImpact {
  if (target.kind !== 'finals') {
    const impact = previewCorrection(event, {
      reason, matchIds: target.kind === 'swiss' ? [target.id] : [], updatedMatches: next.swiss.matches,
    });
    if (target.kind === 'qualification') {
      impact.changedIds = [target.id];
      const before = event.qualification.ranking.orderedTeamIds;
      const after = next.qualification.ranking.orderedTeamIds;
      impact.rankingChanges = after.flatMap((teamId, index) => {
        const previous = before.indexOf(teamId);
        return previous >= 0 && previous !== index ? [{ teamId, before: previous + 1, after: index + 1,
          recordBefore: '排位赛', recordAfter: '排位赛' }] : [];
      });
      if (impact.rankingChanges.length) impact.warnings.push(`${impact.rankingChanges.length} 支队伍的排位名次发生变化，已公布后续对阵需要一并核对。`);
      impact.affectedSeries = event.finals.seeding ? event.finals.series.filter((s) => s.countsForStandings).map((s) => s.id) : [];
      if (event.finals.series.some((s) => impact.affectedSeries.includes(s.id) && hasStarted(s))) {
        impact.requiredDisposition = 'committee-revision-recorded';
        impact.blockers.push('决赛已经开赛，排位赛更正必须记录组委会处置，并保持已经发生的参赛双方。');
      }
    }
    return impact;
  }
  const affectedSeries = downstreamIds(event, target.id);
  const started = event.finals.series.filter((s) => affectedSeries.includes(s.id) && hasStarted(s));
  const published = event.finals.series.filter((s) => affectedSeries.includes(s.id) && s.participantSnapshot);
  const disposition = started.length ? 'committee-revision-recorded' : published.length ? 'pending' : 'downstream-not-published';
  return {
    changedIds: [target.id], affectedPublishedRounds: [], startedDownstreamMatches: [], affectedSeries,
    recomputedTeamIds: [], rankingChanges: [], requiredDisposition: disposition,
    blockers: started.length ? ['下游决赛已开赛或有成绩：保留参赛快照和比分，记录组委会处置。'] :
      published.length ? ['下游决赛对阵已经公布：必须选择保留并说明，或重新公布。'] : [],
    warnings: affectedSeries.length ? [`本次更正将重新核对 ${affectedSeries.length} 场下游决赛。`] : [],
  };
}

/** Build an immutable preview, then gate corrections on explicit downstream disposition. */
export function proposeResult(event: EventFile, target: ResultTarget, input: ResultInput, confirm = true): ResultProposal {
  const fields: Record<string, string> = {};
  const fail = (messages: string[], impact: CorrectionImpact | null = null): ResultProposal => ({ event, ok: false, messages, fields, impact });
  const old = currentResult(event, target);
  const correcting = old?.resultStatus === 'confirmed';
  if (correcting && input.operation === 'entry') fields.operation = '这条结果已确认，请选择更正或重赛。';
  if (correcting && !input.reason.trim()) fields.reason = '请填写原因，旧值和新值将进入公开更正记录。';
  const performance = input.resultKind === 'normal' || input.resultKind === 'early-end';
  const decimal = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (target.kind === 'qualification') {
    if (confirm && !input.rawResult.trim() && !input.homeScore.trim()) fields.rawResult = '请填写成绩文字或积分。';
    if (input.homeScore.trim() && !decimal.test(input.homeScore.trim())) fields.homeScore = '积分必须为非负数。';
    if (input.homeSeconds.trim() && !decimal.test(input.homeSeconds.trim())) fields.homeSeconds = '用时必须为非负数。';
  } else {
    const participants = resultParticipants(event, target);
    if (!participants) return fail(['参赛双方尚未确定，请先公布对阵。']);
    if (!input.winnerId || !participants.includes(input.winnerId)) fields.winnerId = '请由裁判确认本场胜者。';
    if (performance) {
      for (const key of ['homeScore', 'awayScore'] as const) {
        if (!decimal.test(input[key].trim())) fields[key] = '积分必须为非负数，空值不代表 0 分。';
      }
      for (const [key, score] of [['homeSeconds', 'homeScore'], ['awaySeconds', 'awayScore']] as const) {
        if (Number(input[score]) !== 0 && !decimal.test(input[key].trim())) fields[key] = '请填写到达最终分时间（秒）。';
      }
    }
  }
  if (Object.keys(fields).length) return fail(Object.values(fields));

  let applied: ApplyResult;
  if (target.kind === 'qualification') {
    applied = applyQualificationRun(event, { runId: target.id, rawResult: input.rawResult,
      score: input.homeScore || null, elapsedSeconds: input.homeSeconds || null, judgeNote: input.note || null, confirm });
    if (applied.ok && confirm) {
      const ranked = applyQualificationAutoRanking(applied.event);
      applied = { ...applied, event: ranked.event, messages: ranked.messages };
    }
  } else if (target.kind === 'swiss') {
    applied = applyBo1Entry(event, { matchId: target.id, homeScore: input.homeScore, awayScore: input.awayScore,
      homeSeconds: input.homeSeconds, awaySeconds: input.awaySeconds, winnerId: input.winnerId,
      resultKind: input.resultKind, note: input.note || null });
    if (applied.ok && correcting && input.operation === 'correction') {
      const original = event.swiss.matches.find((m) => m.id === target.id)!;
      const originalResult = original.attempts.find((a) => a.id === original.effectiveAttemptId)!;
      applied.event.swiss.matches = applied.event.swiss.matches.map((match) => {
        if (match.id !== target.id) return match;
        const replacement = match.attempts.at(-1)!;
        return { ...match, effectiveAttemptId: originalResult.id,
          attempts: original.attempts.map((a) => a.id === originalResult.id ? { ...replacement, id: a.id, supersedesId: a.supersedesId } : a) };
      });
    }
  } else {
    const series = event.finals.series.find((s) => s.id === target.id);
    if (!series) return fail(['找不到该场决赛。']);
    const participants = resultParticipants(event, target)!;
    let reopened = event;
    if (correcting) {
      reopened = { ...event, finals: { ...event.finals, series: event.finals.series.map((s) => s.id !== target.id ? s : {
        ...s, executionStatus: 'running', games: s.games.map((g) => g.index !== target.gameIndex ? g : { ...g, resultStatus: 'none', winnerId: null }),
      }) } };
    }
    const entry = { seriesId: target.id, gameIndex: target.gameIndex, homeTeamId: participants[0], awayTeamId: participants[1],
      homeScore: performance ? input.homeScore : '', awayScore: performance ? input.awayScore : '',
      homeReachedSeconds: input.homeSeconds, awayReachedSeconds: input.awaySeconds,
      winnerId: input.winnerId, resultKind: input.resultKind };
    applied = series.format === 'BO1' ? applyFinalsBo1(reopened, entry) : applyBo3Game(reopened, entry);
    if (applied.ok) applied.event.finals.series = applied.event.finals.series.map((s) => s.id !== target.id ? s : {
      ...s, executionStatus: seriesWins(s).winnerId ? 'finished' : 'running',
      games: s.games.map((g) => g.index === target.gameIndex ? { ...g, note: input.note || null } : g),
    });
  }
  if (!applied.ok) return fail(applied.messages);
  const parsed = eventFileSchema.safeParse(applied.event);
  if (!parsed.success) return fail(parsed.error.issues.map((issue) => `${issue.path.join('.')}：${issue.message}`));
  let next = parsed.data;
  const updatedEntity = target.kind === 'qualification' ? next.qualification.runs.find((r) => r.id === target.id) :
    target.kind === 'swiss' ? next.swiss.matches.find((m) => m.id === target.id) : next.finals.series.find((s) => s.id === target.id);
  if (updatedEntity) next = { ...next, scheduleItems: next.scheduleItems.map((item) => item.id === updatedEntity.scheduleItemId
    ? { ...item, executionStatus: updatedEntity.executionStatus } : item) };
  let impact: CorrectionImpact | null = null;
  if (correcting) {
    impact = resultImpact(event, next, target, input.reason);
    let disposition = input.disposition;
    if (impact.requiredDisposition === 'downstream-not-published') disposition = 'downstream-not-published';
    if (impact.requiredDisposition === 'committee-revision-recorded' && disposition !== 'committee-revision-recorded') {
      fields.disposition = '下游已经开赛，请记录组委会修订。';
    } else if (impact.requiredDisposition === 'pending' && !['keep-published-with-note', 'republish'].includes(disposition)) {
      fields.disposition = '请选择保留已公布对阵或作废后重新公布。';
    }
    if (disposition !== 'downstream-not-published' && !input.dispositionNote.trim()) fields.dispositionNote = '请填写处置说明。';
    if (Object.keys(fields).length) return fail(Object.values(fields), impact);

    const change = { reason: `${input.operation === 'replay' ? '重赛' : '更正'}：${input.reason.trim()}`,
      matchIds: [target.id], updatedMatches: next.swiss.matches };
    const record = buildCorrection(`correction-${Date.now()}-${event.corrections.length + 1}`, change, impact,
      new Date().toISOString(), disposition, JSON.stringify(old), JSON.stringify(currentResult(next, target)));
    record.note = [input.dispositionNote.trim(), ...impact.blockers, ...impact.warnings].filter(Boolean).join('；') || null;
    next = { ...next, corrections: [...next.corrections, record] };
    if (disposition === 'republish') {
      const roundIds = new Set(impact.affectedPublishedRounds.map((round) => round.roundId));
      const matchIds = new Set(event.swiss.rounds.filter((r) => roundIds.has(r.id)).flatMap((r) => r.matchIds));
      next = { ...next, swiss: { ...next.swiss,
        rounds: next.swiss.rounds.map((r) => roundIds.has(r.id) ? { ...r, publicationStatus: 'superseded', closedAt: null } : r),
        matches: next.swiss.matches.map((m) => matchIds.has(m.id) ? { ...m, participantSnapshot: null, executionStatus: 'scheduled',
          slots: [{ kind: 'pending', reason: '更正后待重新公布' }, { kind: 'pending', reason: '更正后待重新公布' }] } : m),
      }, finals: { ...next.finals, series: next.finals.series.map((s) => impact!.affectedSeries.includes(s.id) && !hasStarted(s)
        ? { ...s, participantSnapshot: null, executionStatus: 'scheduled' } : s) } };
    } else if (disposition === 'committee-revision-recorded' || disposition === 'keep-published-with-note') {
      // Freeze already announced participants even if they were previously resolved from upstream slots.
      next = { ...next, finals: { ...next.finals, series: next.finals.series.map((s) => {
        if (!impact!.affectedSeries.includes(s.id)) return s;
        const previous = event.finals.series.find((entry) => entry.id === s.id)!;
        if (!hasStarted(previous) && !previous.participantSnapshot) return s;
        const snapshot = resultParticipants(event, { kind: 'finals', id: s.id, gameIndex: 1 });
        return { ...s, participantSnapshot: snapshot ?? previous.participantSnapshot };
      }) } };
    }
  }
  return { event: next, ok: true, fields, impact,
    messages: [correcting ? `${input.operation === 'replay' ? '重赛' : '更正'}已写入草稿，旧值、新值和原因已保留。` : '结果已保存到待发布草稿。'] };
}
