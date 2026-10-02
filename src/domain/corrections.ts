/**
 * 更正机制（docs/IMPLEMENTATION_PLAN.md 第 6.3 节）。
 *
 * 三类情形必须严格区分：
 * 1. 下游尚未发布：重算评分并重建候选，作废旧候选。
 * 2. 下游已发布但未开赛：显示受影响范围，要求维护者选择
 *    “保留已公布对阵并说明”或“作废旧版本并重新公布”。未处置则阻止导出正式版本。
 * 3. 下游已经开赛或有有效结果：保持已经发生的参赛双方与比赛记录，
 *    绝不静默把旧比分移给另一支队；标记依赖不一致并阻止自动推进。
 *
 * 瑞士轮评分跨队伍依赖历史对手，因此必须重算该截止轮次的**全部**队伍，
 * 再比对所有后续已公布轮次与最终种子——不能只检查两支被更正队伍的直接下一场。
 */
import type { Correction, CorrectionDisposition, EventFile, SwissMatch } from './schema';
import type { QualificationRanking } from './schema';
import { type StandingsEntry, calculateSwissStandings } from './standings';
import { officialQualificationRanking } from './qualification-completeness';

/** 单次更正的影响面。 */
export interface CorrectionImpact {
  /** 被直接修改的对象。 */
  changedIds: string[];
  /** 受影响的已发布轮次（会因重算而可能与既有配对不一致）。 */
  affectedPublishedRounds: { roundId: string; index: number; note: string }[];
  /** 已开赛或已有有效结果的下游比赛：不得静默改写。 */
  startedDownstreamMatches: { matchId: string; roundIndex: number; note: string }[];
  /** 受影响的决赛系列赛。 */
  affectedSeries: string[];
  /** 需要重新计算的队伍（跨队伍依赖 → 全体）。 */
  recomputedTeamIds: string[];
  /** 更正后的排名变化。 */
  rankingChanges: { teamId: string; before: number; after: number; recordBefore: string; recordAfter: string }[];
  /** 结论：需要哪种处置。 */
  requiredDisposition: CorrectionDisposition;
  /** 阻断性问题；有值时不得自动推进或导出。 */
  blockers: string[];
  warnings: string[];
}

/** 更正的输入描述。 */
export interface CorrectionChange {
  /** 更正原因（必填，进入公开记录）。 */
  reason: string;
  /** 直接修改的比赛 ID。 */
  matchIds: string[];
  /** 修改后的比赛集合（用于重算）。 */
  updatedMatches: readonly SwissMatch[];
}

/**
 * 计算一次更正的影响面。
 *
 * 本函数不修改输入；它返回“如果应用这次更正会发生什么”，
 * 由维护者决定处置方式，再由 applyCorrection 落地。
 */
