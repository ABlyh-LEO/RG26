/**
 * 全赛季鲁棒性演练（脚本，非单元测试）。
 *
 * 目的：把**真实链路**从零跑到冠军，并在过程中施加各种异常与边界，
 * 确认系统不崩溃、不静默出错、不发明规则。
 *
 * 为什么需要它：现有 `check:integration` 只走到 R4 就停了，
 * 决赛（种子 → BO1 → BO3 → 冠军）、完整 5 轮、以及全部异常路径
 * 都没有端到端覆盖。
 *
 * 覆盖：
 *  A. 快乐路径：排位赛（44 次跑图）→ R1..R5 → 种子 → 决赛 10 场 → 冠军
 *  B. 异常结果类型：提前结束 / 未开赛弃权 / 行政判负中止
 *  C. 重赛（attempt 追加，旧记录保留但不计入）
 *  D. 更正已确认成绩
 *  E. 边界：并列、只录一轮、未确认成绩、奇数战绩组、种子前置条件、BO3 提前结束、输入校验
 *  F. 回放确定性：同样输入 → 同样输出
 */
import { eventFileSchema, type EventFile } from '../src/domain/schema';
import { validateEvent } from '../src/domain/validation';
import { calculateSwissStandings } from '../src/domain/standings';
import { resolveFinals } from '../src/domain/finals';
import { computeQualificationRanking } from '../src/domain/qualification-ranking';
import {
  sideOfTeamInSeriesGame,
  sidesForFinals,
  sidesForSeriesGame,
  swissSidesOf,
} from '../src/domain/sides';
import {
  applyBo1Entry,
  applyBo3Game,
  applyFinalsBo1,
  applyQualificationAutoRanking,
  applyQualificationRanking,
  applyQualificationRun,
  confirmRound,
  generateNextRound,
  preflight,
  publishFinalsSeeding,
  publishRound,
  seriesWins,
} from '../src/operator/draft';
import { buildSeedEvent } from './seed-data';

/* ------------------------------------------------------------------ *
 * 断言工具
 * ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function section(title: string): void {
  console.log(`\n${'='.repeat(64)}\n${title}\n${'='.repeat(64)}`);
}

function check(label: string, cond: boolean, extra = ''): boolean {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}${extra ? `  [${extra}]` : ''}`);
  } else {
    failures.push(`${label}${extra ? ` — ${extra}` : ''}`);
    console.log(`  ✗ ${label}${extra ? `  [${extra}]` : ''}`);
  }
  return cond;
}

function must(label: string, cond: boolean, extra = ''): void {
  if (!check(label, cond, extra)) {
    console.error(`\n致命失败，终止：${label}`);
    report();
    process.exit(1);
  }
}

function report(): void {
  console.log(`\n${'='.repeat(64)}`);
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    console.log('\n失败清单：');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }
  console.log('='.repeat(64));
}

/* ------------------------------------------------------------------ *
 * 通用推进器
 * ------------------------------------------------------------------ */

const SEED_TIME = '2026-10-03T08:00:00+08:00';

function loadEvent(): EventFile {
  const parsed = eventFileSchema.safeParse(buildSeedEvent(SEED_TIME));
  if (!parsed.success) {
    console.error('种子数据不符合 schema');
    process.exit(1);
  }
  return parsed.data;
}

/** 解析决赛（签名：系列赛列表 + 种子）。 */
function resolve(ev: EventFile) {
  return resolveFinals(ev.finals.series, ev.finals.seeding);
}

/**
 * 取得某系列赛已解析出的参赛双方。
 *
 * `SeriesResolution` 的字段是 `slots: [SlotResolution, SlotResolution]`，
 * 每个 slot 是 resolved / pending / conflict 三态联合，
 * **没有**现成的 `participants` 数组。未解析出来时返回 null。
 */
function participantsOf(ev: EventFile, seriesId: string): [string, string] | null {
  const slot = resolve(ev).series.get(seriesId)?.slots;
  if (!slot) return null;
  const a = slot[0];
  const b = slot[1];
  if (a?.state !== 'resolved' || b?.state !== 'resolved') return null;
  return [a.teamId, b.teamId];
}

/** 同 participantsOf，但未就绪时直接抛错（演练里属于硬失败）。 */
function requireParticipants(ev: EventFile, seriesId: string): [string, string] {
  const p = participantsOf(ev, seriesId);
  if (!p) {
    const r = resolve(ev).series.get(seriesId);
    throw new Error(
      `${seriesId} 参赛双方未就绪：${JSON.stringify(r?.slots ?? null)}`,
    );
  }
  return p;
}

/**
 * 录入完整的排位赛两轮成绩（44 次跑图）。
 *
 * 名次越高（i 越小）积分越高、用时越短，从而产生确定的排位顺序
 * （用于后续首尾配对与种子推演）。
 */
function playQualification(
  base: EventFile,
  opts: {
    tieFirstTwo?: boolean;
    onlyOneRoundFor?: string | null;
    unconfirmedFor?: string | null;
  } = {},
): EventFile {
  const ids = base.teams.filter((t) => t.division === 'competitive').map((t) => t.id);
  let cur = base;
  ids.forEach((teamId, i) => {
    const score = opts.tieFirstTwo && i < 2 ? '90' : String(100 - i);
    const elapsed = opts.tieFirstTwo && i < 2 ? '30' : String(20 + i);
    for (const round of [1, 2] as const) {
      // 只录一轮：跳过第 2 轮（而不是跳过整支队伍）
      if (opts.onlyOneRoundFor === teamId && round === 2) continue;
      const run = cur.qualification.runs.find((r) => r.teamId === teamId && r.round === round);
      if (!run) continue;
      const confirm = opts.unconfirmedFor === teamId ? false : true;
      const res = applyQualificationRun(cur, {
        runId: run.id,
        rawResult: null as unknown as string,
        score,
        elapsedSeconds: elapsed,
        judgeNote: null,
        confirm,
      });
      if (!res.ok) throw new Error(`排位赛 ${teamId} R${round} 录入失败：${res.messages.join('；')}`);
      cur = res.event;
    }
  });
  return applyQualificationAutoRanking(cur).event;
}

