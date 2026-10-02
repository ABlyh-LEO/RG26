/**
 * 用**通过正式领域函数生成的合成赛果**生成一份测试快照，用于验证晋级图是否会
 * 漏显示已完成比赛。
 *
 * 为什么需要：正式的 data/event.json 里所有成绩都是空的
 * （赛事未开始），所以「晋级图能不能显示已完成比赛」这件事
 * 一直没有被验证过。这里跑一个完整赛季（排位赛 44 次跑图 →
 * 瑞士轮 5 轮 → 12 场决赛 BO1 → 2 组 BO3 → 冠军），
 * 把结果写成一份**独立的测试快照**，供浏览器端目视与断言检查。
 *
 * 注意：产物写到 public/data/ 之外的临时路径，绝不覆盖正式数据。
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eventFileSchema, type EventFile } from '../src/domain/schema';
import {
  applyBo1Entry,
  applyBo3Game,
  applyFinalsBo1,
  applyQualificationAutoRanking,
  applyQualificationRun,
  confirmRound,
  generateNextRound,
  publishFinalsSeeding,
  publishRound,
} from '../src/operator/draft';
import { resolveFinals } from '../src/domain/finals';
import { buildSeedEvent } from './seed-data';

const OUT = resolve(import.meta.dirname, '..', 'tmp-full-season.json');

function load(): EventFile {
  return eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));
}

/** 参赛双方（决赛）。 */
function players(ev: EventFile, id: string): [string, string] {
  const slots = resolveFinals(ev.finals.series, ev.finals.seeding).series.get(id)?.slots;
  const a = slots?.[0];
  const b = slots?.[1];
  if (a?.state !== 'resolved' || b?.state !== 'resolved') throw new Error(`${id} 参赛双方未就绪`);
  return [a.teamId, b.teamId];
}

let e = load();
const ids = e.teams.filter((t) => t.division === 'competitive').map((t) => t.id);

// 1. 排位赛：两轮 44 次跑图，名次越好积分越高、用时越短
ids.forEach((teamId, i) => {
  for (const round of [1, 2] as const) {
    const run = e.qualification.runs.find((r) => r.teamId === teamId && r.round === round)!;
    const res = applyQualificationRun(e, {
      runId: run.id,
      rawResult: `${(100 - i).toString()} 分`,
      score: String(100 - i),
      elapsedSeconds: String(20 + i),
      judgeNote: null,
      confirm: true,
    });
    if (!res.ok) throw new Error(`排位赛 ${teamId} R${round} 失败`);
    e = res.event;
  }
});
e = applyQualificationAutoRanking(e).event;

// 2. 瑞士轮 5 轮：主队（第一个席位）胜，制造确定的战绩
for (let r = 1; r <= 5; r += 1) {
  const gen = generateNextRound(e, r);
  if (!gen.ok || !gen.proposal) throw new Error(`R${r} 生成失败`);
  e = publishRound(e, r, gen.proposal).event;
  const round = e.swiss.rounds.find((x) => x.index === r)!;
  for (const matchId of round.matchIds) {
    const m = e.swiss.matches.find((x) => x.id === matchId)!;
    const [home, away] = m.participantSnapshot!;
    const res = applyBo1Entry(e, {
      matchId,
      homeScore: '16',
      awayScore: String(4 + (r % 3)),
      homeSeconds: String(80 + r),
      awaySeconds: String(120 + r),
      winnerId: home,
      resultKind: 'normal',
      note: null,
    });
    if (!res.ok) throw new Error(`R${r} ${matchId} 失败：${res.messages.join('；')}`);
    e = res.event;
    void away;
  }
  const conf = confirmRound(e, r);
  if (!conf.ok) throw new Error(`R${r} 确认失败：${conf.messages.join('；')}`);
  e = conf.event;
}

// 3. 八强种子
e = publishFinalsSeeding(e).event;

// 4. 决赛 12 场 BO1：第一个席位（蓝方）胜
for (const id of ['F-M1', 'F-M2', 'F-M3', 'F-M4', 'F-L1A', 'F-L1B', 'F-W1A', 'F-W1B', 'F-L2A', 'F-L2B', 'F-WSF', 'F-LSF']) {
  const [a, b] = players(e, id);
  const res = applyFinalsBo1(e, {
    seriesId: id,
    gameIndex: 1,
    homeTeamId: a,
    awayTeamId: b,
    homeScore: '16',
    awayScore: '7',
    homeReachedSeconds: '85',
    awayReachedSeconds: '140',
    winnerId: a,
    resultKind: 'normal',
  });
  if (!res.ok) throw new Error(`${id} 失败：${res.messages.join('；')}`);
  e = res.event;
}

// 5. 两组 BO3 全系列赛不换边：F-QUAL 打满 3 局，F-GF 直落两局
{
  const [a, b] = players(e, 'F-QUAL');
  for (const [idx, winner] of [
    [1, a],
    [2, b],
    [3, a],
  ] as const) {
    const res = applyBo3Game(e, {
      seriesId: 'F-QUAL',
      gameIndex: idx,
      homeTeamId: a,
      awayTeamId: b,
      homeScore: '16',
      awayScore: '12',
      homeReachedSeconds: String(70 + idx * 5),
      awayReachedSeconds: String(110 + idx * 5),
      winnerId: winner,
      resultKind: 'normal',
    });
    if (!res.ok) throw new Error(`F-QUAL 第 ${idx} 局失败`);
    e = res.event;
  }
}
{
  const [a, b] = players(e, 'F-GF');
  for (const idx of [1, 2]) {
    const res = applyBo3Game(e, {
      seriesId: 'F-GF',
      gameIndex: idx,
      homeTeamId: a,
      awayTeamId: b,
      homeScore: '16',
      awayScore: '10',
      homeReachedSeconds: String(75 + idx * 5),
      awayReachedSeconds: String(130 + idx * 5),
      winnerId: a,
      resultKind: 'normal',
    });
    if (!res.ok) throw new Error(`F-GF 第 ${idx} 局失败`);
    e = res.event;
  }
}

const awards = resolveFinals(e.finals.series, e.finals.seeding).awards;

/**
 * 写成**公开快照**格式（与 public/data/event.json 同构），
 * 这样浏览器端只要把同一个文件塞进 public/data 就能渲染。
 */
const snapshot = {
  schemaVersion: 1,
  revision: 'full-season-test-snapshot',
  builtAt: '2026-10-04T23:00:00+08:00',
  sourceCommit: 'test',
  data: e,
};
writeFileSync(OUT, JSON.stringify(snapshot, null, 2), 'utf8');

const swissPlayed = e.swiss.matches.filter((m) => m.effectiveAttemptId !== null).length;
const finalsPlayed = e.finals.series.filter((s) =>
  s.games.some((g) => g.resultStatus === 'confirmed'),
).length;

console.log('已生成完整赛季测试快照：', OUT);
console.log(`  排位赛跑图：${e.qualification.runs.filter((r) => r.resultStatus === 'confirmed').length} / 44 已确认`);
console.log(`  瑞士轮：${swissPlayed} / 33 场已结算`);
console.log(`  决赛：${finalsPlayed} 组已有结果`);
console.log(`  冠军=${awards.champion} 亚军=${awards.runnerUp} 季军=${awards.third}`);