export function previewCorrection(event: EventFile, change: CorrectionChange): CorrectionImpact {
  const qualification: QualificationRanking = event.qualification.ranking;

  // 参赛十六强 = **正式名次**前 16（定榜前回退到全部竞技组队伍，仅用于预览
  // 影响面；不代表参赛名单，也不对外展示）。
  const official = officialQualificationRanking(event);
  const qualifiedIds =
    official.official && official.orderedTeamIds.length >= 16
      ? official.orderedTeamIds.slice(0, 16)
      : event.teams.filter((t) => t.division === 'competitive').map((t) => t.id);

  const before = calculateSwissStandings(qualifiedIds, event.swiss.matches, qualification);
  const after = calculateSwissStandings(qualifiedIds, change.updatedMatches, qualification);

  /* ---------- 排名变化（全体队伍，跨队伍依赖） ---------- */
  const rankingChanges: CorrectionImpact['rankingChanges'] = [];
  const flatRank = (s: typeof before): Map<string, { rank: number; record: string }> => {
    const map = new Map<string, { rank: number; record: string }>();
    let n = 0;
    for (const group of s.groups) {
      for (const entry of group.entries) {
        n += 1;
        map.set(entry.teamId, { rank: n, record: entry.record });
      }
    }
    return map;
  };
  const beforeRank = flatRank(before);
  const afterRank = flatRank(after);

  for (const teamId of qualifiedIds) {
    const b = beforeRank.get(teamId);
    const a = afterRank.get(teamId);
    if (!b || !a) continue;
    if (b.rank !== a.rank || b.record !== a.record) {
      rankingChanges.push({
        teamId,
        before: b.rank,
        after: a.rank,
        recordBefore: b.record,
        recordAfter: a.record,
      });
    }
  }

  /* ---------- 受影响的下游轮次 ---------- */
  const changedRoundIndexes = new Set<number>();
  for (const matchId of change.matchIds) {
    const match = event.swiss.matches.find((m) => m.id === matchId);
    if (match) changedRoundIndexes.add(match.roundIndex);
  }
  const minChangedRound = changedRoundIndexes.size > 0 ? Math.min(...changedRoundIndexes) : 0;

  const affectedPublishedRounds: CorrectionImpact['affectedPublishedRounds'] = [];
  const startedDownstreamMatches: CorrectionImpact['startedDownstreamMatches'] = [];

  for (const round of event.swiss.rounds) {
    if (round.index <= minChangedRound) continue;
    const isPublished = round.publicationStatus === 'published';
    const isSuperseded = round.publicationStatus === 'superseded';
    if (!isPublished && !isSuperseded) continue;

    const matches = round.matchIds
      .map((id) => event.swiss.matches.find((m) => m.id === id))
      .filter((m): m is SwissMatch => m !== undefined);

    // “已开赛”必须有实际发生的痕迹：显式状态，或存在**已确认**的结果。
    // 只存在空的/未确认的 attempts 不算已开赛。
    const hasConfirmedResult = (m: SwissMatch): boolean =>
      m.attempts.some((a) => a.resultStatus === 'confirmed');
    const started = matches.filter(
      (m) => m.executionStatus === 'running' || m.executionStatus === 'finished' || hasConfirmedResult(m),
    );
    if (started.length > 0) {
      for (const m of started) {
        startedDownstreamMatches.push({
          matchId: m.id,
          roundIndex: round.index,
          note: `第 ${round.index} 轮的 ${m.id} 已开赛或有有效结果；必须保持已经发生的参赛双方与比赛记录`,
        });
      }
    } else if (isPublished) {
      affectedPublishedRounds.push({
        roundId: round.id,
        index: round.index,
        note: `第 ${round.index} 轮已公布但未开赛；需选择保留并说明，或作废后重新公布`,
      });
    }
  }

  /* ---------- 决赛影响：沿 winner/loser 依赖图遍历 ---------- */
  const affectedSeries = collectDownstreamSeries(event, minChangedRound);
  const finalsStarted = event.finals.series.filter(
    (s) => affectedSeries.includes(s.id) && (s.executionStatus === 'running' || s.executionStatus === 'finished' || s.games.some((g) => g.resultStatus === 'confirmed')),
  );

  /* ---------- 结论 ---------- */
  const blockers: string[] = [];
  const warnings: string[] = [];

  let requiredDisposition: CorrectionDisposition = 'downstream-not-published';
  if (startedDownstreamMatches.length > 0 || finalsStarted.length > 0) {
    requiredDisposition = 'committee-revision-recorded';
    blockers.push(
      '下游比赛已经开赛或有有效结果：不能静默把旧比分移给另一支队，必须记录组委会修订结果后才可恢复自动推进',
    );
  } else if (affectedPublishedRounds.length > 0) {
    requiredDisposition = 'pending';
    blockers.push('存在已公布但未开赛的下游轮次：必须先选择“保留并说明”或“作废并重新公布”后才能导出正式版本');
  }

  if (rankingChanges.length > 0 && affectedPublishedRounds.length === 0 && startedDownstreamMatches.length === 0) {
    warnings.push('排名发生变化，但没有已公布的下游轮次受影响；重建候选后重新生成即可');
  }

  // 种子也必须一并比对
  if (event.finals.seeding && rankingChanges.length > 0) {
    warnings.push('最终种子所依据的排名已变化，必须重新结算并比对八强种子');
  }

  return {
    changedIds: change.matchIds,
    affectedPublishedRounds,
    startedDownstreamMatches,
    affectedSeries,
    recomputedTeamIds: [...qualifiedIds],
    rankingChanges,
    requiredDisposition,
    blockers,
    warnings,
  };
}