/** 录入一场 BO1（默认主队胜，16:4）。 */
function playBo1(
  event: EventFile,
  matchId: string,
  opts: {
    homeScore?: string;
    awayScore?: string;
    homeSeconds?: string;
    awaySeconds?: string;
    winner?: 'home' | 'away';
    kind?: 'normal' | 'early-end' | 'walkover-before-start' | 'administrative-stop';
    note?: string | null;
  } = {},
): EventFile {
  const match = event.swiss.matches.find((m) => m.id === matchId);
  if (!match?.participantSnapshot) throw new Error(`${matchId} 无参赛双方`);
  const [home, away] = match.participantSnapshot;
  const kind = opts.kind ?? 'normal';
  const performance = kind === 'normal' || kind === 'early-end';
  const result = applyBo1Entry(event, {
    matchId,
    // 非有效比赛不计表现分：留空而不是伪造 0 分
    homeScore: performance ? (opts.homeScore ?? '16') : '',
    awayScore: performance ? (opts.awayScore ?? '4') : '',
    homeSeconds: performance ? (opts.homeSeconds ?? '95') : '',
    awaySeconds: performance ? (opts.awaySeconds ?? '140') : '',
    winnerId: opts.winner === 'away' ? away : home,
    resultKind: kind,
    note: opts.note ?? null,
  });
  if (!result.ok) throw new Error(`录入 ${matchId} 失败：${result.messages.join('；')}`);
  return result.event;
}

/** 完成并确认一轮。 */
function finishRound(event: EventFile, roundIndex: number): EventFile {
  const round = event.swiss.rounds.find((r) => r.index === roundIndex);
  if (!round) throw new Error(`找不到 R${roundIndex}`);
  let next = event;
  for (const matchId of round.matchIds) {
    const m = next.swiss.matches.find((x) => x.id === matchId);
    if (!m) throw new Error(`找不到比赛 ${matchId}`);
    const already = m.attempts.some((a) => a.id === m.effectiveAttemptId && a.resultStatus === 'confirmed');
    if (already) continue;
    next = playBo1(next, matchId);
  }
  const confirmed = confirmRound(next, roundIndex);
  if (!confirmed.ok) throw new Error(`确认 R${roundIndex} 失败：${confirmed.messages.join('；')}`);
  return confirmed.event;
}

/** 生成 + 公布一轮对阵。 */
function publishNextRound(event: EventFile, roundIndex: number): EventFile {
  const gen = generateNextRound(event, roundIndex);
  if (!gen.ok || !gen.proposal) throw new Error(`生成 R${roundIndex} 失败：${gen.messages.join('；')}`);
  const pub = publishRound(event, roundIndex, gen.proposal);
  if (!pub.ok) throw new Error(`公布 R${roundIndex} 失败：${pub.messages.join('；')}`);
  return pub.event;
}

/** 跑完 5 轮瑞士轮。 */
function playFiveRounds(base: EventFile): EventFile {
  let e = base;
  for (let r = 1; r <= 5; r += 1) {
    e = publishNextRound(e, r);
    e = finishRound(e, r);
  }
  return e;
}

/** 录入一场决赛 BO1（gameIndex 1）。 */
function playFinalsBo1(ev: EventFile, seriesId: string, winnerIsHome = true): EventFile {
  const [home, away] = requireParticipants(ev, seriesId);
  const res = applyFinalsBo1(ev, {
    seriesId,
    gameIndex: 1,
    homeTeamId: home,
    awayTeamId: away,
    homeScore: '16',
    awayScore: '5',
    winnerId: winnerIsHome ? home : away,
    resultKind: 'normal',
  });
  if (!res.ok) throw new Error(`${seriesId} 录入失败：${res.messages.join('；')}`);
  return res.event;
}

/** 按依赖顺序录入 8 场决赛 BO1。 */
function playAllFinalsBo1(base: EventFile): EventFile {
  let e = base;
  for (const id of ['F-L1A', 'F-L1B', 'F-W1A', 'F-W1B', 'F-L2A', 'F-L2B', 'F-LSF', 'F-WSF']) {
    e = playFinalsBo1(e, id);
  }
  return e;
}

/** 打一个 BO3（homeWins 表示主方是否直落两局）。 */
function playBo3(ev: EventFile, seriesId: string, homeWins: boolean): EventFile {
  let cur = ev;
  const [home, away] = requireParticipants(cur, seriesId);
  for (const idx of [1, 2]) {
    const series = cur.finals.series.find((x) => x.id === seriesId)!;
    const game = series.games.find((g) => g.index === idx);
    if (!game || game.resultStatus === 'confirmed') continue;
    const res = applyBo3Game(cur, {
      seriesId,
      gameIndex: idx,
      homeTeamId: home,
      awayTeamId: away,
      homeScore: '16',
      awayScore: '6',
      winnerId: homeWins ? home : away,
      resultKind: 'normal',
    });
    if (!res.ok) throw new Error(`${seriesId} 第 ${idx} 局失败：${res.messages.join('；')}`);
    cur = res.event;
  }
  return cur;
}

function assertHealthy(event: EventFile, label: string): void {
  const v = validateEvent(event);
  const pf = preflight(event);
  check(
    `${label}：数据校验通过`,
    v.errors.length === 0 && pf.ok,
    `${v.errors.length} 错误 / ${v.warnings.length} 提示`,
  );
  if (v.errors.length > 0) console.log(`      首个错误：${v.errors[0]?.message}`);
}

