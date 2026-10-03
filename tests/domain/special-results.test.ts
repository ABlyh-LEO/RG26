/**
 * 特殊赛果的处理（规则手册 §3.2.2 / §5.4 / §8.5；赛程手册附一六）。
 *
 * 覆盖三类最容易"看起来能录、其实算错"的情形：
 *
 * 1. **0:0 仍然分胜负**——手册 §3.2.2 S3：「若双方均未能成功搭建，则先成功抓取
 *    方块的一方判胜」。因此 0:0 必须有胜者，且不能被当成"未录入"或平局；
 *    A=0、B=50、P=25、T=360、n=1。
 * 2. **未开赛弃权 / 行政判负中止**——附一六：「双方均不计入 A、B、P、T，胜负及
 *    已登记对阵仍计入战绩和 O」。不得用假 0 分填补。
 * 3. **判负的胜者方向**——手册 §5.4：「"判负"后，本局比赛立刻结束，对手队伍自动
 *    获胜」。系统不知道哪一方被判罚，只能靠裁判选对；这里守住"胜者必须是参赛双方之一"，
 *    并记录"填反了不会被拦截"这一已知限制。
 */
import { describe, expect, it } from 'vitest';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema, type EventFile, type ResultKind, type SwissMatch } from '../../src/domain/schema';
import { validateEvent } from '../../src/domain/validation';
import { calculateSwissStandings } from '../../src/domain/standings';
import {
  applyBo1Entry,
  applyBo3Game,
  applyFinalsBo1,
  applyQualificationRanking,
  generateNextRound,
  publishRound,
  seriesWins,
} from '../../src/operator/draft';

const BASE = eventFileSchema.parse(buildSeedEvent('2026-10-04T08:00:00+08:00'));

/** 排位赛定榜 + 公布 R1，得到 8 场已有参赛快照的瑞士轮比赛。 */
function withR1(): EventFile {
  const order = BASE.teams.filter((t) => t.division === 'competitive').map((t) => t.id);
  const ranked = applyQualificationRanking(BASE, order, '特殊赛果测试');
  if (!ranked.ok) throw new Error(ranked.messages.join('；'));
  const proposal = generateNextRound(ranked.event, 1);
  if (!proposal.ok || !proposal.proposal) throw new Error(proposal.messages.join('；'));
  const published = publishRound(ranked.event, 1, proposal.proposal);
  if (!published.ok) throw new Error(published.messages.join('；'));
  return published.event;
}

const R1 = withR1();
const R1_MATCHES = R1.swiss.matches.filter((m) => m.roundIndex === 1);
const pairOf = (match: SwissMatch): [string, string] => match.participantSnapshot!;
const attemptOf = (event: EventFile, matchId: string) =>
  event.swiss.matches.find((m) => m.id === matchId)!.attempts.at(-1)!;

function play(
  match: SwissMatch,
  kind: ResultKind,
  scores: { home: string; away: string; homeSeconds: string; awaySeconds: string; winner: string | null },
): ReturnType<typeof applyBo1Entry> {
  return applyBo1Entry(R1, {
    matchId: match.id,
    homeScore: scores.home,
    awayScore: scores.away,
    homeSeconds: scores.homeSeconds,
    awaySeconds: scores.awaySeconds,
    winnerId: scores.winner,
    resultKind: kind,
    note: null,
  });
}

