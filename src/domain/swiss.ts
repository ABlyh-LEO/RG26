/**
 * 瑞士轮配对（赛程手册「赛段二」+ 附一）。
 *
 * 规则要点（手册原文为准）：
 * - R1：按正式排位**分为前后两半对位**——「依次安排第1名对第9名、第2名对第10名，
 *   直至第8名对第16名」，即 1v9、2v10 …… 8v16。
 * - R2 起：按相同战绩分组，组内按 R↓/P↑…（准确说是 R↓/P↓/T↑/排位名次↑）排序后
 *   **首尾配对**——手册附一简例「甲对辛、乙对庚、丙对己、丁对戊」，
 *   并给出「六队组为第1名对第6名、第2名对第5名、第3名对第4名；四队组为
 *   第1名对第4名、第2名对第3名」。
 * - 配对组顺序：R2 [1-0, 0-1]；R3 [2-0, 1-1, 0-2]；R4 [2-1, 1-2]；R5 [2-2]。
 * - 原文没有“避免重复对阵”，因此不实现避重、跨组调队、随机或轮空。
 * - 分组人数为奇数 / 名单异常 / 名额变化时：停止自动配对并报因，交组委会处置。
 * - 组委会因特殊情况决定调整时，可在自动对阵上**人工微调**（交换席位），
 *   微调结果必须通过 `checkPairingAdjustment` 并写明原因后才会写入数据；
 *   自动配对本身保持原样，数据里同时留下 `revisionNote` 便于事后追问。
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

/**
 * 一场对阵：候选人、已公布对阵、人工微调后的对阵**共用同一形状**。
 *
 * 这样"把候选原样公布"与"把微调后的结果公布"走完全相同的写入路径，
 * 不存在两套写入代码各自演化的问题。
 */
export interface PairingPair {
  groupRecord: string;
  orderInGroup: number;
  homeTeamId: string;
  awayTeamId: string;
}

/** 一场比赛里的两个席位。 */
export type PairingSide = 'home' | 'away';

/** 指向某一场的某一席位；人工微调以"交换两个席位"为最小操作。 */
export interface PairingSlotRef {
  matchIndex: number;
  side: PairingSide;
}

export interface PairingProposal {
  roundIndex: number;
  /** 按组顺序、组内相邻顺序排列的候选对阵。 */
  pairs: PairingPair[];
  /** 本次配对依据的评分快照。 */
  standings: Standings;
  /**
   * **轮次门禁**类阻断（上一轮未结束、排位赛名次未成立等）。
   *
   * 这一类问题不是"配对得不好"，而是"现在还不该配对"；
   * 人工微调不能绕过，有值时一律不得公布。
   */
  blockers: string[];
  /**
   * **自动配对自身**的构成问题（战绩组人数为奇数、场次数与手册不符、
   * 出现自我对阵或重复对阵）。
   *
   * 这类问题允许由组委会人工微调后公布 —— 微调结果必须通过
   * `checkPairingAdjustment`，并写明调整原因。原样公布（未微调）仍然被拒绝。
   */
  compositionIssues: string[];
  /** 非阻断的提示。 */
  warnings: string[];
  /**
   * 本轮应当参赛、且**每队只出场一次**的队伍。
   *
   * 人工微调的完整性基准：任何调整都必须让这批队伍各出现恰好一次。
   * 门禁未通过时为空数组（此时参赛队尚未确定）。
   */
  participantTeamIds: string[];
  /** 手册对本轮的预期场次；该轮未定义时为空。 */
  expectedMatchCount: number | null;
}

export interface PairingContext {
  roundIndex: number;
  teamIds: readonly string[];
  matches: readonly SwissMatch[];
  qualification: QualificationRanking;
  rounds: readonly SwissRound[];
  /**
   * 排位赛**正式名次是否成立**（调用方用 `officialQualificationRanking` 算出后传入）。
   *
   * 领域层不直接读 `event`，因此把结论注入。R1 依赖的是"谁是前 16 名"这个
   * **对外结论**，它必须已经成立：要么成绩完整算出来，要么由人登记并写明来源。
   * 只用"已确认"这一个字段不够——历史缺陷正是"确认一条成绩就把按队号排出来的
   * 前 16 支当成了晋级名单"。
   */
  qualificationOfficial: { ok: boolean; reason: string | null };
}