const competitiveOf = (e: EventFile) => e.teams.filter((t) => t.division === 'competitive');

/** 系列赛败者：由已确认胜者与参赛双方推出。 */
function loserOfSeries(ev: EventFile, seriesId: string): string | null {
  const res = resolve(ev).series.get(seriesId);
  if (!res || res.winnerId === null) return null;
  const p = participantsOf(ev, seriesId);
  if (!p) return null;
  return res.winnerId === p[0] ? p[1] : p[0];
}

/* ================================================================== *
 * A. 快乐路径：完整赛季
 * ================================================================== */

section('A. 快乐路径：排位赛（44 次跑图）→ 瑞士轮 5 轮 → 种子 → 决赛 10 场 → 冠军');

let event = loadEvent();
must('竞技组 22 队', competitiveOf(event).length === 22, `${competitiveOf(event).length} 队`);
must('排位赛共 44 条跑图记录', event.qualification.runs.length === 44, `${event.qualification.runs.length} 条`);

// --- 排位赛：两轮 44 次跑图，按积分/用时自动重排 ---
event = playQualification(event);
const rank = computeQualificationRanking(event);
check('排位赛 22 队全部有名次', rank.standings.length === 22, `${rank.standings.length} 队`);
check('排位赛名次 1..22 连续', rank.standings.every((s, i) => s.rank === i + 1));
check('排位赛无并列（构造数据互不相同）', rank.tiedTeamIds.length === 0, `${rank.tiedTeamIds.length} 支并列`);
check('排位赛无缺成绩', rank.incompleteTeamIds.length === 0, `${rank.incompleteTeamIds.length} 支缺成绩`);
check('每队都取到两轮成绩', rank.standings.every((s) => s.best?.partial === false));
check(
  '44 条跑图全部已确认',
  event.qualification.runs.every((r) => r.resultStatus === 'confirmed'),
  `${event.qualification.runs.filter((r) => r.resultStatus === 'confirmed').length}/44`,
);
check('前 16 名晋级名单长度正确', event.qualification.ranking.orderedTeamIds.slice(0, 16).length === 16);
assertHealthy(event, '排位赛后');

// --- R1..R5 ---
event = playFiveRounds(event);
const playedSwiss = event.swiss.matches.filter((m) => m.effectiveAttemptId !== null);
check('瑞士轮共 33 场已结算', playedSwiss.length === 33, `${playedSwiss.length} 场`);

const top16 = event.qualification.ranking.orderedTeamIds.slice(0, 16);
const standings = calculateSwissStandings(top16, event.swiss.matches, event.qualification.ranking);
check('排名计算无 issue', standings.issues.length === 0, `${standings.issues.length} 条`);
console.log(`      战绩组：${standings.groups.map((g) => `${g.record}:${g.entries.length}`).join('  ')}`);
check('每组队伍数合计为 16', standings.groups.reduce((n, g) => n + g.entries.length, 0) === 16);
const g30 = standings.groups.find((g) => g.record === '3-0');
check('3-0 组恰好 2 队', g30?.entries.length === 2, `${g30?.entries.length ?? 0} 队`);
check(
  '组内名次从 1 开始连续',
  standings.groups.every((g) => g.entries.every((e, i) => e.rankWithinGroup === i + 1)),
);
assertHealthy(event, 'R5 后');

// --- 八强种子 ---
const seedResult = publishFinalsSeeding(event);
must('公布八强种子成功', seedResult.ok, seedResult.messages.join('；') || '无提示');
event = seedResult.event;
const seeds = event.finals.seeding?.seeds ?? {};
const seedKeys = Object.keys(seeds);
check('种子 W1..W4 + L1..L4 齐全', seedKeys.length === 8, seedKeys.sort().join(','));
check('每个种子都有队伍', seedKeys.every((k) => Boolean(seeds[k as keyof typeof seeds])));
const seedTeamIds = Object.values(seeds).filter(Boolean) as string[];
check('8 个种子互不重复', new Set(seedTeamIds).size === 8, `${new Set(seedTeamIds).size} 个不同`);
check('种子全部来自晋级 16 强', seedTeamIds.every((id) => top16.includes(id)));
const g30Ids = g30?.entries.map((e) => e.teamId) ?? [];
check(
  'W1/W2 来自 3-0 组',
  g30Ids.includes(seeds.W1 as string) && g30Ids.includes(seeds.W2 as string),
  `3-0=${g30Ids.join(',')} W1=${seeds.W1} W2=${seeds.W2}`,
);
assertHealthy(event, '种子公布后');

// --- 决赛 BO1：8 场（第 1..8 场）---
event = playAllFinalsBo1(event);
check(
  '8 场 BO1 决赛全部已录入',
  ['F-L1A', 'F-L1B', 'F-W1A', 'F-W1B', 'F-L2A', 'F-L2B', 'F-LSF', 'F-WSF'].every((id) => {
    const s = event.finals.series.find((x) => x.id === id);
    return s?.games.some((g) => g.resultStatus === 'confirmed') ?? false;
  }),
);
assertHealthy(event, 'BO1 决赛后');

// --- 两个 BO3（第 9、10 场）---
event = playBo3(event, 'F-QUAL', true);
const qualSeries = event.finals.series.find((s) => s.id === 'F-QUAL')!;
const qualWins = seriesWins(qualSeries);
check('F-QUAL 2:0 结束系列赛', qualWins.home === 2 && qualWins.away === 0, `${qualWins.home}:${qualWins.away}`);
check(
  'F-QUAL 第 3 局未被确认（不需要进行）',
  qualSeries.games.filter((g) => g.index === 3).every((g) => g.resultStatus !== 'confirmed'),
);
assertHealthy(event, '名额争夺战后');

