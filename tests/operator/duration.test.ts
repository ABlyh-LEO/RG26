/**
 * 时间录入格式：允许「分:秒」等写法，落库与后续流程一律用秒。
 *
 * 手册要求的时间口径是**秒**（零分局记 360 秒），这里的换算只服务于录入方便，
 * 因此必须验证两件事：① 各种写法都能正确换算；② 无法识别的写法被明确拒绝，
 * 绝不悄悄当成 0（「没填」与「0 秒」是两件事）。
 */
import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema } from '../../src/domain/schema';
import { applyBo1Entry, applyBo3Game, applyQualificationRun, applyFinalsBo1, publishRound, generateNextRound, applyQualificationRanking } from '../../src/operator/draft';
import { proposeResult } from '../../src/operator/result-edit';
import { parseDurationInput } from '../../src/operator/duration';

const secondsOf = (raw: string): string | null => {
  const parsed = parseDurationInput(raw);
  return parsed.ok ? parsed.seconds : null;
};

describe('时间写法换算成秒', () => {
  it('纯秒数（含小数）原样保留', () => {
    expect(secondsOf('288')).toBe('288');
    expect(secondsOf('288.6')).toBe('288.6');
    expect(secondsOf('.5')).toBe('0.5');
    expect(secondsOf(' 300 ')).toBe('300');
  });

  it('「分:秒」写法（含全角冒号、缺一侧）', () => {
    expect(secondsOf('4:48')).toBe('288');
    expect(secondsOf('4：48')).toBe('288');   // 中文输入法的全角冒号
    expect(secondsOf('0:50')).toBe('50');
    expect(secondsOf(':48')).toBe('48');
    expect(secondsOf('4:')).toBe('240');
    expect(secondsOf('4:48.5')).toBe('288.5');
    expect(secondsOf('6:00')).toBe('360');
    expect(secondsOf('4: 48')).toBe('288');   // 中间夹空格
  });

  it('中文写法「4分48秒」「4分」「48秒」', () => {
    expect(secondsOf('4分48秒')).toBe('288');
    expect(secondsOf('4分')).toBe('240');
    expect(secondsOf('48秒')).toBe('48');
    expect(secondsOf('4 分 48 秒')).toBe('288');
    expect(secondsOf('1分30秒')).toBe('90');
  });

  it('无法识别的写法被拒绝，不当作 0', () => {
    for (const raw of ['', '  ', 'abc', '-5', '1:2:3', '4分48秒30', '分', '秒', '4:4:']) {
      const parsed = parseDurationInput(raw);
      expect(parsed.ok, `${JSON.stringify(raw)} 应被拒绝`).toBe(false);
    }
  });
});