describe('0:0 仍然分胜负（手册 §3.2.2 S3）', () => {
  const match = R1_MATCHES[0]!;
  const [home] = pairOf(match);
  const result = play(match, 'normal', { home: '0', away: '0', homeSeconds: '', awaySeconds: '', winner: home });

  it('可以录入，且比分原样保存为 0/0（不补成假分、不当成未录入）', () => {
    expect(result.ok, result.messages.join('；')).toBe(true);
    const attempt = attemptOf(result.event, match.id);
    expect(attempt.homeScore).toBe('0');
    expect(attempt.awayScore).toBe('0');
  });

  it('双方到达时间自动记 360 秒', () => {
    const attempt = attemptOf(result.event, match.id);
    expect(attempt.homeReachedSeconds).toBe('360');
    expect(attempt.awayReachedSeconds).toBe('360');
  });

  it('必须有胜者：不给胜者会被拒绝（不允许平局）', () => {
    const denied = play(match, 'normal', { home: '0', away: '0', homeSeconds: '', awaySeconds: '', winner: null });
    expect(denied.ok).toBe(false);
    expect(denied.messages.join(' ')).toContain('必须指定胜者');
  });

  it('统计口径：A=0、B=50、P=25、T=360、n=1，胜者计 1 胜', () => {
    const standings = calculateSwissStandings(
      pairOf(match),
      result.event.swiss.matches.filter((m) => m.id === match.id),
      result.event.qualification.ranking,
    );
    const winner = standings.byTeam.get(home)!;
    const loser = standings.byTeam.get(pairOf(match)[1])!;
    expect(winner.display.a).toBe('0.00');
    expect(winner.display.b).toBe('50.00');
    expect(winner.display.p).toBe('25.00');
    expect(winner.display.t).toBe('360.00');
    expect(winner.metrics.n).toBe(1);
    expect(winner.wins).toBe(1);
    expect(loser.losses).toBe(1);
  });

  it('整体通过校验（0:0 不会被当成缺分）', () => {
    expect(validateEvent(result.event).errors).toEqual([]);
  });
});

describe('未开赛弃权与行政判负中止（手册附一六）', () => {
  for (const [kind, label] of [['walkover-before-start', '未开赛弃权'], ['administrative-stop', '行政判负中止']] as const) {
    describe(label, () => {
      const match = kind === 'walkover-before-start' ? R1_MATCHES[1]! : R1_MATCHES[2]!;
      const [home, away] = pairOf(match);
      const result = play(match, kind, { home: '', away: '', homeSeconds: '', awaySeconds: '', winner: home });

      it('可以不填积分直接录入', () => {
        expect(result.ok, result.messages.join('；')).toBe(true);
      });

      it('不写入假 0 分、也不伪造到达时间', () => {
        const attempt = attemptOf(result.event, match.id);
        expect(attempt.homeScore).toBeNull();
        expect(attempt.awayScore).toBeNull();
        expect(attempt.homeReachedSeconds).toBeNull();
        expect(attempt.awayReachedSeconds).toBeNull();
      });

      it('即使误填了积分也不会落库（不会伪装成有效比赛）', () => {
        const withScores = play(match, kind, { home: '16', away: '3', homeSeconds: '80', awaySeconds: '150', winner: home });
        const attempt = attemptOf(withScores.event, match.id);
        expect(attempt.homeScore).toBeNull();
        expect(attempt.awayScore).toBeNull();
      });

      it('不计入 A/B/P/T（n=0），但计入战绩、登记对阵与 O', () => {
        const standings = calculateSwissStandings(
          [home, away],
          result.event.swiss.matches.filter((m) => m.id === match.id),
          result.event.qualification.ranking,
        );
        const winner = standings.byTeam.get(home)!;
        const loser = standings.byTeam.get(away)!;
        expect(winner.metrics.n).toBe(0);
        expect(winner.metrics.m).toBe(1);
        expect(winner.wins).toBe(1);
        expect(loser.losses).toBe(1);
        expect(winner.display.a).toBe('0.00');
        expect(winner.display.t).toBe('360.00');
      });

      it('缺胜者会被拒绝', () => {
        const denied = play(match, kind, { home: '', away: '', homeSeconds: '', awaySeconds: '', winner: null });
        expect(denied.ok).toBe(false);
      });

      it('整体通过校验', () => {
        expect(validateEvent(result.event).errors).toEqual([]);
      });
    });
  }

  it('弃权累计的 3 胜同样构成晋级（胜负计入战绩）', () => {
    const team = pairOf(R1_MATCHES[3]!)[0];
    const opponents = [pairOf(R1_MATCHES[3]!)[1], pairOf(R1_MATCHES[4]!)[1], pairOf(R1_MATCHES[5]!)[1]];
    const used = [R1_MATCHES[3]!, R1_MATCHES[4]!, R1_MATCHES[5]!];
    let event: EventFile = {
      ...R1,
      swiss: {
        ...R1.swiss,
        matches: R1.swiss.matches.map((m) => {
          const index = used.findIndex((x) => x.id === m.id);
          return index === -1
            ? m
            : { ...m, participantSnapshot: [team, opponents[index]!] as [string, string], attempts: [], effectiveAttemptId: null };
        }),
      },
    };
    for (const match of used) {
      const applied = applyBo1Entry(event, {
        matchId: match.id, homeScore: '', awayScore: '', homeSeconds: '', awaySeconds: '',
        winnerId: team, resultKind: 'walkover-before-start', note: '对手弃权',
      });
      if (!applied.ok) throw new Error(applied.messages.join('；'));
      event = applied.event;
    }
    const standings = calculateSwissStandings(
      [team, ...opponents],
      event.swiss.matches.filter((m) => used.some((x) => x.id === m.id)),
      event.qualification.ranking,
    );
    const entry = standings.byTeam.get(team)!;
    expect(entry.wins).toBe(3);
    expect(entry.metrics.n).toBe(0);
    /*
     * 这个场景是**人为构造**的：同一支队伍在第 1 轮出场三次，现实不可能出现
     * （一轮之内每队只能出场一次）。校验器因此会报出轮内重复出场 —— 那是正确行为，
     * 不是本用例要检查的内容。这里只确认"除了这个故意的结构问题之外没有别的错误"。
     */
    const errors = validateEvent(event).errors;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((issue) => issue.code === 'duplicate-participant-in-round')).toBe(true);
  });
});