event = playBo3(event, 'F-GF', true);
const gfSeries = event.finals.series.find((s) => s.id === 'F-GF')!;
const gfWins = seriesWins(gfSeries);
check('F-GF 2:0 结束系列赛', gfWins.home === 2 && gfWins.away === 0, `${gfWins.home}:${gfWins.away}`);

// --- 冠军与奖项 ---
const finalResolution = resolve(event);
const awards = finalResolution.awards;
check('决赛解析无冲突', finalResolution.conflicts.length === 0, finalResolution.conflicts.join('；'));
console.log(`      冠军=${awards.champion}  亚军=${awards.runnerUp}  季军=${awards.third}`);
check('产生冠军', Boolean(awards.champion), String(awards.champion));
check('产生亚军', Boolean(awards.runnerUp), String(awards.runnerUp));
check('产生季军', Boolean(awards.third), String(awards.third));
check('冠军 ≠ 亚军', awards.champion !== awards.runnerUp);
check('冠军 = F-GF 胜者', awards.champion === gfWins.winnerId);
check('亚军 = F-GF 败者', awards.runnerUp === loserOfSeries(event, 'F-GF'));
check('季军 = F-QUAL 败者', awards.third === loserOfSeries(event, 'F-QUAL'));
check('冠军属于排位前 16', awards.champion !== null && top16.includes(awards.champion));
check('前三名互不相同', new Set([awards.champion, awards.runnerUp, awards.third]).size === 3);
assertHealthy(event, '完整赛季结束后');

/* ================================================================== *
 * B. 异常结果类型
 * ================================================================== */

section('B. 异常结果类型：提前结束 / 未开赛弃权 / 行政判负中止');

{
  let e = playQualification(loadEvent());
  e = publishNextRound(e, 1);
  const ids = e.swiss.rounds.find((r) => r.index === 1)!.matchIds;

  e = playBo1(e, ids[0]!, {
    kind: 'early-end', homeScore: '16', awayScore: '9', homeSeconds: '88', awaySeconds: '150',
  });
  e = playBo1(e, ids[1]!, { kind: 'walkover-before-start' });
  e = playBo1(e, ids[2]!, { kind: 'administrative-stop' });
  for (const id of ids.slice(3)) e = playBo1(e, id);

  const confirmed = confirmRound(e, 1);
  must('含异常类型的 R1 可确认', confirmed.ok, confirmed.messages.join('；') || '无提示');
  e = confirmed.event;

  const s = calculateSwissStandings(
    e.qualification.ranking.orderedTeamIds.slice(0, 16), e.swiss.matches, e.qualification.ranking,
  );
  check('含异常类型时排名仍可计算', s.issues.length === 0, `${s.issues.length} 条 issue`);

  const winnerOf = (matchId: string) => {
    const m = e.swiss.matches.find((x) => x.id === matchId)!;
    return m.attempts.find((a) => a.id === m.effectiveAttemptId)!.winnerId!;
  };

  const woEntry = s.byTeam.get(winnerOf(ids[1]!))!;
  check('弃权获胜方记 1 胜', woEntry.wins === 1, `${woEntry.wins} 胜`);
  check('弃权不计入表现统计 n', woEntry.metrics.n === 0, `n=${woEntry.metrics.n}`);
  check('弃权仍计入 m（登记对阵）', woEntry.metrics.m === 1, `m=${woEntry.metrics.m}`);

  const aoEntry = s.byTeam.get(winnerOf(ids[2]!))!;
  check('行政判负获胜方记 1 胜', aoEntry.wins === 1);
  check('行政判负不计入表现统计 n', aoEntry.metrics.n === 0, `n=${aoEntry.metrics.n}`);

  const eeEntry = s.byTeam.get(winnerOf(ids[0]!))!;
  check('提前结束计入表现统计 n', eeEntry.metrics.n === 1, `n=${eeEntry.metrics.n}`);

  check(
    '异常类型场次仍产生战绩组',
    ['1-0', '0-1'].every((rec) => s.groups.some((g) => g.record === rec)),
    s.groups.map((g) => g.record).join(','),
  );
  assertHealthy(e, '异常结果类型后');
}

/* ================================================================== *
 * C. 重赛
 * ================================================================== */

section('C. 重赛：追加 attempt，旧记录保留但不计入');

{
  let e = playQualification(loadEvent());
  e = publishNextRound(e, 1);
  const target = e.swiss.rounds.find((r) => r.index === 1)!.matchIds[0]!;

  e = playBo1(e, target, { homeScore: '16', awayScore: '4', winner: 'home' });
  const before = e.swiss.matches.find((m) => m.id === target)!;
  check('首次录入产生 1 个 attempt', before.attempts.length === 1, `${before.attempts.length}`);
  const firstAttemptId = before.effectiveAttemptId;

  e = playBo1(e, target, {
    homeScore: '3', awayScore: '16', homeSeconds: '180', awaySeconds: '90', winner: 'away',
  });
  const after = e.swiss.matches.find((m) => m.id === target)!;
  check('重赛产生第 2 个 attempt', after.attempts.length === 2, `${after.attempts.length}`);
  check('旧记录被保留（未删除）', after.attempts.some((a) => a.id === firstAttemptId));
  check('effectiveAttemptId 指向新记录', after.effectiveAttemptId !== firstAttemptId);
  const newAttempt = after.attempts.find((a) => a.id === after.effectiveAttemptId)!;
  check('新记录 supersedesId 指向旧记录', newAttempt.supersedesId === firstAttemptId);

  const s = calculateSwissStandings(
    e.qualification.ranking.orderedTeamIds.slice(0, 16), e.swiss.matches, e.qualification.ranking,
  );
  const [, awayId] = after.participantSnapshot!;
  check('统计只计新记录（客队获胜）', s.byTeam.get(awayId)!.wins === 1, `客队 ${s.byTeam.get(awayId)!.wins} 胜`);
  check('重赛后无 issue', s.issues.length === 0, `${s.issues.length}`);
  check('重赛不重复计数（m 仍为 1）', s.byTeam.get(awayId)!.metrics.m === 1, `m=${s.byTeam.get(awayId)!.metrics.m}`);

  for (const id of e.swiss.rounds.find((r) => r.index === 1)!.matchIds) {
    const m = e.swiss.matches.find((x) => x.id === id)!;
    const done = m.attempts.some((a) => a.id === m.effectiveAttemptId && a.resultStatus === 'confirmed');
    if (!done) e = playBo1(e, id);
  }
  const conf = confirmRound(e, 1);
  check('重赛后可确认整轮', conf.ok, conf.messages.join('；') || '无提示');
  assertHealthy(conf.event, '重赛后');
}

