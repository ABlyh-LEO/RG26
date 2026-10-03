/**
 * 瑞士轮对阵的人工微调（组委会因特殊情况调整已自动配好的对阵）。
 *
 * 需求：自动配对是**建议**，现场会出现手册没写的情况（设备故障、同校回避、
 * 场地冲突……）。组委会的实际决定必须能落进数据，而不是只在页面之外口头说明。
 *
 * 本文件守住四条：
 * 1. 微调只是"交换席位"，交换后对阵必须仍然**结构完整**（场次数量、每队一次、
 *    无自我对阵、无重复对阵）——不完整的一律不能公布；
 * 2. **轮次门禁**不能被微调绕过（上一轮没打完就是不能公布）；
 * 3. 与自动配对不同就必须写明原因，原因随轮次写入 `revisionNote`；
 * 4. 跨组调整允许但必须提示，不静默通过。
 */
import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema, type EventFile } from '../../src/domain/schema';
import { validateEvent } from '../../src/domain/validation';
import {
  checkPairingAdjustment,
  generateSwissPairings,
  swapPairingSlots,
  type PairingPair,
  type PairingProposal,
} from '../../src/domain/swiss';
import {
  applyBo1Entry,
  applyQualificationRanking,
  generateNextRound,
  publishRound,
  publishedRoundPairs,
} from '../../src/operator/draft';

const BASE = eventFileSchema.parse(buildSeedEvent('2026-10-04T08:00:00+08:00'));

/** 定榜后的赛事（人工名次，避免依赖成绩完整性）。 */
function ranked(): EventFile {
  const order = BASE.teams.filter((team) => team.division === 'competitive').map((team) => team.id);
  const result = applyQualificationRanking(BASE, order, '对阵微调测试');
  if (!result.ok) throw new Error(result.messages.join('；'));
  return result.event;
}

function candidate(event: EventFile, roundIndex: number): PairingProposal {
  const outcome = generateNextRound(event, roundIndex);
  if (!outcome.ok || !outcome.proposal) throw new Error(outcome.messages.join('；'));
  return outcome.proposal;
}

/** 按"第一个席位获胜"打完一轮，用于推进到下一轮。 */
function playRound(event: EventFile, roundIndex: number): EventFile {
  let next = event;
  for (const match of event.swiss.matches.filter((m) => m.roundIndex === roundIndex)) {
    const applied = applyBo1Entry(next, {
      matchId: match.id, homeScore: '16', awayScore: '6', homeSeconds: '90', awaySeconds: '160',
      winnerId: match.participantSnapshot![0], resultKind: 'normal', note: null,
    });
    if (!applied.ok) throw new Error(applied.messages.join('；'));
    next = applied.event;
  }
  return next;
}

const nameOf = (event: EventFile) => (teamId: string) =>
  event.teams.find((team) => team.id === teamId)?.name ?? teamId;

describe('交换席位（微调的唯一原语）', () => {
  const pairs: PairingPair[] = [
    { groupRecord: '0-0', orderInGroup: 1, homeTeamId: 'a', awayTeamId: 'b' },
    { groupRecord: '0-0', orderInGroup: 2, homeTeamId: 'c', awayTeamId: 'd' },
  ];

  it('跨场交换客队 = 换对手', () => {
    const next = swapPairingSlots(pairs, { matchIndex: 0, side: 'away' }, { matchIndex: 1, side: 'away' });
    expect(next.map((pair) => [pair.homeTeamId, pair.awayTeamId])).toEqual([['a', 'd'], ['c', 'b']]);
  });

  it('同场交换两个席位 = 换边', () => {
    const next = swapPairingSlots(pairs, { matchIndex: 1, side: 'home' }, { matchIndex: 1, side: 'away' });
    expect(next.map((pair) => [pair.homeTeamId, pair.awayTeamId])).toEqual([['a', 'b'], ['d', 'c']]);
  });

  it('不修改入参，越界时原样返回而不是抛错', () => {
    const next = swapPairingSlots(pairs, { matchIndex: 0, side: 'home' }, { matchIndex: 9, side: 'away' });
    expect(pairs[0]!.homeTeamId).toBe('a');
    expect(next).toEqual(pairs);
    expect(next[0]).not.toBe(pairs[0]);
  });
});