/**
 * 判断本轮是否可以生成候选：必须存在上一轮，且上一轮全部比赛确认完毕。
 * R1 例外：R1 依赖排位赛**正式名次**已经成立。
 */
export function checkRoundGate(ctx: PairingContext): { ok: boolean; reason: string | null } {
  const { roundIndex, qualification, rounds } = ctx;

  if (roundIndex === 1) {
    if (qualification.status !== 'confirmed') {
      return { ok: false, reason: '排位赛正式排名尚未确认，无法生成第一轮对阵' };
    }
    if (!ctx.qualificationOfficial.ok) {
      return {
        ok: false,
        reason: `排位赛正式名次尚未成立，不能据此确定瑞士轮参赛队：${
          ctx.qualificationOfficial.reason ?? '成绩不完整且未人工定榜'
        }`,
      };
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
  const expectedMatchCount = EXPECTED_MATCH_COUNTS[ctx.roundIndex] ?? null;
  const gate = checkRoundGate(ctx);
  if (!gate.ok) {
    return {
      roundIndex: ctx.roundIndex,
      pairs: [],
      standings: calculateSwissStandings(ctx.teamIds, ctx.matches, ctx.qualification),
      blockers: [gate.reason ?? '轮次门禁未通过'],
      compositionIssues: [],
      warnings: [],
      participantTeamIds: [],
      expectedMatchCount,
    };
  }

  const standings = calculateSwissStandings(ctx.teamIds, ctx.matches, ctx.qualification);
  const blockers: string[] = [];
  const compositionIssues: string[] = [];
  const warnings: string[] = [];
  const pairs: PairingPair[] = [];

  if (ctx.roundIndex === 1) {
    /*
     * R1：在**晋级的 16 队**中按正式排位**前后两半对位**配对：
     * 第 1 名对第 9 名、第 2 名对第 10 名……第 8 名对第 16 名（手册赛段二）。
     *
     * 注意：排位赛排名含全部 22 队，必须只取前 N 名（N = 瑞士轮参赛队数），
     * 否则会把第 17–22 名（已结算优秀奖）错误地配进瑞士轮。
     */
    const ordered = ctx.qualification.orderedTeamIds.slice(0, ctx.teamIds.length);
    const half = Math.floor(ordered.length / 2);
    for (let i = 0; i < half; i += 1) {
      const home = ordered[i];
      const away = ordered[i + half];
      if (!home || !away) continue;
      pairs.push({ groupRecord: '0-0', orderInGroup: i + 1, homeTeamId: home, awayTeamId: away });
    }
    if (pairs.length !== EXPECTED_MATCH_COUNTS[1]) {
      compositionIssues.push(`第一轮预期 ${EXPECTED_MATCH_COUNTS[1]} 场，实际生成 ${pairs.length} 场`);
    }
    return {
      roundIndex: ctx.roundIndex,
      pairs,
      standings,
      blockers,
      compositionIssues,
      warnings,
      participantTeamIds: [...ordered],
      expectedMatchCount,
    };
  }

  const groupOrder = ROUND_GROUP_ORDER[ctx.roundIndex];
  if (!groupOrder) {
    return {
      roundIndex: ctx.roundIndex,
      pairs: [],
      standings,
      blockers: [`第 ${ctx.roundIndex} 轮没有定义的配对组顺序`],
      compositionIssues,
      warnings,
      participantTeamIds: [],
      expectedMatchCount,
    };
  }

  const activeTeams = determineActiveTeams(ctx, standings);
  // 参赛队按 teamIds 的固定顺序列出，保证同一输入永远得到同一份基准名单。
  const participantTeamIds = ctx.teamIds.filter((id) => activeTeams.has(id));

  for (const record of groupOrder) {
    const group = standings.groups.find((g) => g.record === record);
    const inGroup = (group?.entries ?? []).filter((e) => activeTeams.has(e.teamId));
    // 已晋级 / 已淘汰的队伍不再参赛；记录数应为偶数才可配对。
    if (inGroup.length === 0) continue;
    if (inGroup.length % 2 !== 0) {
      compositionIssues.push(
        `${record} 组有 ${inGroup.length} 支仍在比赛中的队伍，人数为奇数，自动配对无法给出完整对阵，请组委会处置（不擅自轮空）；如确需调整，可在对阵表上人工微调并写明原因`,
      );
      continue;
    }
    /*
     * 组内**首尾配对**：第 1 名对末名、第 2 名对倒数第 2 名……（手册附一简例
     * 「甲对辛、乙对庚、丙对己、丁对戊」；六队组 1v6/2v5/3v4；四队组 1v4/2v3）。
     * 场次顺序与配对顺序一致，即 orderInGroup 1 = 第 1 名对末名。
     */
    const half = Math.floor(inGroup.length / 2);
    for (let i = 0; i < half; i += 1) {
      const home = inGroup[i];
      const away = inGroup[inGroup.length - 1 - i];
      if (!home || !away) continue;
      pairs.push({
        groupRecord: record,
        orderInGroup: i + 1,
        homeTeamId: home.teamId,
        awayTeamId: away.teamId,
      });
    }
  }

  const expected = EXPECTED_MATCH_COUNTS[ctx.roundIndex];
  if (expected !== undefined && pairs.length !== expected) {
    // 正常赛程下必须精确匹配；否则报为构成问题，避免为了凑数伪造比赛。
    compositionIssues.push(
      `第 ${ctx.roundIndex} 轮预期 ${expected} 场，实际生成 ${pairs.length} 场；请核对退赛/名额变化后由组委会裁决（人工微调也不能凭空增减场次，除非组委会另有决定）`,
    );
  }

  const seen = new Set<string>();
  for (const p of pairs) {
    if (p.homeTeamId === p.awayTeamId) compositionIssues.push(`出现自我对阵：${p.homeTeamId}`);
    const key = [p.homeTeamId, p.awayTeamId].sort().join('|');
    if (seen.has(key)) compositionIssues.push(`出现重复对阵：${p.homeTeamId} 对 ${p.awayTeamId}`);
    seen.add(key);
  }

  return {
    roundIndex: ctx.roundIndex,
    pairs,
    standings,
    blockers,
    compositionIssues,
    warnings,
    participantTeamIds,
    expectedMatchCount,
  };
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

/**
 * 把一组对阵转换为待写入的 SwissMatch 骨架（不含 attempts）。
 *
 * 参数刻意只要求 `{ roundIndex, pairs }`：候选、已公布对阵与人工微调后的
 * 对阵都能直接传入，写入路径因此唯一。
 */
export function proposalToMatchSkeletons(
  source: { roundIndex: number; pairs: readonly PairingPair[] },
  roundId: string,
  matchIdFactory: (roundIndex: number, index: number) => string,
  scheduleItemIdFactory: (roundIndex: number, groupRecord: string, orderInGroup: number) => string,
): Omit<SwissMatch, 'attempts' | 'effectiveAttemptId'>[] {
  return source.pairs.map((pair, index) => ({
    id: matchIdFactory(source.roundIndex, index),
    roundId,
    roundIndex: source.roundIndex,
    groupRecord: pair.groupRecord,
    orderInGroup: pair.orderInGroup,
    slots: [
      { kind: 'team', teamId: pair.homeTeamId },
      { kind: 'team', teamId: pair.awayTeamId },
    ],
    participantSnapshot: [pair.homeTeamId, pair.awayTeamId] as [string, string],
    executionStatus: 'scheduled' as const,
    scheduleItemId: scheduleItemIdFactory(source.roundIndex, pair.groupRecord, pair.orderInGroup),
    note: null,
  }));
}

/* ------------------------------------------------------------------ *
 * 人工微调
 * ------------------------------------------------------------------ */

/**
 * 交换两个席位的队伍（纯函数）。
 *
 * 这是人工微调的唯一原语：同场两个席位交换 = 换边（红蓝互换）；
 * 不同场的两个席位交换 = 换对手。任何排列都能由若干次交换得到。
 * 越界或引用不存在时原样返回，绝不抛错 —— UI 可能点到过期下标。
 */
export function swapPairingSlots(
  pairs: readonly PairingPair[],
  a: PairingSlotRef,
  b: PairingSlotRef,
): PairingPair[] {
  const next = pairs.map((pair) => ({ ...pair }));
  const first = next[a.matchIndex];
  const second = next[b.matchIndex];
  if (!first || !second) return next;
  const firstTeam = a.side === 'home' ? first.homeTeamId : first.awayTeamId;
  const secondTeam = b.side === 'home' ? second.homeTeamId : second.awayTeamId;
  if (a.side === 'home') first.homeTeamId = secondTeam;
  else first.awayTeamId = secondTeam;
  if (b.side === 'home') second.homeTeamId = firstTeam;
  else second.awayTeamId = firstTeam;
  return next;
}

/** 人工微调结果：调整后的完整对阵 + 必须写明的调整原因。 */
export interface PairingAdjustment {
  pairs: PairingPair[];
  note: string;
}

export interface PairingAdjustmentCheck {
  /** 不可公布的问题。 */
  errors: string[];
  /** 可以公布但需要人眼确认的提示（例如跨组调整）。 */
  warnings: string[];
  /** 与自动配对逐场对比的可读差异。 */
  changes: string[];
  /** 与自动配对不同的场次数。 */
  changedMatchCount: number;
}

export interface PairingAdjustmentOptions {
  /** 把队伍 ID 换成可读名称；领域层不持有队名，由调用方注入。 */
  label?: (teamId: string) => string;
  /** 把场次序号换成可读标签，默认「第 N 场」；维护端注入全局比赛编号。 */
  slotLabel?: (index: number) => string;
}

function sideText(pair: PairingPair | undefined, label: (teamId: string) => string): string {
  if (!pair) return '（缺）';
  return `${label(pair.homeTeamId)} vs ${label(pair.awayTeamId)}`;
}

/**
 * 校验人工微调后的对阵。
 *
 * 通过的条件是"这是一轮**结构完整**的对阵"：
 * 场次数与手册一致、每支本轮参赛队恰好出现一次、无自我对阵、无重复对阵，
 * 且每场仍落在本轮允许的战绩组与连续的组内序号上。
 *
 * 刻意**不**检查"调整后的对手是否仍属同一战绩组"：特殊情况下的跨组调整
 * 正是需要人工介入的场合，因此只给出提示，由组委会在说明里承担。
 */
export function checkPairingAdjustment(
  proposal: PairingProposal,
  pairs: readonly PairingPair[],
  options: PairingAdjustmentOptions = {},
): PairingAdjustmentCheck {
  const label = options.label ?? ((teamId: string) => teamId);
  /*
   * 场次标签：默认「第 N 场」（组内顺序）。现场是按**全局比赛编号**叫场的，
   * 因此维护端会注入「第 45 场」这样的标签，让提示与对讲机里说的是同一场比赛。
   */
  const slot = options.slotLabel ?? ((index: number) => `第 ${index + 1} 场`);
  const errors: string[] = [];
  const warnings: string[] = [];

  const participants = proposal.participantTeamIds;
  if (participants.length === 0) {
    return {
      errors: [
        '本轮参赛队伍尚未确定（轮次门禁未通过），不能进行人工微调；请先处理上方阻断问题',
      ],
      warnings,
      changes: [],
      changedMatchCount: 0,
    };
  }

  if (proposal.expectedMatchCount !== null && pairs.length !== proposal.expectedMatchCount) {
    errors.push(
      `第 ${proposal.roundIndex} 轮应有 ${proposal.expectedMatchCount} 场，当前为 ${pairs.length} 场；` +
        '轮空、合并或增减场次属于组委会另行的赛程决定，不在对阵微调范围内',
    );
  }

  const known = new Set(participants);
  const occurrences = new Map<string, string[]>();
  const pairKeys = new Map<string, number>();

  pairs.forEach((pair, index) => {
    const where = slot(index);
    if (!pair.homeTeamId || !pair.awayTeamId) {
      errors.push(`${where}还有席位没有队伍`);
      return;
    }
    if (pair.homeTeamId === pair.awayTeamId) {
      errors.push(`${where}出现自我对阵：${label(pair.homeTeamId)}`);
    }
    for (const teamId of [pair.homeTeamId, pair.awayTeamId]) {
      if (!known.has(teamId)) {
        errors.push(`${where}安排了不属于本轮参赛范围的队伍：${label(teamId)}`);
        continue;
      }
      const list = occurrences.get(teamId);
      if (list) list.push(where);
      else occurrences.set(teamId, [where]);
    }
    const key = [pair.homeTeamId, pair.awayTeamId].sort().join('|');
    const previous = pairKeys.get(key);
    if (previous !== undefined) {
      errors.push(
        `同一对队伍被安排了两次：${label(pair.homeTeamId)} vs ${label(pair.awayTeamId)}（${slot(previous)} 与 ${where}）`,
      );
    } else {
      pairKeys.set(key, index);
    }
  });

  for (const [teamId, where] of occurrences) {
    if (where.length > 1) {
      errors.push(`${label(teamId)} 被安排了两场（${where.join('、')}）：每队本轮只能出场一次`);
    }
  }
  const missing = participants.filter((teamId) => !occurrences.has(teamId));
  if (missing.length > 0) {
    errors.push(
      `还有 ${missing.length} 支本轮参赛队没有对手：${missing.map((teamId) => label(teamId)).join('、')}`,
    );
  }

  const allowedRecords = ROUND_GROUP_ORDER[proposal.roundIndex] ?? ['0-0'];
  const byRecord = new Map<string, number[]>();
  pairs.forEach((pair, index) => {
    if (!allowedRecords.includes(pair.groupRecord)) {
      errors.push(
        `${slot(index)}的战绩组「${pair.groupRecord}」不属于第 ${proposal.roundIndex} 轮（允许：${allowedRecords.join('、')}）`,
      );
      return;
    }
    const list = byRecord.get(pair.groupRecord);
    if (list) list.push(pair.orderInGroup);
    else byRecord.set(pair.groupRecord, [pair.orderInGroup]);
    for (const teamId of [pair.homeTeamId, pair.awayTeamId]) {
      const entry = proposal.standings.byTeam.get(teamId);
      if (entry && entry.record !== pair.groupRecord) {
        warnings.push(
          `${slot(index)}为跨组调整：${label(teamId)} 当前战绩 ${entry.record}，被安排在 ${pair.groupRecord} 组`,
        );
      }
    }
  });
  for (const [record, orders] of byRecord) {
    const sorted = [...orders].sort((a, b) => a - b);
    sorted.forEach((order, index) => {
      if (order !== index + 1) {
        errors.push(`${record} 组的组内序号必须从 1 连续：组内第 ${index + 1} 位却是 ${order}`);
      }
    });
  }

  const changes: string[] = [];
  const length = Math.max(pairs.length, proposal.pairs.length);
  for (let index = 0; index < length; index += 1) {
    const before = proposal.pairs[index];
    const after = pairs[index];
    if (!after) {
      changes.push(`${slot(index)}：${sideText(before, label)} → 已移除`);
      continue;
    }
    if (!before) {
      changes.push(`${slot(index)}：新增 ${sideText(after, label)}`);
      continue;
    }
    if (before.homeTeamId !== after.homeTeamId || before.awayTeamId !== after.awayTeamId) {
      changes.push(`${slot(index)}：${sideText(before, label)} → ${sideText(after, label)}`);
    }
  }

  return { errors, warnings, changes, changedMatchCount: changes.length };
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