/* ================================================================== *
 * D. 更正已确认成绩
 * ================================================================== */

section('D. 更正已确认成绩（录入更正后的结果作为新 attempt）');

{
  let e = playQualification(loadEvent());
  e = publishNextRound(e, 1);
  e = finishRound(e, 1);

  const target = e.swiss.rounds.find((r) => r.index === 1)!.matchIds[0]!;
  const m0 = e.swiss.matches.find((m) => m.id === target)!;
  const [home0] = m0.participantSnapshot!;
  const winner0 = m0.attempts.find((a) => a.id === m0.effectiveAttemptId)!.winnerId!;

  const flipped = winner0 === home0 ? 'away' : 'home';
  e = playBo1(e, target, {
    winner: flipped, homeScore: '7', awayScore: '16', homeSeconds: '170', awaySeconds: '91',
    note: '更正：原记录胜者录错',
  });
  const m1 = e.swiss.matches.find((m) => m.id === target)!;
  const winner1 = m1.attempts.find((a) => a.id === m1.effectiveAttemptId)!.winnerId!;
  check('更正后胜者已翻转', winner1 !== winner0, `${winner0} → ${winner1}`);
  check('更正的 attempt 带说明', m1.attempts.find((a) => a.id === m1.effectiveAttemptId)!.note !== null);
  check('更正保留全部历史 attempt', m1.attempts.length === 2, `${m1.attempts.length}`);

  const s = calculateSwissStandings(
    e.qualification.ranking.orderedTeamIds.slice(0, 16), e.swiss.matches, e.qualification.ranking,
  );
  check(
    '更正后统计反映新胜者',
    s.byTeam.get(winner1)!.wins === 1 && s.byTeam.get(winner0)!.wins === 0,
    `${winner1}=${s.byTeam.get(winner1)!.wins}胜, ${winner0}=${s.byTeam.get(winner0)!.wins}胜`,
  );
  check('更正后仍无 issue', s.issues.length === 0, `${s.issues.length}`);
  assertHealthy(e, '更正后');
}

/* ================================================================== *
 * E. 边界
 * ================================================================== */

section('E. 边界情形');

// E1. 排位赛并列（同分同用时）
{
  const e = playQualification(loadEvent(), { tieFirstTwo: true });
  const r = computeQualificationRanking(e);
  check('E1 检出并列', r.tiedTeamIds.length >= 1, `${r.tiedTeamIds.length} 支并列`);
  const auto = applyQualificationAutoRanking(e);
  check('E1 并列仍可写入（不阻断）', auto.ok);
  check('E1 并列有明确提示', auto.messages.some((m) => m.includes('并列')), auto.messages.join(' / ').slice(0, 120));
  check('E1 名次仍连续', r.standings.every((s, i) => s.rank === i + 1));
  check('E1 并列不丢失队伍', r.standings.length === 22, `${r.standings.length} 队`);
}

// E2. 只录一轮
{
  const first = competitiveOf(loadEvent())[0]!.id;
  const e = playQualification(loadEvent(), { onlyOneRoundFor: first });
  const r = computeQualificationRanking(e);
  check('E2 只录一轮的队伍排在榜首（成绩最好）', r.standings[0]!.teamId === first, r.standings[0]!.teamId);
  check('E2 只录一轮不算 incomplete', !r.incompleteTeamIds.includes(first));
  check('E2 标为 partial', r.partialTeamIds.includes(first));
  const auto = applyQualificationAutoRanking(e);
  check('E2 有 partial 提示', auto.messages.some((m) => m.includes('只录到一轮')), auto.messages.join(' / ').slice(0, 100));
  check('E2 名次仍覆盖 22 队', r.standings.length === 22);
}