describe('微调校验（结构完整性）', () => {
  const event = ranked();
  const proposal = candidate(event, 1);

  it('未调整时没有差异、没有错误', () => {
    const check = checkPairingAdjustment(proposal, proposal.pairs);
    expect(check.errors).toEqual([]);
    expect(check.changes).toEqual([]);
    expect(check.changedMatchCount).toBe(0);
    expect(proposal.participantTeamIds).toHaveLength(16);
    expect(proposal.expectedMatchCount).toBe(8);
  });

  it('交换两场客队后仍完整，并逐场列出差异', () => {
    const pairs = swapPairingSlots(proposal.pairs, { matchIndex: 0, side: 'away' }, { matchIndex: 1, side: 'away' });
    const check = checkPairingAdjustment(proposal, pairs, { label: nameOf(event) });
    expect(check.errors).toEqual([]);
    expect(check.changedMatchCount).toBe(2);
    expect(check.changes[0]).toContain('第 1 场');
    expect(check.changes[0]).toContain('→');
    expect(check.changes[1]).toContain('第 2 场');
  });

  it('同一支队伍被排进两场会被拦住', () => {
    const pairs = proposal.pairs.map((pair) => ({ ...pair }));
    const first = pairs[0]!;
    pairs[1] = { ...pairs[1]!, homeTeamId: first.homeTeamId };
    const check = checkPairingAdjustment(proposal, pairs, { label: nameOf(event) });
    expect(check.errors.join(' ')).toContain('被安排了两场');
    expect(check.errors.join(' ')).toContain('没有对手');
  });

  it('自我对阵与重复对阵都会被拦住', () => {
    const pairs = proposal.pairs.map((pair) => ({ ...pair }));
    pairs[0] = { ...pairs[0]!, awayTeamId: pairs[0]!.homeTeamId };
    pairs[1] = { ...pairs[1]!, homeTeamId: pairs[2]!.homeTeamId, awayTeamId: pairs[2]!.awayTeamId };
    const check = checkPairingAdjustment(proposal, pairs, { label: nameOf(event) });
    expect(check.errors.join(' ')).toContain('自我对阵');
    expect(check.errors.join(' ')).toContain('同一对队伍被安排了两次');
  });

  it('场次数与手册不符（少一场）会被拦住', () => {
    const check = checkPairingAdjustment(proposal, proposal.pairs.slice(0, 7), { label: nameOf(event) });
    expect(check.errors.join(' ')).toContain('应有 8 场，当前为 7 场');
    expect(check.errors.join(' ')).toContain('轮空');
  });

  it('门禁未通过时明确拒绝微调（参赛队尚未确定）', () => {
    const blocked = generateSwissPairings({
      roundIndex: 2,
      teamIds: proposal.participantTeamIds,
      matches: [],
      qualification: event.qualification.ranking,
      rounds: event.swiss.rounds,
      qualificationOfficial: { ok: true, reason: null },
    });
    expect(blocked.blockers.length).toBeGreaterThan(0);
    expect(blocked.participantTeamIds).toEqual([]);
    const check = checkPairingAdjustment(blocked, []);
    expect(check.errors.join(' ')).toContain('参赛队伍尚未确定');
  });
});

describe('跨组调整：允许但必须提示', () => {
  it('把 1-0 组的队伍与 0-1 组的队伍互换时给出跨组提示', () => {
    const base = ranked();
    const publishedR1 = publishRound(base, 1, candidate(base, 1)).event;
    const event = playRound(publishedR1, 1);
    const proposal = candidate(event, 2);
    const oneZero = proposal.pairs.findIndex((pair) => pair.groupRecord === '1-0');
    const zeroOne = proposal.pairs.findIndex((pair) => pair.groupRecord === '0-1');
    expect(oneZero).toBeGreaterThanOrEqual(0);
    expect(zeroOne).toBeGreaterThanOrEqual(0);
    const pairs = swapPairingSlots(
      proposal.pairs,
      { matchIndex: oneZero, side: 'away' },
      { matchIndex: zeroOne, side: 'away' },
    );
    const check = checkPairingAdjustment(proposal, pairs, { label: nameOf(event) });
    expect(check.errors).toEqual([]);
    expect(check.warnings.join(' ')).toContain('跨组调整');
    expect(check.changedMatchCount).toBe(2);
  });
});

