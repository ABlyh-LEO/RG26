/**
 * 瑞士轮配对（docs/IMPLEMENTATION_PLAN.md 第 5.4 节）。
 *
 * 规则要点：
 * - R1 按正式排位首尾配对：1v16、2v15 …… 8v9。
 * - R2 起按相同战绩分组，组内按 R↓/P↓/T↑/排位名次↑ 排序，相邻配对（1v2、3v4 …）。
 * - 配对组顺序：R2 [1-0, 0-1]；R3 [2-0, 1-1, 0-2]；R4 [2-1, 1-2]；R5 [2-2]。
 * - 原文没有“避免重复对阵”，因此不实现避重、跨组调队、随机或轮空。
 * - 分组人数为奇数 / 名单异常 / 名额变化时：停止自动配对并报因，交组委会处置。
 */
import type { QualificationRanking, SwissMatch, SwissRound } from './schema';
import { type Standings, type StandingsEntry, calculateSwissStandings } from './standings';

/** 各轮的配对组顺序（第 5.4 节）。 */
export const ROUND_GROUP_ORDER: Record<number, readonly string[]> = {
  2: ['1-0', '0-1'],
  3: ['2-0', '1-1', '0-2'],
  4: ['2-1', '1-2'],
  5: ['2-2'],
};

/** 正常场次预期数量。用于校验，绝不为了凑数伪造比赛。 */
export const EXPECTED_MATCH_COUNTS: Record<number, number> = { 1: 8, 2: 8, 3: 8, 4: 6, 5: 3 };

export interface PairingProposal {
  roundIndex: number;
  /** 按组顺序、组内相邻顺序排列的候选对阵。 */
  pairs: { groupRecord: string; orderInGroup: number; homeTeamId: string; awayTeamId: string }[];
  /** 本次配对依据的评分快照。 */
  standings: Standings;
  /** 阻断自动配对的硬性问题（有值时不得公布）。 */
  blockers: string[];
  /** 非阻断的提示。 */
  warnings: string[];
}

export interface PairingContext {
  roundIndex: number;
  teamIds: readonly string[];
  matches: readonly SwissMatch[];
  qualification: QualificationRanking;
  rounds: readonly SwissRound[];
}

/**
 * 判断本轮是否可以生成候选：必须存在上一轮，且上一轮全部比赛确认完毕。
 * R1 例外：R1 依赖排位赛正式排名已确认。
 */