// E3. 未确认成绩不参与排名
{
  const first = competitiveOf(loadEvent())[0]!.id;
  const confirmedAll = playQualification(loadEvent());
  const withUnconfirmed = playQualification(loadEvent(), { unconfirmedFor: first });

  const ra = computeQualificationRanking(confirmedAll);
  const rb = computeQualificationRanking(withUnconfirmed);

  // 未确认的记录状态必须是 provisional
  check(
    'E3 未确认记录状态为 provisional',
    withUnconfirmed.qualification.runs
      .filter((r) => r.teamId === first)
      .every((r) => r.resultStatus === 'provisional'),
  );

  // 核心不变量：未确认成绩**不得**被当成有效成绩使用
  const bestB = rb.standings.find((s) => s.teamId === first)!.best;
  check('E3 未确认成绩不被采用（该队无有效最优成绩）', bestB === null || bestB.incomplete === true,
    JSON.stringify(bestB));
  check('E3 该队被列为缺成绩', rb.incompleteTeamIds.includes(first), `incomplete=${rb.incompleteTeamIds.join(',')}`);
  // 缺成绩者沉到有成绩者之后
  const firstRankB = rb.standings.find((s) => s.teamId === first)!.rank;
  const scoredCount = 22 - rb.incompleteTeamIds.length;
  check('E3 缺成绩者排在所有有成绩者之后', firstRankB > scoredCount,
    `名次=${firstRankB}，有成绩者=${scoredCount}`);

  // 其余队伍（成绩都已确认）的相对顺序必须保持不变
  const othersA = ra.standings.filter((s) => s.teamId !== first).map((s) => s.teamId);
  const othersB = rb.standings.filter((s) => s.teamId !== first).map((s) => s.teamId);
  check('E3 其余队伍的相对顺序不受影响', JSON.stringify(othersA) === JSON.stringify(othersB),
    `前 3：${othersB.slice(0, 3).join(',')}`);

  // 名次表必须仍然完整覆盖 22 队且连续
  check('E3 名次仍覆盖 22 队且连续',
    rb.standings.length === 22 && rb.standings.every((s, i) => s.rank === i + 1));
  check('E3 已确认的同队在对比组里正常参与排名',
    !ra.incompleteTeamIds.includes(first) && ra.standings[0]!.teamId === first);
}

// E4. 奇数战绩组（退赛导致）—— 必须阻断而不是静默凑数
{
  let e = playQualification(loadEvent());
  e = publishNextRound(e, 1);
  e = finishRound(e, 1);

  const gen = generateNextRound(e, 2);
  check('E4 正常情况 R2 可生成', gen.ok, gen.messages.join('；').slice(0, 80));

  const lastR1 = e.swiss.rounds.find((r) => r.index === 1)!.matchIds[7]!;
  const e2: EventFile = {
    ...e,
    swiss: {
      ...e.swiss,
      matches: e.swiss.matches.map((m) =>
        m.id === lastR1
          ? { ...m, effectiveAttemptId: null, attempts: [], executionStatus: 'scheduled' as const }
          : m,
      ),
    },
  };
  const blocked = generateNextRound(e2, 2);
  check('E4 奇数战绩组被阻断（不静默凑数）', !blocked.ok, blocked.messages.join(' / ').slice(0, 160) || '（无提示却 ok）');
  if (!blocked.ok) console.log(`      阻断原因：${blocked.messages[0]}`);
  check('E4 阻断时不给出 proposal', blocked.proposal === null || blocked.proposal.blockers.length > 0);
}

// E5. 种子前置条件：R5 未完成时拒绝公布种子
{
  let e = playQualification(loadEvent());
  e = publishNextRound(e, 1);
  e = finishRound(e, 1);
  const tooEarly = publishFinalsSeeding(e);
  check('E5 R5 未完成时拒绝公布种子', !tooEarly.ok, tooEarly.messages.join('；').slice(0, 120) || '（却成功了）');
  check('E5 拒绝原因与轮次相关', tooEarly.messages.some((m) => /第五轮|R5|轮/.test(m)), tooEarly.messages.join('；').slice(0, 120));
}

// E6. BO3 提前结束与打满 3 局
{
  let e = playFiveRounds(playQualification(loadEvent()));
  e = publishFinalsSeeding(e).event;
  e = playAllFinalsBo1(e);

  const qp = requireParticipants(e, 'F-QUAL');
  for (const [idx, winner] of [
    [1, qp[0]],
    [2, qp[1]],
    [3, qp[0]],
  ] as const) {
    const res = applyBo3Game(e, {
      seriesId: 'F-QUAL', gameIndex: idx, homeTeamId: qp[0], awayTeamId: qp[1],
      homeScore: '16', awayScore: '9', winnerId: winner, resultKind: 'normal',
    });
    if (!res.ok) throw new Error(`F-QUAL 第 ${idx} 局失败：${res.messages.join('；')}`);
    e = res.event;
  }
  const qs = e.finals.series.find((s) => s.id === 'F-QUAL')!;
  const qw = seriesWins(qs);
  check('E6 打满 3 局后系列赛有胜者', qw.winnerId !== null, `${qw.home}:${qw.away}`);
  check('E6 三局全部已确认', qs.games.every((g) => g.resultStatus === 'confirmed'));

  const again = applyBo3Game(e, {
    seriesId: 'F-QUAL', gameIndex: 3, homeTeamId: qp[0], awayTeamId: qp[1],
    homeScore: '16', awayScore: '1', winnerId: qp[1], resultKind: 'normal',
  });
  check('E6 已结束的系列赛拒绝继续录入', !again.ok, again.messages.join('；').slice(0, 100) || '（却成功了）');

  const gp = requireParticipants(e, 'F-GF');
  const gf2 = applyBo3Game(e, {
    seriesId: 'F-GF', gameIndex: 1, homeTeamId: gp[0], awayTeamId: gp[1],
    homeScore: '16', awayScore: '4', winnerId: gp[0], resultKind: 'normal',
  });
  const gf3 = applyBo3Game(gf2.event, {
    seriesId: 'F-GF', gameIndex: 2, homeTeamId: gp[0], awayTeamId: gp[1],
    homeScore: '16', awayScore: '4', winnerId: gp[0], resultKind: 'normal',
  });
  check('E6 2:0 后系列赛结束', seriesWins(gf3.event.finals.series.find((s) => s.id === 'F-GF')!).home === 2);
  const gf4 = applyBo3Game(gf3.event, {
    seriesId: 'F-GF', gameIndex: 3, homeTeamId: gp[0], awayTeamId: gp[1],
    homeScore: '16', awayScore: '4', winnerId: gp[0], resultKind: 'normal',
  });
  check('E6 2:0 后第 3 局被拒绝', !gf4.ok, gf4.messages.join('；').slice(0, 100) || '（却成功了）');
  assertHealthy(e, 'E6 后');
}

