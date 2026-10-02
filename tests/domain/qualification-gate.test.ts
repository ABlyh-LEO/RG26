/**
 * 排位赛定榜门禁测试。
 *
 * 背景（用户报告）：**确认一组成绩后，系统就自动认定排名有效，并断言
 * 一些队伍晋级、一些队伍淘汰**。根因是"确认单条成绩 → 隐式定榜"。
 *
 * 这里守住三件事：
 * 1. 任何一次成绩录入都**不能**改变正式名次；
 * 2. 成绩不完整时**不能**自动定榜；
 * 3. 正式名次不成立时，R1 配对与发布校验都必须拦住。
 *
 * 同时守住观众端的实时排行：允许展示，但必须能被识别为"未确认"。
 */
import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema, type EventFile } from '../../src/domain/schema';
import { validateEvent } from '../../src/domain/validation';
import { liveQualificationRanking } from '../../src/domain/qualification-ranking';
import {
  assessQualificationCompleteness,
  officialQualificationRanking,
} from '../../src/domain/qualification-completeness';
import {
  applyQualificationRanking,
  applyQualificationRun,
  confirmQualificationRanking,
  confirmQualificationRuns,
  generateNextRound,
} from '../../src/operator/draft';
import { proposeResult, type ResultInput, type ResultTarget } from '../../src/operator/result-edit';

const BASE = eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));
const COMPETITIVE = BASE.teams.filter((t) => t.division === 'competitive');

/** 录入某队某一轮的成绩（走真实的录入路径）。 */
function play(event: EventFile, teamId: string, round: 1 | 2, score: string, elapsed = '60'): EventFile {
  const run = event.qualification.runs.find((r) => r.teamId === teamId && r.round === round)!;
  const result = applyQualificationRun(event, {
    runId: run.id, rawResult: `${score} 分`, score, elapsedSeconds: elapsed, judgeNote: null, confirm: true,
  });
  if (!result.ok) throw new Error(result.messages.join('；'));
  return result.event;
}

/** 全部 22 支队伍各录两轮，积分互不相同（30、29、…、9）。 */
function playEveryone(event: EventFile): EventFile {
  COMPETITIVE.forEach((team, index) => {
    const score = String(30 - index);
    event = play(event, team.id, 1, score);
    event = play(event, team.id, 2, score);
  });
  return event;
}

const qualForm = (extra: Partial<ResultInput> = {}): ResultInput => ({
  homeScore: '16', awayScore: '', homeSeconds: '90', awaySeconds: '', winnerId: null,
  resultKind: 'normal', note: '', rawResult: '完成', operation: 'entry', reason: '',
  disposition: 'pending', dispositionNote: '', ...extra,
});

/** 手工构造"已确认但成绩不完整"的排名（模拟历史草稿或人工改数据）。 */
function forceConfirmed(event: EventFile, sourceNote: string | null): EventFile {
  const order = COMPETITIVE.map((t) => t.id);
  return {
    ...event,
    qualification: {
      ...event.qualification,
      ranking: { ...event.qualification.ranking, status: 'confirmed', orderedTeamIds: order, sourceNote },
    },
  };
}

describe('成绩录入绝不隐式定榜', () => {
  it('确认单条跑图后，正式名次仍为空，只有实时排行有数据', () => {
    const event = play(BASE, COMPETITIVE[0]!.id, 1, '20');

    expect(event.qualification.ranking.status).toBe('none');
    expect(event.qualification.ranking.orderedTeamIds).toEqual([]);
    expect(officialQualificationRanking(event).official).toBe(false);

    const live = liveQualificationRanking(event);
    expect(live.hasAnyScore).toBe(true);
    expect(live.scoredRunCount).toBe(1);
    expect(live.entries).toHaveLength(22);
    expect(live.entries[0]!.teamId).toBe(COMPETITIVE[0]!.id);
    expect(live.entries[0]!.incomplete).toBe(false);
    expect(live.entries[1]!.incomplete).toBe(true);
  });

  it('经工作台"保存并确认结果"录入后，仍不会定榜（这正是历史缺陷的入口）', () => {
    const run = BASE.qualification.runs[0]!;
    const target: ResultTarget = { kind: 'qualification', id: run.id, gameIndex: 1 };
    const proposal = proposeResult(BASE, target, qualForm({ homeScore: '16', homeSeconds: '88' }));

    expect(proposal.ok).toBe(true);
    expect(proposal.event.qualification.ranking.status).toBe('none');
    expect(proposal.event.qualification.ranking.orderedTeamIds).toEqual([]);
    // 提示必须说清"尚未定榜"，而不是让人以为名次已经生效。
    expect(proposal.messages.join(' ')).toContain('尚未定榜');
  });
});