describe('缺分与缺时间的拒绝（不得用假 0 填补）', () => {
  const match = R1_MATCHES[6]!;

  it('有效比赛缺一方积分会被拒绝', () => {
    const denied = play(match, 'normal', { home: '', away: '16', homeSeconds: '', awaySeconds: '90', winner: pairOf(match)[1] });
    expect(denied.ok).toBe(false);
    expect(denied.messages.join(' ')).toContain('必须填写双方积分');
  });

  it('积分不为 0 却缺时间会被拒绝', () => {
    const denied = play(match, 'normal', { home: '16', away: '10', homeSeconds: '', awaySeconds: '', winner: pairOf(match)[0] });
    expect(denied.ok).toBe(false);
    // 断言意图（不锁措辞）：必须要求填写"到达最终积分的时间"
    expect(denied.messages.join(' ')).toContain('必须填写');
    expect(denied.messages.join(' ')).toContain('到达最终积分的时间');
  });

  it('一方 0 分可省时间并自动记 360，另一方保留实际时间', () => {
    const result = play(match, 'normal', { home: '16', away: '0', homeSeconds: '90', awaySeconds: '', winner: pairOf(match)[0] });
    expect(result.ok, result.messages.join('；')).toBe(true);
    const attempt = attemptOf(result.event, match.id);
    expect(attempt.homeReachedSeconds).toBe('90');
    expect(attempt.awayReachedSeconds).toBe('360');
  });
});