// E7. 输入校验
{
  let e = playQualification(loadEvent());
  e = publishNextRound(e, 1);
  const mid = e.swiss.rounds.find((r) => r.index === 1)!.matchIds[0]!;
  const mm = e.swiss.matches.find((m) => m.id === mid)!;
  const [h] = mm.participantSnapshot!;

  check(
    'E7 缺胜者被拒绝（瑞士轮不允许平局）',
    !applyBo1Entry(e, {
      matchId: mid, homeScore: '16', awayScore: '4', homeSeconds: '90', awaySeconds: '150',
      winnerId: null, resultKind: 'normal', note: null,
    }).ok,
  );

  check(
    'E7 非参赛方当胜者被拒绝',
    !applyBo1Entry(e, {
      matchId: mid, homeScore: '16', awayScore: '4', homeSeconds: '90', awaySeconds: '150',
      winnerId: 'competitive-999', resultKind: 'normal', note: null,
    }).ok,
  );

  check(
    'E7 有效比赛缺积分被拒绝（缺分≠0）',
    !applyBo1Entry(e, {
      matchId: mid, homeScore: '', awayScore: '', homeSeconds: '', awaySeconds: '',
      winnerId: h, resultKind: 'normal', note: null,
    }).ok,
  );

  check(
    'E7 非零分缺时间被拒绝',
    !applyBo1Entry(e, {
      matchId: mid, homeScore: '16', awayScore: '4', homeSeconds: '', awaySeconds: '',
      winnerId: h, resultKind: 'normal', note: null,
    }).ok,
  );

  check(
    'E7 零分可省略时间（记 360 秒）',
    applyBo1Entry(e, {
      matchId: mid, homeScore: '0', awayScore: '16', homeSeconds: '', awaySeconds: '90',
      winnerId: mm.participantSnapshot![1], resultKind: 'normal', note: null,
    }).ok,
  );

  check(
    'E7 不存在的比赛被拒绝',
    !applyBo1Entry(e, {
      matchId: 'no-such-match', homeScore: '16', awayScore: '4', homeSeconds: '90', awaySeconds: '150',
      winnerId: h, resultKind: 'normal', note: null,
    }).ok,
  );

  check('E7 排名数量不足被拒绝', !applyQualificationRanking(e, ['competitive-1'], null).ok);
  const allIds = competitiveOf(e).map((t) => t.id);
  check(
    'E7 排名重复队伍被拒绝',
    !applyQualificationRanking(e, allIds.map((id, i) => (i === 1 ? allIds[0]! : id)), null).ok,
  );
}

/* ================================================================== *
 * F. 确定性
 * ================================================================== */

section('F. 确定性：同样输入 → 同样输出');

{
  const snapshot = (): string => {
    let f = playFiveRounds(playQualification(loadEvent()));
    f = publishFinalsSeeding(f).event;
    const st = calculateSwissStandings(
      f.qualification.ranking.orderedTeamIds.slice(0, 16), f.swiss.matches, f.qualification.ranking,
    );
    return JSON.stringify({
      groups: st.groups.map((g) => [g.record, g.entries.map((x) => `${x.teamId}:${x.display.r}:${x.display.t}`)]),
      seeds: f.finals.seeding?.seeds,
      qualification: f.qualification.ranking.orderedTeamIds,
    });
  };
  const a = snapshot();
  const b = snapshot();
  check('两次完整赛季（含排位赛）结果完全一致', a === b);
}

/* ================================================================== *
 * G. 红蓝方
 * ================================================================== */

section('G. 红蓝方：自动维护与换边');

{
  // G1. 完整赛季里，每场瑞士轮都有确定的红蓝方
  const e = playFiveRounds(playQualification(loadEvent()));
  const played = e.swiss.matches.filter((m) => m.participantSnapshot !== null);
  let allHaveSides = true;
  let oddRoundOk = true;
  let evenRoundOk = true;
  for (const m of played) {
    const r = swissSidesOf(m);
    if (!r) {
      allHaveSides = false;
      continue;
    }
    const [first, second] = m.participantSnapshot!;
    if (m.roundIndex % 2 === 1) {
      // 奇数轮：第一蓝、第二红
      if (r.blue !== first || r.red !== second) oddRoundOk = false;
    } else {
      // 偶数轮：第一红、第二蓝
      if (r.red !== first || r.blue !== second) evenRoundOk = false;
    }
  }
  check('G1 每场已公布比赛都有确定的红蓝方', allHaveSides, `${played.length} 场`);
  check('G1 奇数轮（R1/R3/R5）第一席位蓝、第二席位红', oddRoundOk);
  check('G1 偶数轮（R2/R4）第一席位红、第二席位蓝', evenRoundOk);

  // G2. 瑞士轮里每场恰好一红一蓝
  const oneEach = played.every((m) => {
    const r = swissSidesOf(m);
    return r !== null && r.blue !== r.red;
  });
  check('G2 每场恰好一红一蓝（不会两队同色）', oneEach);

  // G3. 红蓝方不写入数据（纯派生），因此不存在"忘记维护"的状态
  const anyStoredSide = JSON.stringify(e).includes('"red"') || JSON.stringify(e).includes('"blue"');
  check('G3 红蓝方不落库（由赛程结构派生，无需人工维护）', !anyStoredSide);
}