describe('成绩不完整时不能定榜', () => {
  it('缺一支队伍的成绩就拒绝，并指出缺谁', () => {
    const missing = COMPETITIVE[COMPETITIVE.length - 1]!;
    let event = BASE;
    for (const team of COMPETITIVE.slice(0, -1)) {
      event = play(event, team.id, 1, '20');
      event = play(event, team.id, 2, '20');
    }

    const completeness = assessQualificationCompleteness(event);
    expect(completeness.ok).toBe(false);
    expect(completeness.missingTeamIds).toEqual([missing.id]);

    const result = confirmQualificationRanking(event);
    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain('成绩不完整');
    expect(result.messages.join(' ')).toContain(missing.name);
    expect(result.event.qualification.ranking.status).toBe('none');
  });

  it('只录到一轮不算缺失，但会被列出来要求复核', () => {
    let event = BASE;
    for (const team of COMPETITIVE) event = play(event, team.id, 1, '20');
    const completeness = assessQualificationCompleteness(event);
    expect(completeness.ok).toBe(true);
    expect(completeness.partialTeamIds).toHaveLength(22);

    const result = confirmQualificationRanking(event);
    expect(result.ok).toBe(true);
    expect(result.messages.join(' ')).toContain('只录到一轮');
  });

  it('成绩完整后可以定榜，名次覆盖全部 22 支队伍', () => {
    const event = playEveryone(BASE);
    const result = confirmQualificationRanking(event);
    expect(result.ok).toBe(true);
    expect(result.event.qualification.ranking.status).toBe('confirmed');
    expect(result.event.qualification.ranking.orderedTeamIds).toHaveLength(22);
    expect(assessQualificationCompleteness(result.event).missingTeamIds).toEqual([]);
    expect(officialQualificationRanking(result.event).official).toBe(true);
  });

  it('并列会被列出并要求人工复核，但不阻断写入', () => {
    let event = BASE;
    COMPETITIVE.forEach((team, index) => {
      const score = index < 2 ? '20' : String(100 - index);
      event = play(event, team.id, 1, score);
      event = play(event, team.id, 2, score);
    });

    const result = confirmQualificationRanking(event);
    expect(result.ok).toBe(true);
    expect(result.messages.join(' ')).toContain('并列');
    expect(assessQualificationCompleteness(result.event).tiedTeamIds.length).toBeGreaterThan(0);
  });
});

describe('正式名次不成立时不能推进赛程', () => {
  it('成绩不完整且未人工定榜 → R1 被阻断', () => {
    const event = forceConfirmed(play(BASE, COMPETITIVE[0]!.id, 1, '20'), null);
    const next = generateNextRound(event, 1);
    expect(next.ok).toBe(false);
    expect(next.messages.join(' ')).toContain('正式名次尚未成立');
    expect(next.messages.join(' ')).toContain('成绩不完整');
  });

  it('人工登记名次（有来源说明）可以推进 —— 组委会核分表是合法输入', () => {
    const played = play(BASE, COMPETITIVE[0]!.id, 1, '20');
    const order = COMPETITIVE.map((t) => t.id);
    const manual = applyQualificationRanking(played, order, '裁判组核分表');
    expect(manual.ok).toBe(true);
    expect(manual.messages.join(' ')).toContain('成绩尚不完整');
    expect(officialQualificationRanking(manual.event).overridden).toBe(true);
    expect(generateNextRound(manual.event, 1).ok).toBe(true);
  });

  it('人工定榜在成绩不完整时必须有来源说明', () => {
    const played = play(BASE, COMPETITIVE[0]!.id, 1, '20');
    const order = COMPETITIVE.map((t) => t.id);
    const denied = applyQualificationRanking(played, order, null);
    expect(denied.ok).toBe(false);
    expect(denied.messages.join(' ')).toContain('来源说明');
  });
});