/**
 * 沿 winner/loser 依赖图收集全部下游系列赛。
 * 决赛链很短但必须完整遍历，不能只看直接下一场。
 */
export function collectDownstreamSeries(event: EventFile, fromRound: number): string[] {
  const affected = new Set<string>();

  // 瑞士轮更正会影响种子 → 全部决赛系列赛都重新解析。
  if (fromRound >= 1) {
    for (const series of event.finals.series) {
      if (series.stage === 'finals' && series.countsForStandings) affected.add(series.id);
    }
  }

  // 依赖闭包（用于更精确的场景：只影响部分链路）
  const deps = new Map<string, string[]>();
  for (const series of event.finals.series) {
    deps.set(
      series.id,
      (series.slots ?? []).flatMap((r) => (r.kind === 'winner' || r.kind === 'loser' ? [r.seriesId] : [])),
    );
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, list] of deps) {
      if (affected.has(id)) continue;
      if (list.some((dep) => affected.has(dep))) {
        affected.add(id);
        changed = true;
      }
    }
  }

  // 保持稳定顺序（按决赛图顺序）
  return event.finals.series.filter((s) => affected.has(s.id)).map((s) => s.id);
}

/** 构造一条 Correction 记录（调用方决定 disposition）。 */
export function buildCorrection(
  id: string,
  change: CorrectionChange,
  impact: CorrectionImpact,
  at: string,
  disposition: CorrectionDisposition,
  previousValue: string | null,
  newValue: string | null,
): Correction {
  // 选择了一个非 pending 的处置方式，本身就是对阻断项的处置动作。
  // 因此只要 disposition 不是 pending，就允许继续推进；
  // 原始阻断原因保留在 note 里作为公开记录。
  const allowsProgress = disposition !== 'pending';

  return {
    id,
    reason: change.reason,
    at,
    previousValue,
    newValue,
    affectedIds: [
      ...impact.changedIds,
      ...impact.affectedPublishedRounds.map((r) => r.roundId),
      ...impact.startedDownstreamMatches.map((m) => m.matchId),
      ...impact.affectedSeries,
    ],
    disposition,
    allowsProgress,
    note: impact.blockers.length > 0 ? impact.blockers.join('；') : null,
  };
}

/**
 * 判断当前事件是否允许导出正式版本。
 * 有任何未处置的更正（disposition === 'pending'）时阻止导出。
 */
export function canExportOfficial(event: EventFile): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const correction of event.corrections) {
    if (correction.disposition === 'pending') {
      reasons.push(`更正 ${correction.id} 尚未处置：${correction.reason}`);
    }
    if (!correction.allowsProgress) {
      reasons.push(`更正 ${correction.id} 标记为不允许继续推进，需记录组委会修订后才能恢复`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** 比较两次排名的差异摘要，供维护工具显示“受影响范围”。 */
export function summarizeRankingChanges(changes: CorrectionImpact['rankingChanges']): string {
  if (changes.length === 0) return '排名没有变化。';
  return changes
    .map((c) => `${c.teamId}：第 ${c.before} 名（${c.recordBefore}） → 第 ${c.after} 名（${c.recordAfter}）`)
    .join('\n');
}

/** 提取某个战绩组的有序队伍，便于比对配对是否仍然成立。 */
export function snapshotGroupOrder(entries: readonly StandingsEntry[]): string[] {
  return entries.map((e) => e.teamId);
}