export function checkRoundGate(ctx: PairingContext): { ok: boolean; reason: string | null } {
  const { roundIndex, qualification, rounds } = ctx;

  if (roundIndex === 1) {
    if (qualification.status !== 'confirmed') {
      return { ok: false, reason: '排位赛正式排名尚未确认，无法生成第一轮对阵' };
    }
    // 瑞士轮只取排位赛前 16 名。排位赛排名本身包含全部 22 队，这是正常的，
    // 因此这里比较的是"排名中可用于配对的前 N 名"，而不是整份排名的长度。
    const needed = ctx.teamIds.length;
    if (qualification.orderedTeamIds.length < needed) {
      return {
        ok: false,
        reason: `排位赛排名只有 ${qualification.orderedTeamIds.length} 队，不足以确定瑞士轮 ${needed} 支参赛队`,
      };
    }
    const topN = qualification.orderedTeamIds.slice(0, needed);
    const missing = ctx.teamIds.filter((id) => !topN.includes(id));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `瑞士轮参赛队与排位赛前 ${needed} 名不一致，缺少：${missing.join('、')}`,
      };
    }
    return { ok: true, reason: null };
  }

  const previous = rounds.find((r) => r.index === roundIndex - 1);
  if (!previous) {
    return { ok: false, reason: `缺少第 ${roundIndex - 1} 轮记录，无法生成第 ${roundIndex} 轮` };
  }
  if (previous.publicationStatus === 'draft') {
    return { ok: false, reason: `第 ${roundIndex - 1} 轮尚未发布` };
  }

  const previousMatches = ctx.matches.filter((m) => m.roundIndex === roundIndex - 1);
  if (previousMatches.length === 0) {
    return { ok: false, reason: `第 ${roundIndex - 1} 轮没有任何比赛` };
  }
  const unconfirmed = previousMatches.filter(
    (m) => m.effectiveAttemptId === null || m.attempts.find((a) => a.id === m.effectiveAttemptId)?.resultStatus !== 'confirmed',
  );
  if (unconfirmed.length > 0) {
    return {
      ok: false,
      reason: `第 ${roundIndex - 1} 轮还有 ${unconfirmed.length} 场未确认结果（${unconfirmed
        .map((m) => m.id)
        .join('、')}）`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * 生成下一轮候选配对。
 *
 * 重要：本函数只产出候选，绝不修改事件；对外公布必须另行调用 publish。
 */
export function generateSwissPairings(ctx: PairingContext): PairingProposal {
  const gate = checkRoundGate(ctx);
  if (!gate.ok) {
    return {
      roundIndex: ctx.roundIndex,
      pairs: [],
      standings: calculateSwissStandings(ctx.teamIds, ctx.matches, ctx.qualification),
      blockers: [gate.reason ?? '轮次门禁未通过'],
      warnings: [],
    };
  }

  const standings = calculateSwissStandings(ctx.teamIds, ctx.matches, ctx.qualification);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const pairs: PairingProposal['pairs'] = [];

  if (ctx.roundIndex === 1) {
    // R1：在**晋级的 16 队**中按正式排位首尾配对 —— 第 1 名对第 16 名、第 2 名对第 15 名……
    // 注意：排位赛排名含全部 22 队，必须只取前 N 名（N = 瑞士轮参赛队数），
    // 否则会把第 17–22 名（已结算优秀奖）错误地配进瑞士轮。
    const ordered = ctx.qualification.orderedTeamIds.slice(0, ctx.teamIds.length);
    const half = Math.floor(ordered.length / 2);
    for (let i = 0; i < half; i += 1) {
      const home = ordered[i];
      const away = ordered[ordered.length - 1 - i];
      if (!home || !away) continue;
      pairs.push({ groupRecord: '0-0', orderInGroup: i + 1, homeTeamId: home, awayTeamId: away });
    }
    if (pairs.length !== EXPECTED_MATCH_COUNTS[1]) {
      blockers.push(`第一轮预期 ${EXPECTED_MATCH_COUNTS[1]} 场，实际生成 ${pairs.length} 场`);
    }
    return { roundIndex: ctx.roundIndex, pairs, standings, blockers, warnings };
  }

  const groupOrder = ROUND_GROUP_ORDER[ctx.roundIndex];
  if (!groupOrder) {
    return {
      roundIndex: ctx.roundIndex,
      pairs: [],
      standings,
      blockers: [`第 ${ctx.roundIndex} 轮没有定义的配对组顺序`],
      warnings,
    };
  }

  const activeTeams = determineActiveTeams(ctx, standings);

  for (const record of groupOrder) {
    const group = standings.groups.find((g) => g.record === record);
    const inGroup = (group?.entries ?? []).filter((e) => activeTeams.has(e.teamId));
    // 已晋级 / 已淘汰的队伍不再参赛；记录数应为偶数才可配对。
    if (inGroup.length === 0) continue;
    if (inGroup.length % 2 !== 0) {
      blockers.push(
        `${record} 组有 ${inGroup.length} 支仍在比赛中的队伍，人数为奇数，停止自动配对，请组委会处置（不擅自轮空）`,
      );
      continue;
    }
    for (let i = 0; i < inGroup.length; i += 2) {
      const home = inGroup[i];
      const away = inGroup[i + 1];
      if (!home || !away) continue;
      pairs.push({
        groupRecord: record,
        orderInGroup: i / 2 + 1,
        homeTeamId: home.teamId,
        awayTeamId: away.teamId,
      });
    }
  }

  const expected = EXPECTED_MATCH_COUNTS[ctx.roundIndex];
  if (expected !== undefined && pairs.length !== expected) {
    // 正常赛程下必须精确匹配；否则报为阻断，避免为了凑数伪造比赛。
    blockers.push(
      `第 ${ctx.roundIndex} 轮预期 ${expected} 场，实际生成 ${pairs.length} 场；请核对退赛/名额变化后由组委会修订`,
    );
  }

  const seen = new Set<string>();
  for (const p of pairs) {
    if (p.homeTeamId === p.awayTeamId) blockers.push(`出现自我对阵：${p.homeTeamId}`);
    const key = [p.homeTeamId, p.awayTeamId].sort().join('|');
    if (seen.has(key)) blockers.push(`出现重复对阵：${p.homeTeamId} 对 ${p.awayTeamId}`);
    seen.add(key);
  }

  return { roundIndex: ctx.roundIndex, pairs, standings, blockers, warnings };
}

/**
 * 判定仍在参赛的队伍：未达 3 胜且未达 3 负。
 * 达到 3 胜或 3 负后停止参赛，但其 P/W/L 保留、O/R 仍随历史对手更新（第 5.3 节）。
 */
export function determineActiveTeams(ctx: PairingContext, standings: Standings): Set<string> {
  const active = new Set<string>();
  for (const teamId of ctx.teamIds) {
    const entry = standings.byTeam.get(teamId);
    if (!entry) continue;
    if (entry.wins >= 3 || entry.losses >= 3) continue;
    active.add(teamId);
  }
  return active;
}

/** 把候选配对转换为待写入的 SwissMatch 骨架（不含 attempts）。 */
export function proposalToMatchSkeletons(
  proposal: PairingProposal,
  roundId: string,
  matchIdFactory: (roundIndex: number, index: number) => string,
  scheduleItemIdFactory: (roundIndex: number, groupRecord: string, orderInGroup: number) => string,
): Omit<SwissMatch, 'attempts' | 'effectiveAttemptId'>[] {
  return proposal.pairs.map((pair, index) => ({
    id: matchIdFactory(proposal.roundIndex, index),
    roundId,
    roundIndex: proposal.roundIndex,
    groupRecord: pair.groupRecord,
    orderInGroup: pair.orderInGroup,
    slots: [
      { kind: 'team', teamId: pair.homeTeamId },
      { kind: 'team', teamId: pair.awayTeamId },
    ],
    participantSnapshot: [pair.homeTeamId, pair.awayTeamId] as [string, string],
    executionStatus: 'scheduled' as const,
    scheduleItemId: scheduleItemIdFactory(proposal.roundIndex, pair.groupRecord, pair.orderInGroup),
    note: null,
  }));
}

/** 战绩组的可读说明，用于 UI 文案（例如“2 胜 0 负 · 本组获胜即晋级”）。 */
export function describeGroup(record: string): string {
  const [w = '0', l = '0'] = record.split('-');
  return `${w} 胜 ${l} 负`;
}

/**
 * 该战绩组本轮的语义提示。
 * 只描述规则允许的结论，不预测结果。
 */
export function groupStakes(wins: number, losses: number): string | null {
  if (wins === 2 && losses === 0) return '本组获胜即晋级八强（3-0）';
  if (wins === 2 && losses === 1) return '本组获胜即晋级八强（3-1）';
  if (wins === 1 && losses === 1) return '本组获胜继续争夺晋级';
  if (wins === 2 && losses === 2) return '本组获胜晋级八强（3-2），落败淘汰';
  if (wins === 0 && losses === 2) return '本组落败即淘汰（0-3）';
  if (wins === 1 && losses === 2) return '本组落败即淘汰（1-3）';
  if (wins === 0 && losses === 1) return '本组获胜进入 1-1';
  return null;
}

/** 供 UI 使用的组内条目视图。 */
export interface GroupView {
  record: string;
  description: string;
  stakes: string | null;
  entries: StandingsEntry[];
}

export function toGroupViews(standings: Standings): GroupView[] {
  return standings.groups.map((g) => ({
    record: g.record,
    description: describeGroup(g.record),
    stakes: groupStakes(g.wins, g.losses),
    entries: g.entries,
  }));
}