describe('发布校验拦住"已确认但不完整"的排名', () => {
  it('无来源说明时产出 ranking-confirmed-incomplete 错误', () => {
    const event = forceConfirmed(play(BASE, COMPETITIVE[0]!.id, 1, '20'), null);
    const codes = validateEvent(event).errors.map((e) => e.code);
    expect(codes).toContain('ranking-confirmed-incomplete');
  });

  it('有来源说明时不再是错误（人工定榜是允许的）', () => {
    const event = forceConfirmed(play(BASE, COMPETITIVE[0]!.id, 1, '20'), '裁判组核分表');
    const codes = validateEvent(event).errors.map((e) => e.code);
    expect(codes).not.toContain('ranking-confirmed-incomplete');
  });
});

describe('定榜留下可审计的复核记录', () => {
  it('自动定榜写入完整性名单与复核说明，且不写豁免原因', () => {
    let event = BASE;
    for (const team of COMPETITIVE) event = play(event, team.id, 1, '20');

    const result = confirmQualificationRanking(event, { reviewNote: '只录到一轮，已电话确认' });
    expect(result.ok).toBe(true);
    const ranking = result.event.qualification.ranking;
    expect(ranking.partialTeamIds).toHaveLength(22);
    expect(ranking.missingTeamIds).toEqual([]);
    expect(ranking.reviewNote).toBe('只录到一轮，已电话确认');
    expect(ranking.overrideReason).toBeNull();
    expect(officialQualificationRanking(result.event).review.reviewNote).toBe('只录到一轮，已电话确认');
  });

  it('并列名单会随名次一起写入数据', () => {
    let event = BASE;
    COMPETITIVE.forEach((team, index) => {
      const score = index < 2 ? '20' : String(100 - index);
      event = play(event, team.id, 1, score);
      event = play(event, team.id, 2, score);
    });

    const result = confirmQualificationRanking(event, { reviewNote: '并列按第 1 轮成绩区分，裁判组签字' });
    expect(result.ok).toBe(true);
    // `tiedTeamIds` 只标记"与**前一名**相同"的那一支（两支队并列 → 1 条）。
    expect(result.event.qualification.ranking.tiedTeamIds).toHaveLength(1);
    expect(assessQualificationCompleteness(result.event).tiedTeamIds).toHaveLength(1);
  });

  it('人工定榜在不完整时写入豁免原因与复核记录', () => {
    const played = play(BASE, COMPETITIVE[0]!.id, 1, '20');
    const order = COMPETITIVE.map((t) => t.id);
    const manual = applyQualificationRanking(played, order, '裁判组核分表');
    expect(manual.ok).toBe(true);

    const ranking = manual.event.qualification.ranking;
    expect(ranking.missingTeamIds).toHaveLength(21);
    expect(ranking.reviewNote).toBe('裁判组核分表');
    expect(ranking.overrideReason).toBe('裁判组核分表');

    const official = officialQualificationRanking(manual.event);
    expect(official.overridden).toBe(true);
    expect(official.overrideReason).toBe('裁判组核分表');
  });

  it('批量确认成绩不会顺手定榜（两条确认路径行为一致）', () => {
    // 先录成"待确认"，再用批量确认入口确认。
    let event = BASE;
    for (const team of COMPETITIVE) {
      const run = event.qualification.runs.find((r) => r.teamId === team.id && r.round === 1)!;
      const recorded = applyQualificationRun(event, {
        runId: run.id, rawResult: '完成', score: '20', elapsedSeconds: '60', judgeNote: null, confirm: false,
      });
      if (!recorded.ok) throw new Error(recorded.messages.join('；'));
      event = recorded.event;
    }

    const confirmed = confirmQualificationRuns(event);
    expect(confirmed.ok).toBe(true);
    expect(confirmed.event.qualification.ranking.status).toBe('none');
    expect(confirmed.event.qualification.ranking.orderedTeamIds).toEqual([]);
  });

  it('旧快照缺少复核字段时仍可解析（向后兼容）', () => {
    const legacy = {
      ...BASE,
      qualification: {
        ...BASE.qualification,
        ranking: {
          orderedTeamIds: [], bestResultLabels: null, status: 'none', confirmedAt: null,
          sourceNote: null, publicationStatus: 'draft', publishedAt: null,
        },
      },
    };
    const parsed = eventFileSchema.parse(legacy);
    expect(parsed.qualification.ranking.overrideReason).toBeNull();
    expect(parsed.qualification.ranking.missingTeamIds).toBeNull();
    expect(parsed.qualification.ranking.reviewNote).toBeNull();
  });
});