{
  // G4. 决赛 BO1 不换边
  check('G4 决赛 BO1：第一席位蓝、第二席位红', (() => {
    const s = sidesForSeriesGame(1);
    return s.first === 'blue' && s.second === 'red';
  })());
  check('G4 八强双败不反向', (() => {
    const s = sidesForFinals();
    return s.first === 'blue' && s.second === 'red';
  })());

  // G5. BO3 每局交替
  const g1 = sidesForSeriesGame(1);
  const g2 = sidesForSeriesGame(2);
  const g3 = sidesForSeriesGame(3);
  check('G5 BO3 第 1 局：第一蓝、第二红', g1.first === 'blue' && g1.second === 'red');
  check('G5 BO3 第 2 局换边：第一红、第二蓝', g2.first === 'red' && g2.second === 'blue');
  check('G5 BO3 第 3 局换回：第一蓝、第二红', g3.first === 'blue' && g3.second === 'red');
  check('G5 同一队在 3 局里两种颜色都打过',
    new Set([1, 2, 3].map((i) => sideOfTeamInSeriesGame('A', 'A', 'B', i))).size === 2);
}

{
  // G6. 打满 3 局的 BO3，每局红蓝方都正确
  let e = playFiveRounds(playQualification(loadEvent()));
  e = publishFinalsSeeding(e).event;
  e = playAllFinalsBo1(e);

  const qp = requireParticipants(e, 'F-QUAL');
  for (const [idx, winner] of [
    [1, qp[0]],
    [2, qp[1]],
    [3, qp[0]],
  ] as const) {
    const res = applyBo3Game(e, {
      seriesId: 'F-QUAL', gameIndex: idx, homeTeamId: qp[0], awayTeamId: qp[1],
      homeScore: '16', awayScore: '9',
      homeReachedSeconds: '80', awayReachedSeconds: '120',
      winnerId: winner, resultKind: 'normal',
    });
    if (!res.ok) throw new Error(`F-QUAL 第 ${idx} 局失败：${res.messages.join('；')}`);
    e = res.event;
  }

  const qs = e.finals.series.find((s) => s.id === 'F-QUAL')!;
  check('G6 BO3 三局都记录了到达最终分时间',
    qs.games.every((g) => g.homeReachedSeconds !== null && g.awayReachedSeconds !== null),
    qs.games.map((g) => `${g.index}:${g.homeReachedSeconds}/${g.awayReachedSeconds}`).join(' '));

  // 每局的红蓝方归属（用已确认局的参赛双方）
  const sidePerGame = qs.games.map((g) => {
    if (!g.homeTeamId || !g.awayTeamId) return null;
    return [
      sideOfTeamInSeriesGame(g.homeTeamId, qp[0], qp[1], g.index),
      sideOfTeamInSeriesGame(g.awayTeamId, qp[0], qp[1], g.index),
    ];
  });
  check('G6 第 2 局相对第 1 局换边',
    sidePerGame[0]?.[0] === 'blue' && sidePerGame[1]?.[0] === 'red',
    `第1局 ${sidePerGame[0]?.join('/')}，第2局 ${sidePerGame[1]?.join('/')}`);
  check('G6 第 3 局相对第 2 局换回', sidePerGame[2]?.[0] === 'blue',
    `第3局 ${sidePerGame[2]?.join('/')}`);
}

{
  // G7. 时间字段：必须存下来，且空值不等于 0
  // F-QUAL 的参赛双方依赖上游 8 场 BO1，因此这里跑完整链路再测。
  let ev = playFiveRounds(playQualification(loadEvent()));
  ev = publishFinalsSeeding(ev).event;
  ev = playAllFinalsBo1(ev);
  const p = requireParticipants(ev, 'F-QUAL');

  const missing = applyBo3Game(ev, {
    seriesId: 'F-QUAL', gameIndex: 1, homeTeamId: p[0], awayTeamId: p[1],
    homeScore: '16', awayScore: '9', homeReachedSeconds: '', awayReachedSeconds: '',
    winnerId: p[0], resultKind: 'normal',
  });
  check('G7 时间留空可以保存（记为 null，不是 0）', missing.ok);
  const g = missing.event.finals.series.find((s) => s.id === 'F-QUAL')!.games[0]!;
  check('G7 留空时间为 null 而非 "0"', g.homeReachedSeconds === null && g.awayReachedSeconds === null,
    `${JSON.stringify(g.homeReachedSeconds)}/${JSON.stringify(g.awayReachedSeconds)}`);

  const bad = applyBo3Game(ev, {
    seriesId: 'F-QUAL', gameIndex: 1, homeTeamId: p[0], awayTeamId: p[1],
    homeScore: '16', awayScore: '9', homeReachedSeconds: 'abc', awayReachedSeconds: '10',
    winnerId: p[0], resultKind: 'normal',
  });
  check('G7 非法时间被拒绝', !bad.ok, bad.messages.join('；').slice(0, 80));

  const neg = applyBo3Game(ev, {
    seriesId: 'F-QUAL', gameIndex: 1, homeTeamId: p[0], awayTeamId: p[1],
    homeScore: '16', awayScore: '9', homeReachedSeconds: '-5', awayReachedSeconds: '10',
    winnerId: p[0], resultKind: 'normal',
  });
  check('G7 负数时间被拒绝', !neg.ok);

  const ok = applyBo3Game(ev, {
    seriesId: 'F-QUAL', gameIndex: 1, homeTeamId: p[0], awayTeamId: p[1],
    homeScore: '16', awayScore: '16', homeReachedSeconds: '95.5', awayReachedSeconds: '120',
    winnerId: p[0], resultKind: 'normal',
  });
  const g2 = ok.event.finals.series.find((s) => s.id === 'F-QUAL')!.games[0]!;
  check('G7 时间原样保存（含小数）', g2.homeReachedSeconds === '95.5' && g2.awayReachedSeconds === '120',
    `${g2.homeReachedSeconds}/${g2.awayReachedSeconds}`);
}

report();
process.exit(failures.length === 0 ? 0 : 1);