describe('公布时的写入与拒绝', () => {
  const event = ranked();
  const proposal = candidate(event, 1);
  const adjusted = swapPairingSlots(proposal.pairs, { matchIndex: 0, side: 'away' }, { matchIndex: 1, side: 'away' });

  it('写入调整后的对阵与修订说明，且数据通过校验', () => {
    const published = publishRound(event, 1, proposal, { pairs: adjusted, note: '某队机器人故障，经裁判组同意交换对手' });
    expect(published.ok, published.messages.join('；')).toBe(true);
    const round = published.event.swiss.rounds.find((r) => r.index === 1)!;
    expect(round.revisionNote).toBe('某队机器人故障，经裁判组同意交换对手');
    expect(round.pairingVersion).toBe(1);
    expect(published.messages.join(' ')).toContain('人工调整');

    const matches = published.event.swiss.matches.filter((m) => m.roundIndex === 1);
    expect(matches.map((m) => m.participantSnapshot)).toEqual(adjusted.map((p) => [p.homeTeamId, p.awayTeamId]));
    // 每支队伍仍然恰好出场一次：微调不该改变参赛名单。
    const seen = matches.flatMap((m) => m.participantSnapshot!);
    expect(new Set(seen).size).toBe(16);
    expect(seen).toHaveLength(16);
    // 时间槽与场次编号不因换对手而改变。
    expect(matches.map((m) => m.scheduleItemId)).toEqual(
      event.swiss.matches.filter((m) => m.roundIndex === 1).map((m) => m.scheduleItemId),
    );
    expect(validateEvent(published.event).errors).toEqual([]);
  });

  it('调整了却没写原因：拒绝写入', () => {
    const published = publishRound(event, 1, proposal, { pairs: adjusted, note: '   ' });
    expect(published.ok).toBe(false);
    expect(published.messages.join(' ')).toContain('必须写明原因');
    expect(published.event).toBe(event);
  });

  it('调整后结构不完整：拒绝写入', () => {
    const published = publishRound(event, 1, proposal, { pairs: proposal.pairs.slice(0, 7), note: '少一场' });
    expect(published.ok).toBe(false);
    expect(published.messages.join(' ')).toContain('不完整');
    expect(published.event).toBe(event);
  });

  it('未调整时仍按自动配对写入，且不留下修订说明', () => {
    const published = publishRound(event, 1, proposal);
    expect(published.ok).toBe(true);
    const round = published.event.swiss.rounds.find((r) => r.index === 1)!;
    expect(round.revisionNote).toBeNull();
    expect(published.event.swiss.matches.filter((m) => m.roundIndex === 1).map((m) => m.participantSnapshot))
      .toEqual(proposal.pairs.map((p) => [p.homeTeamId, p.awayTeamId]));
  });

  it('自动配对本身有问题时，原样公布被拒绝，但人工调整后可以公布', () => {
    const broken: PairingProposal = { ...proposal, compositionIssues: ['1-0 组有 3 支仍在比赛中的队伍，人数为奇数'] };
    const denied = publishRound(event, 1, broken);
    expect(denied.ok).toBe(false);
    expect(denied.messages.join(' ')).toContain('需要人工处理');
    const fixed = publishRound(event, 1, broken, { pairs: adjusted, note: '奇数组成员的处置见裁判记录' });
    expect(fixed.ok, fixed.messages.join('；')).toBe(true);
  });

  it('轮次门禁的阻断不能被微调绕过', () => {
    const gated: PairingProposal = { ...proposal, blockers: ['第 0 轮尚未结束'] };
    const denied = publishRound(event, 1, gated, { pairs: adjusted, note: '强行公布' });
    expect(denied.ok).toBe(false);
    expect(denied.messages.join(' ')).toContain('轮次门禁未通过');
  });

  it('已开赛的轮次不能再重新公布（微调也不行）', () => {
    const published = publishRound(event, 1, proposal).event;
    const first = published.swiss.matches.find((m) => m.roundIndex === 1)!;
    const played = applyBo1Entry(published, {
      matchId: first.id, homeScore: '16', awayScore: '6', homeSeconds: '90', awaySeconds: '160',
      winnerId: first.participantSnapshot![0], resultKind: 'normal', note: null,
    }).event;
    const denied = publishRound(played, 1, proposal, { pairs: swapPairingSlots(proposal.pairs, { matchIndex: 2, side: 'away' }, { matchIndex: 3, side: 'away' }), note: '换一下' });
    expect(denied.ok).toBe(false);
    expect(denied.messages.join(' ')).toContain('已经开赛');
    expect(denied.event).toBe(played);
  });
});

describe('已公布对阵的回读（编辑器起点）', () => {
  it('未公布的轮次返回 null；公布后返回对阵、说明与版本号', () => {
    const event = ranked();
    const proposal = candidate(event, 1);
    expect(publishedRoundPairs(event, 1)).toBeNull();

    const adjusted = swapPairingSlots(proposal.pairs, { matchIndex: 0, side: 'away' }, { matchIndex: 1, side: 'away' });
    const first = publishRound(event, 1, proposal, { pairs: adjusted, note: '第一次调整' }).event;
    const read = publishedRoundPairs(first, 1);
    expect(read?.version).toBe(1);
    expect(read?.note).toBe('第一次调整');
    expect(read?.pairs.map((p) => [p.homeTeamId, p.awayTeamId])).toEqual(adjusted.map((p) => [p.homeTeamId, p.awayTeamId]));

    // 再次调整：版本号递增，说明被新的原因替换（旧原因的追问入口是提交历史）。
    const again = swapPairingSlots(read!.pairs, { matchIndex: 2, side: 'away' }, { matchIndex: 3, side: 'away' });
    const second = publishRound(first, 1, proposal, { pairs: again, note: '第二次调整' }).event;
    expect(publishedRoundPairs(second, 1)?.version).toBe(2);
    expect(publishedRoundPairs(second, 1)?.note).toBe('第二次调整');
    expect(validateEvent(second).warnings.map((w) => w.code)).not.toContain('republished-without-note');
  });
});