describe('决赛与 BO3 小局的同类情形', () => {
  const withSnapshot = (id: string, sides: [string, string]): EventFile => ({
    ...R1,
    finals: {
      ...R1.finals,
      series: R1.finals.series.map((s) => (s.id === id ? { ...s, participantSnapshot: sides } : s)),
    },
  });
  const sides: [string, string] = ['competitive-1', 'competitive-2'];

  it('决赛 BO1：0:0 + 胜者可以录入并通过校验', () => {
    const result = applyFinalsBo1(withSnapshot('F-M1', sides), {
      seriesId: 'F-M1', gameIndex: 1, homeTeamId: sides[0], awayTeamId: sides[1],
      homeScore: '0', awayScore: '0', homeReachedSeconds: '', awayReachedSeconds: '',
      winnerId: sides[1], resultKind: 'normal',
    });
    expect(result.ok, result.messages.join('；')).toBe(true);
    expect(validateEvent(result.event).errors).toEqual([]);
  });

  it('决赛 BO1：弃权可以录入并通过校验', () => {
    const result = applyFinalsBo1(withSnapshot('F-M1', sides), {
      seriesId: 'F-M1', gameIndex: 1, homeTeamId: sides[0], awayTeamId: sides[1],
      homeScore: '', awayScore: '', homeReachedSeconds: '', awayReachedSeconds: '',
      winnerId: sides[1], resultKind: 'walkover-before-start',
    });
    expect(result.ok, result.messages.join('；')).toBe(true);
    expect(validateEvent(result.event).errors).toEqual([]);
  });

  it('BO3 第 1 局 0:0 也计入系列赛比分', () => {
    const result = applyBo3Game(withSnapshot('F-GF', sides), {
      seriesId: 'F-GF', gameIndex: 1, homeTeamId: sides[0], awayTeamId: sides[1],
      homeScore: '0', awayScore: '0', homeReachedSeconds: '', awayReachedSeconds: '',
      winnerId: sides[1], resultKind: 'normal',
    });
    expect(result.ok, result.messages.join('；')).toBe(true);
    const series = result.event.finals.series.find((s) => s.id === 'F-GF')!;
    expect(seriesWins(series).away).toBe(1);
  });

  it('BO3 小局判负可以录入并通过校验', () => {
    const result = applyBo3Game(withSnapshot('F-GF', sides), {
      seriesId: 'F-GF', gameIndex: 1, homeTeamId: sides[0], awayTeamId: sides[1],
      homeScore: '', awayScore: '', homeReachedSeconds: '', awayReachedSeconds: '',
      winnerId: sides[0], resultKind: 'administrative-stop',
    });
    expect(result.ok, result.messages.join('；')).toBe(true);
    expect(validateEvent(result.event).errors).toEqual([]);
  });
});

describe('重赛覆盖弃权：只取最终有效场次（手册附一一）', () => {
  const match = R1_MATCHES[7]!;
  const [home, away] = pairOf(match);

  it('弃权后重赛，历史保留、统计只按重赛计算', () => {
    const first = play(match, 'walkover-before-start', { home: '', away: '', homeSeconds: '', awaySeconds: '', winner: home });
    expect(first.ok).toBe(true);
    const replay = applyBo1Entry(first.event, {
      matchId: match.id, homeScore: '16', awayScore: '9', homeSeconds: '80', awaySeconds: '150',
      winnerId: away, resultKind: 'normal', note: '重赛',
    });
    expect(replay.ok, replay.messages.join('；')).toBe(true);

    const stored = replay.event.swiss.matches.find((m) => m.id === match.id)!;
    expect(stored.attempts).toHaveLength(2);
    expect(stored.effectiveAttemptId).toBe(stored.attempts[1]!.id);

    const standings = calculateSwissStandings(
      [home, away],
      replay.event.swiss.matches.filter((m) => m.id === match.id),
      replay.event.qualification.ranking,
    );
    expect(standings.byTeam.get(away)!.wins).toBe(1);
    expect(standings.byTeam.get(home)!.losses).toBe(1);
    expect(standings.byTeam.get(home)!.metrics.n).toBe(1);
    expect(validateEvent(replay.event).errors).toEqual([]);
  });
});

describe('已知限制（写下来，避免以后误以为已覆盖）', () => {
  it('判负方向无法被系统校验：把被判罚方填成胜者会被接受', () => {
    const match = R1_MATCHES[2]!;
    const [home] = pairOf(match);
    const wrong = play(match, 'administrative-stop', { home: '', away: '', homeSeconds: '', awaySeconds: '', winner: home });
    // 系统只知道"胜者必须是参赛双方之一"，无法知道谁被判罚——只能靠裁判选对。
    expect(wrong.ok).toBe(true);
  });

  it('双方都弃权（无胜者）无法登记，需要组委会口径', () => {
    const match = R1_MATCHES[0]!;
    const denied = play(match, 'walkover-before-start', { home: '', away: '', homeSeconds: '', awaySeconds: '', winner: null });
    expect(denied.ok).toBe(false);
  });
});