describe('落库一律是秒', () => {
  const BASE = eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));
  const withR1 = () => {
    const order = BASE.teams.filter((t) => t.division === 'competitive').map((t) => t.id);
    const ranked = applyQualificationRanking(BASE, order, '时间格式测试');
    const proposal = generateNextRound(ranked.event, 1);
    return publishRound(ranked.event, 1, proposal.proposal!).event;
  };
  const R1 = withR1();
  const match = R1.swiss.matches.find((m) => m.roundIndex === 1)!;
  const [home, away] = match.participantSnapshot!;

  it('瑞士轮 BO1：「4:48」存成 288 秒', () => {
    const applied = applyBo1Entry(R1, {
      matchId: match.id, homeScore: '10', awayScore: '9', homeSeconds: '4:48', awaySeconds: '4：50',
      winnerId: home, resultKind: 'normal', note: null,
    });
    expect(applied.ok, applied.messages.join('；')).toBe(true);
    const attempt = applied.event.swiss.matches.find((m) => m.id === match.id)!.attempts.at(-1)!;
    expect(attempt.homeReachedSeconds).toBe('288');
    expect(attempt.awayReachedSeconds).toBe('290');
  });

  it('零分局仍按 360 秒约定，与写法无关', () => {
    const applied = applyBo1Entry(R1, {
      matchId: match.id, homeScore: '16', awayScore: '0', homeSeconds: '4:48', awaySeconds: '',
      winnerId: home, resultKind: 'normal', note: null,
    });
    expect(applied.ok, applied.messages.join('；')).toBe(true);
    const attempt = applied.event.swiss.matches.find((m) => m.id === match.id)!.attempts.at(-1)!;
    expect(attempt.homeReachedSeconds).toBe('288');
    expect(attempt.awayReachedSeconds).toBe('360');
  });

  it('无法识别的时间给出可读报错，且不写入', () => {
    const applied = applyBo1Entry(R1, {
      matchId: match.id, homeScore: '10', awayScore: '9', homeSeconds: '四分钟', awaySeconds: '4:50',
      winnerId: home, resultKind: 'normal', note: null,
    });
    expect(applied.ok).toBe(false);
    expect(applied.messages.join(' ')).toContain('无法识别');
    expect(applied.messages.join(' ')).toContain('4:48');
  });

  it('决赛 BO1 与 BO3 小局同样接受「分:秒」', () => {
    const sides: [string, string] = [home, away];
    const base = { ...R1, finals: { ...R1.finals, series: R1.finals.series.map((s) => (s.id === 'F-M1' || s.id === 'F-GF' ? { ...s, participantSnapshot: sides } : s)) } };
    const bo1 = applyFinalsBo1(base, {
      seriesId: 'F-M1', gameIndex: 1, homeTeamId: sides[0], awayTeamId: sides[1],
      homeScore: '16', awayScore: '10', homeReachedSeconds: '2:01', awayReachedSeconds: '3分53秒',
      winnerId: sides[0], resultKind: 'normal',
    });
    expect(bo1.ok, bo1.messages.join('；')).toBe(true);
    const game = bo1.event.finals.series.find((s) => s.id === 'F-M1')!.games[0]!;
    expect(game.homeReachedSeconds).toBe('121');
    expect(game.awayReachedSeconds).toBe('233');

    const bo3 = applyBo3Game(base, {
      seriesId: 'F-GF', gameIndex: 1, homeTeamId: sides[0], awayTeamId: sides[1],
      homeScore: '16', awayScore: '10', homeReachedSeconds: '1:30', awayReachedSeconds: '4:48',
      winnerId: sides[0], resultKind: 'normal',
    });
    expect(bo3.ok, bo3.messages.join('；')).toBe(true);
    expect(bo3.event.finals.series.find((s) => s.id === 'F-GF')!.games[0]!.awayReachedSeconds).toBe('288');
  });

  it('排位赛跑图用时同样换算（可留空）', () => {
    const run = BASE.qualification.runs[0]!;
    const applied = applyQualificationRun(BASE, {
      runId: run.id, rawResult: '完成', score: '7', elapsedSeconds: '4:48', judgeNote: null, confirm: true,
    });
    expect(applied.ok, applied.messages.join('；')).toBe(true);
    expect(applied.event.qualification.runs[0]!.elapsedSeconds).toBe('288');

    const empty = applyQualificationRun(BASE, {
      runId: run.id, rawResult: '完成', score: '7', elapsedSeconds: '', judgeNote: null, confirm: true,
    });
    expect(empty.ok).toBe(true);
    expect(empty.event.qualification.runs[0]!.elapsedSeconds).toBeNull();
  });
});

describe('提交前校验接受「分:秒」', () => {
  const BASE = eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));
  const order = BASE.teams.filter((t) => t.division === 'competitive').map((t) => t.id);
  const ranked = applyQualificationRanking(BASE, order, '提交校验测试').event;
  const proposal = generateNextRound(ranked, 1);
  const R1 = publishRound(ranked, 1, proposal.proposal!).event;
  const match = R1.swiss.matches.find((m) => m.roundIndex === 1)!;
  const [home] = match.participantSnapshot!;

  const input = (over: Partial<Parameters<typeof proposeResult>[2]>) => ({
    homeScore: '16', awayScore: '10', homeSeconds: '4:48', awaySeconds: '5:12',
    winnerId: home, resultKind: 'normal' as const, note: '', operation: 'entry' as const, reason: '', disposition: 'pending' as const, dispositionNote: '',
    rawResult: '', ...over,
  });

  it('「4:48」不再被当成非法用时', () => {
    const result = proposeResult(R1, { kind: 'swiss', id: match.id, gameIndex: 1 }, input({}));
    expect(result.ok, JSON.stringify(result.fields)).toBe(true);
    const attempt = result.event.swiss.matches.find((m) => m.id === match.id)!.attempts.at(-1)!;
    expect(attempt.homeReachedSeconds).toBe('288');
    expect(attempt.awayReachedSeconds).toBe('312');
  });

  it('无法识别的写法给出带示例的提示', () => {
    const result = proposeResult(R1, { kind: 'swiss', id: match.id, gameIndex: 1 }, input({ homeSeconds: '四分钟' }));
    expect(result.ok).toBe(false);
    expect(result.fields.homeSeconds).toContain('无法识别');
    expect(result.fields.homeSeconds).toContain('4:48');
  });

  it('排位赛用时同样接受「分:秒」', () => {
    const run = R1.qualification.runs[0]!;
    const result = proposeResult(R1, { kind: 'qualification', id: run.id, gameIndex: 1 }, input({ homeScore: '20', homeSeconds: '4:48' }));
    expect(result.ok, JSON.stringify(result.fields)).toBe(true);
    expect(result.event.qualification.runs[0]!.elapsedSeconds).toBe('288');
  });
});
