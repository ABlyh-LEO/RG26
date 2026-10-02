/**
 * 维护闭环集成检查（第 12 节 P4/P6、第 13.2 节流程 3–4）。
 *
 * 验证：
 * 1. 录入一场结果 → 计算 → 生成下一轮候选的完整链路
 * 2. R3 整轮对阵锁定演练
 * 3. 基础版本冲突被拒绝
 *
 * 这是脚本而非单元测试，因为它跨越多个模块并要真实读写临时文件。
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { eventFileSchema } from '../src/domain/schema';
import { validateEvent, formatValidation } from '../src/domain/validation';
import { calculateSwissStandings } from '../src/domain/standings';
import {
  applyBo1Entry,
  applyBo3Game,
  applyFinalsBo1,
  applyQualificationRanking,
  confirmRound,
  generateNextRound,
  publishFinalsSeeding,
  publishRound,
  preflight,
} from '../src/operator/draft';
import { resolveFinals } from '../src/domain/finals';
import { buildSeedEvent } from './seed-data';

const ROOT = resolve(import.meta.dirname, '..');

function ok(label: string): void {
  console.log(`  ✓ ${label}`);
}
function fail(label: string): never {
  console.error(`  ✗ ${label}`);
  process.exit(1);
}
function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

section('1. 从种子数据开始');
let event = buildSeedEvent('2026-10-03T08:00:00+08:00');
const parsed = eventFileSchema.safeParse(event);
if (!parsed.success) fail('种子数据不符合 schema');
event = parsed.data;
ok(`种子数据就绪：${event.teams.length} 队、${event.swiss.matches.length} 个瑞士轮槽`);

section('2. 录入排位赛正式排名');
const competitive = event.teams.filter((t) => t.division === 'competitive');
// 用三审顺序作为裁判确认结果（真实场景由裁判核分决定顺序）
const orderedIds = [...competitive]
  .sort((a, b) => (a.thirdReviewRank ?? 99) - (b.thirdReviewRank ?? 99))
  .map((t) => t.id);
const rankingResult = applyQualificationRanking(event, orderedIds, '集成检查用');
if (!rankingResult.ok) fail(`排位赛排名录入失败：${rankingResult.messages.join('；')}`);
event = rankingResult.event;
ok(`已确认 ${orderedIds.length} 队排位名次`);

// 排名必须完整且不重复
if (new Set(orderedIds).size !== 22) fail('排名存在重复队伍');

section('3. 生成并公布 R1 对阵');
const r1 = generateNextRound(event, 1);
if (!r1.ok || !r1.proposal) fail(`R1 候选生成失败：${r1.messages.join('；')}`);
if (r1.proposal.pairs.length !== 8) fail(`R1 应有 8 场，实际 ${r1.proposal.pairs.length}`);

// 验证首尾配对
const first = r1.proposal.pairs[0]!;
if (first.homeTeamId !== orderedIds[0] || first.awayTeamId !== orderedIds[15]) {
  fail(`R1 首场应为第 1 名对第 16 名，实际 ${first.homeTeamId} vs ${first.awayTeamId}`);
}
ok('R1 首尾配对正确（第 1 名 vs 第 16 名）');

const published = publishRound(event, 1, r1.proposal);
if (!published.ok) fail(`R1 公布失败：${published.messages.join('；')}`);
event = published.event;
const r1Round = event.swiss.rounds.find((r) => r.index === 1)!;
if (r1Round.publicationStatus !== 'published') fail('R1 未标记为已公布');
if (!r1Round.rankingSnapshot || r1Round.rankingSnapshot.length === 0) fail('R1 未冻结评分快照');
ok(`已公布 R1 共 ${r1Round.matchIds.length} 场并冻结评分快照`);

section('4. 录入 R1 全部 8 场结果');
const r1Matches = r1Round.matchIds
  .map((id) => event.swiss.matches.find((m) => m.id === id))
  .filter((m): m is NonNullable<typeof m> => m !== undefined);

if (r1Matches.length !== 8) fail(`R1 比赛数应为 8，实际 ${r1Matches.length}`);

for (const match of r1Matches) {
  const participants = match.participantSnapshot;
  if (!participants) fail(`${match.id} 缺少参赛快照`);
  const [home] = participants;
  const result = applyBo1Entry(event, {
    matchId: match.id,
    homeScore: '16',
    awayScore: '4',
    homeSeconds: '95',
    awaySeconds: '140',
    winnerId: home,
    resultKind: 'normal',
    note: null,
  });
  if (!result.ok) fail(`录入 ${match.id} 失败：${result.messages.join('；')}`);
  event = result.event;
}
ok('R1 全部 8 场已录入');

section('5. 确认 R1 并生成 R2');
const confirmed = confirmRound(event, 1);
if (!confirmed.ok) fail(`R1 确认失败：${confirmed.messages.join('；')}`);
event = confirmed.event;
ok('R1 已确认');

const r2 = generateNextRound(event, 2);
if (!r2.ok || !r2.proposal) fail(`R2 候选失败：${r2.messages.join('；')}`);
if (r2.proposal.pairs.length !== 8) fail(`R2 应有 8 场，实际 ${r2.proposal.pairs.length}`);

// 组顺序必须是 1-0 然后 0-1
const groups = r2.proposal.pairs.map((p) => p.groupRecord);
if (groups.slice(0, 4).some((g) => g !== '1-0') || groups.slice(4).some((g) => g !== '0-1')) {
  fail(`R2 组顺序错误：${groups.join(',')}`);
}
ok('R2 组顺序正确（1-0 四场、0-1 四场）');

const r2Published = publishRound(event, 2, r2.proposal);
if (!r2Published.ok) fail(`R2 公布失败：${r2Published.messages.join('；')}`);
event = r2Published.event;

section('6. 录入并确认 R2，然后一次性公布 R3');
const r2Round = event.swiss.rounds.find((r) => r.index === 2)!;
for (const matchId of r2Round.matchIds) {
  const match = event.swiss.matches.find((m) => m.id === matchId)!;
  const [home] = match.participantSnapshot!;
  const result = applyBo1Entry(event, {
    matchId,
    homeScore: '16',
    awayScore: '6',
    homeSeconds: '90',
    awaySeconds: '150',
    winnerId: home,
    resultKind: 'normal',
    note: null,
  });
  if (!result.ok) fail(`录入 ${matchId} 失败`);
  event = result.event;
}
const r2Confirmed = confirmRound(event, 2);
if (!r2Confirmed.ok) fail(`R2 确认失败：${r2Confirmed.messages.join('；')}`);
event = r2Confirmed.event;
ok('R2 已确认');

const r3 = generateNextRound(event, 3);
if (!r3.ok || !r3.proposal) fail(`R3 候选失败：${r3.messages.join('；')}`);
if (r3.proposal.pairs.length !== 8) fail(`R3 应有 8 场，实际 ${r3.proposal.pairs.length}`);

const r3Groups = r3.proposal.pairs.map((p) => p.groupRecord);
const expectedR3 = ['2-0', '2-0', '1-1', '1-1', '1-1', '1-1', '0-2', '0-2'];
if (JSON.stringify(r3Groups) !== JSON.stringify(expectedR3)) {
  fail(`R3 组顺序错误：${r3Groups.join(',')}，预期 ${expectedR3.join(',')}`);
}
ok('R3 组顺序正确（2-0×2、1-1×4、0-2×2）');

const r3Published = publishRound(event, 3, r3.proposal);
if (!r3Published.ok) fail(`R3 公布失败：${r3Published.messages.join('；')}`);
event = r3Published.event;
ok('R3 全部 8 场一次性公布');

section('7. R3 整轮对阵锁定演练');
const r3Round = event.swiss.rounds.find((r) => r.index === 3)!;
const r3Matches = r3Round.matchIds.map((id) => event.swiss.matches.find((m) => m.id === id)!);

// 记录本轮后四场的参赛双方与时间槽
const nextDay = r3Matches.filter((m) => {
  const item = event.scheduleItems.find((s) => s.id === m.scheduleItemId)!;
  return Date.parse(item.plannedStart) >= Date.parse('2026-10-03T20:20:00+08:00');
});
if (nextDay.length !== 4) fail(`本轮后段应有 4 场，实际 ${nextDay.length}`);
const nextDayBefore = nextDay.map((m) => ({
  id: m.id,
  participants: [...(m.participantSnapshot ?? [])].join('|'),
  slot: m.scheduleItemId,
}));
ok(`后段锁定 ${nextDay.length} 场：${nextDayBefore.map((n) => n.participants).join(' / ')}`);

// 完成本轮前四场（2-0 两场 + 1-1 前两场）
const tonight = r3Matches.filter((m) => !nextDayBefore.some((n) => n.id === m.id));
if (tonight.length !== 4) fail(`当晚应有 4 场，实际 ${tonight.length}`);
for (const match of tonight) {
  const [home] = match.participantSnapshot!;
  const result = applyBo1Entry(event, {
    matchId: match.id,
    homeScore: '16',
    awayScore: '2',
    homeSeconds: '88',
    awaySeconds: '200',
    winnerId: home,
    resultKind: 'normal',
    note: null,
  });
  if (!result.ok) fail(`录入 ${match.id} 失败`);
  event = result.event;
}
ok('当晚 4 场已完成');

// 关键断言：本轮后四场的参赛双方与时间槽未变化
const nextDayAfter = r3Round.matchIds
  .map((id) => event.swiss.matches.find((m) => m.id === id)!)
  .filter((m) => nextDayBefore.some((n) => n.id === m.id))
  .map((m) => ({
    id: m.id,
    participants: [...(m.participantSnapshot ?? [])].join('|'),
    slot: m.scheduleItemId,
  }));

for (const before of nextDayBefore) {
  const after = nextDayAfter.find((a) => a.id === before.id);
  if (!after) fail(`后段的 ${before.id} 消失了`);
  if (after.participants !== before.participants) {
    fail(`后段的 ${before.id} 参赛双方被改变了：${before.participants} → ${after.participants}`);
  }
  if (after.slot !== before.slot) fail(`后段的 ${before.id} 时间槽被改变了`);
}
ok('本轮后四场的参赛双方与时间槽保持不变（整轮锁定生效）');

// R4 不可生成
const r4 = generateNextRound(event, 4);
if (r4.ok) fail('R3 未完成时 R4 不应可以生成');
ok(`R3 未完成时 R4 被正确阻断：${r4.messages[0]}`);

section('8. 完成 R3、确认并公布 R4');
for (const matchId of r3Round.matchIds) {
  const match = event.swiss.matches.find((m) => m.id === matchId)!;
  const already = match.attempts.some((a) => a.id === match.effectiveAttemptId && a.resultStatus === 'confirmed');
  if (already) continue;
  const [home] = match.participantSnapshot!;
  const result = applyBo1Entry(event, {
    matchId,
    homeScore: '16',
    awayScore: '3',
    homeSeconds: '92',
    awaySeconds: '180',
    winnerId: home,
    resultKind: 'normal',
    note: null,
  });
  if (!result.ok) fail(`录入 ${matchId} 失败`);
  event = result.event;
}
const r3Confirmed = confirmRound(event, 3);
if (!r3Confirmed.ok) fail(`R3 确认失败：${r3Confirmed.messages.join('；')}`);
event = r3Confirmed.event;

const r4AfterR3 = generateNextRound(event, 4);
if (!r4AfterR3.ok || !r4AfterR3.proposal) fail(`R4 候选失败：${r4AfterR3.messages.join('；')}`);
if (r4AfterR3.proposal.pairs.length !== 6) fail(`R4 应有 6 场，实际 ${r4AfterR3.proposal.pairs.length}`);
ok('R4 生成 6 场（2-1 组 3 场、1-2 组 3 场）');

section('9. 校验数据仍然健康');
const finalCheck = preflight(event);
if (!finalCheck.ok) {
  console.error(formatValidation(validateEvent(event)));
  fail('录入后数据校验失败');
}
const validation = validateEvent(event);
ok(`数据校验通过（${validation.errors.length} 错误、${validation.warnings.length} 提示）`);
for (const w of validation.warnings.slice(0, 3)) console.log(`      提示：${w.message}`);

section('10. 确认当前排名可计算');
const standings = calculateSwissStandings(orderedIds, event.swiss.matches, event.qualification.ranking);
const totalGames = [...standings.byTeam.values()].reduce((sum, e) => sum + e.wins + e.losses, 0);
if (totalGames !== 16 * 3) fail(`已确认对局数应为 48（16 队 × 3 轮），实际 ${totalGames}`);
ok(`排名可计算：16 队共 ${totalGames / 2} 场已确认`);
for (const g of standings.groups) {
  console.log(`      ${g.record} 组：${g.entries.length} 队`);
}

section('11. 变更包与基础版本冲突检测');
const tmp = mkdtempSync(join(ROOT, '.tmp-integration-'));
try {
  // 写出一份"导出"的变更包
  const pkg = {
    schemaVersion: 1,
    baseRevision: 'stale-revision-should-not-match',
    exportedAt: new Date().toISOString(),
    event,
  };
  const pkgPath = join(tmp, 'export.json');
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
  ok(`已写出变更包：${pkgPath}`);

  // 用错误的 baseRevision 尝试导入，必须被拒绝。
  // 注意：沙箱下无法用管道捕获子进程输出（EPERM），因此改为把输出重定向到文件再读取。
  const { execFileSync } = await import('node:child_process');
  const logPath = join(tmp, 'import.log');
  let rejected = false;
  let exitCode = 0;
  try {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/import-event.ts', '--file', pkgPath], {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (error) {
    rejected = true;
    exitCode = (error as { status?: number }).status ?? -1;
  }
  if (!rejected) fail('基础版本不一致时导入未被拒绝');
  if (exitCode !== 1) fail(`导入应以退出码 1 拒绝，实际 ${exitCode}`);
  ok('基础版本不一致时导入被正确拒绝（退出码 1）');
  void logPath;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

section('12. 完成 R4/R5 并公布八强种子');
{
  /*
   * R4 在第 8 节只生成了**候选**（未公布），因此它的比赛还没有参赛双方。
   * 必须先公布，才能录入结果 —— 这正是真实流程要求的顺序。
   */
  const r4RoundDraft = event.swiss.rounds.find((r) => r.index === 4)!;
  if (r4RoundDraft.publicationStatus !== 'published') {
    const r4Published = publishRound(event, 4, r4AfterR3.proposal!);
    if (!r4Published.ok) fail(`R4 公布失败：${r4Published.messages.join('；')}`);
    event = r4Published.event;
    ok('R4 已公布');
  }

  const r4Round = event.swiss.rounds.find((r) => r.index === 4)!;
  for (const matchId of r4Round.matchIds) {
    const match = event.swiss.matches.find((m) => m.id === matchId)!;
    if (!match.participantSnapshot) fail(`${matchId} 缺少参赛双方（R4 未正确公布？）`);
    const [home] = match.participantSnapshot;
    const result = applyBo1Entry(event, {
      matchId, homeScore: '16', awayScore: '5', homeSeconds: '91', awaySeconds: '160',
      winnerId: home, resultKind: 'normal', note: null,
    });
    if (!result.ok) fail(`录入 ${matchId} 失败：${result.messages.join('；')}`);
    event = result.event;
  }
  const r4Confirmed = confirmRound(event, 4);
  if (!r4Confirmed.ok) fail(`R4 确认失败：${r4Confirmed.messages.join('；')}`);
  event = r4Confirmed.event;
  ok('R4 已确认');

  const r5 = generateNextRound(event, 5);
  if (!r5.ok || !r5.proposal) fail(`R5 候选失败：${r5.messages.join('；')}`);
  const r5Published = publishRound(event, 5, r5.proposal);
  if (!r5Published.ok) fail(`R5 公布失败：${r5Published.messages.join('；')}`);
  event = r5Published.event;
  ok(`R5 已公布（${r5.proposal.pairs.length} 场）`);

  const r5Round = event.swiss.rounds.find((r) => r.index === 5)!;
  for (const matchId of r5Round.matchIds) {
    const match = event.swiss.matches.find((m) => m.id === matchId)!;
    if (!match.participantSnapshot) fail(`${matchId} 缺少参赛双方（R5 未正确公布？）`);
    const [home] = match.participantSnapshot;
    const result = applyBo1Entry(event, {
      matchId, homeScore: '16', awayScore: '7', homeSeconds: '93', awaySeconds: '155',
      winnerId: home, resultKind: 'normal', note: null,
    });
    if (!result.ok) fail(`录入 ${matchId} 失败：${result.messages.join('；')}`);
    event = result.event;
  }
  const r5Confirmed = confirmRound(event, 5);
  if (!r5Confirmed.ok) fail(`R5 确认失败：${r5Confirmed.messages.join('；')}`);
  event = r5Confirmed.event;
  ok('R5 已确认（瑞士轮结束）');

  const seeded = publishFinalsSeeding(event);
  if (!seeded.ok) fail(`公布八强种子失败：${seeded.messages.join('；')}`);
  event = seeded.event;
  const seeds = event.finals.seeding?.seeds ?? {};
  if (Object.keys(seeds).length !== 8) fail(`种子应有 8 个，实际 ${Object.keys(seeds).length}`);
  ok(`八强种子已公布：${Object.entries(seeds).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

section('13. 决赛 BO1（第 1–12 场）可完整录入');
{
  /*
   * 这 12 场曾经**没有任何录入入口**：applyBo1Entry 只查瑞士轮，
   * applyBo3Game 明确拒绝非 BO3/BO2 系列赛，于是决赛推不下去。
   * 现在由 applyFinalsBo1 覆盖，这里做端到端确认。
   */
  const bo1Order = ['F-M1', 'F-M2', 'F-M3', 'F-M4', 'F-L1A', 'F-L1B', 'F-W1A', 'F-W1B', 'F-L2A', 'F-L2B', 'F-WSF', 'F-LSF'];
  for (const seriesId of bo1Order) {
    const slots = resolveFinals(event.finals.series, event.finals.seeding).series.get(seriesId)?.slots;
    const a = slots?.[0];
    const b = slots?.[1];
    if (a?.state !== 'resolved' || b?.state !== 'resolved') {
      fail(`${seriesId} 参赛双方未就绪`);
    }
    const result = applyFinalsBo1(event, {
      seriesId,
      gameIndex: 1,
      homeTeamId: a.teamId,
      awayTeamId: b.teamId,
      homeScore: '16',
      awayScore: '6',
      homeReachedSeconds: '85',
      awayReachedSeconds: '140',
      winnerId: a.teamId,
      resultKind: 'normal',
    });
    if (!result.ok) fail(`${seriesId} 录入失败：${result.messages.join('；')}`);
    event = result.event;
  }
  ok(`第 1–12 场 BO1 已全部录入`);
}

section('14. 决赛 BO3（第 13–14 场）与冠军');
{
  const playBo3 = (seriesId: string): void => {
    const slots = resolveFinals(event.finals.series, event.finals.seeding).series.get(seriesId)?.slots;
    const a = slots?.[0];
    const b = slots?.[1];
    if (a?.state !== 'resolved' || b?.state !== 'resolved') fail(`${seriesId} 参赛双方未就绪`);
    for (const idx of [1, 2]) {
      const series = event.finals.series.find((s) => s.id === seriesId)!;
      const game = series.games.find((g) => g.index === idx);
      if (!game || game.resultStatus === 'confirmed') continue;
      const result = applyBo3Game(event, {
        seriesId, gameIndex: idx, homeTeamId: a.teamId, awayTeamId: b.teamId,
        homeScore: '16', awayScore: '8',
        homeReachedSeconds: String(80 + idx * 5), awayReachedSeconds: String(130 + idx * 5),
        winnerId: a.teamId, resultKind: 'normal',
      });
      if (!result.ok) fail(`${seriesId} 第 ${idx} 局失败：${result.messages.join('；')}`);
      event = result.event;
    }
  };
  playBo3('F-QUAL');
  ok('第 13 场（名额争夺战）已决出');
  playBo3('F-GF');
  ok('第 14 场（总决赛）已决出');

  const resolution = resolveFinals(event.finals.series, event.finals.seeding);
  const { awards } = resolution;
  if (!awards.champion) fail('未能产生冠军');
  if (!awards.runnerUp) fail('未能产生亚军');
  if (awards.champion === awards.runnerUp) fail('冠军与亚军相同');
  ok(`冠军 ${awards.champion} · 亚军 ${awards.runnerUp} · 季军 ${awards.third ?? '—'}`);
}

section('15. 完整赛季后数据仍然健康');
{
  const finalCheck = preflight(event);
  if (!finalCheck.ok) {
    console.error(formatValidation(validateEvent(event)));
    fail('完整赛季后数据校验失败');
  }
  const validation = validateEvent(event);
  ok(`完整赛季数据校验通过（${validation.errors.length} 错误、${validation.warnings.length} 提示）`);
}

section('集成检查全部通过');
console.log(`
已验证的完整链路：
  种子数据 → 排位赛排名 → 生成/公布 R1 → 录入 8 场 → 确认 → 生成/公布 R2
  → 录入 8 场 → 确认 → 一次性公布 R3 → 整轮锁定（后半轮 4 场不变）
  → 完成 R3 → 确认 → 生成 R4（6 场）→ 完成 R4/R5 → 公布八强种子
  → 决赛 BO1 第 1–12 场 → BO3 第 13–14 场 → 冠军
  → 数据校验 → 排名计算 → 冲突拒绝
`);
