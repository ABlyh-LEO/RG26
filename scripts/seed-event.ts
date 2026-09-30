/**
 * 生成初始正式数据 data/event.json。
 *
 * 幂等：重复运行产生相同结构（contentUpdatedAt 除外）。
 * 默认不覆盖已有文件，避免误删维护者录入的真实赛果。
 * 需要重建时显式加 --force。
 */
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildSeedEvent } from './seed-data';
import { eventFileSchema } from '../src/domain/schema';
import { validateEvent, formatValidation } from '../src/domain/validation';

const ROOT = resolve(import.meta.dirname, '..');
const TARGET = resolve(ROOT, 'data', 'event.json');

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const now = new Date().toISOString();

  if (existsSync(TARGET) && !force) {
    // 保护已有数据：如果已存在且含有任何真实赛果，则拒绝覆盖。
    const existing = JSON.parse(readFileSync(TARGET, 'utf8')) as ReturnType<typeof buildSeedEvent>;
    const hasResults =
      existing.qualification.runs.some((r) => r.resultStatus !== 'none') ||
      existing.swiss.matches.some((m) => m.attempts.length > 0) ||
      existing.finals.series.some((s) => s.games.some((g) => g.resultStatus !== 'none')) ||
      existing.qualification.ranking.status !== 'none';
    if (hasResults) {
      console.error('data/event.json 已包含赛果，拒绝覆盖。如确实要重建，请显式使用 --force。');
      process.exit(2);
    }
    console.log('data/event.json 已存在且不包含赛果，将重新生成骨架。');
  }

  const event = buildSeedEvent(now);

  const parsed = eventFileSchema.safeParse(event);
  if (!parsed.success) {
    console.error('生成的种子数据不符合 schema：');
    console.error(JSON.stringify(parsed.error.issues.slice(0, 20), null, 2));
    process.exit(1);
  }

  const validation = validateEvent(parsed.data);
  if (!validation.ok) {
    console.error('生成的种子数据未通过业务校验：');
    console.error(formatValidation(validation));
    process.exit(1);
  }

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');

  console.log(`已写入 ${TARGET}`);
  console.log(`  队伍 ${parsed.data.teams.length} 支（竞技 ${parsed.data.teams.filter((t) => t.division === 'competitive').length}、展示 ${parsed.data.teams.filter((t) => t.division === 'showcase').length}）`);
  console.log(`  排位赛跑图 ${parsed.data.qualification.runs.length} 次`);
  console.log(`  瑞士轮 ${parsed.data.swiss.rounds.length} 轮 / ${parsed.data.swiss.matches.length} 个时间槽`);
  console.log(`  决赛系列赛 ${parsed.data.finals.series.length} 个`);
  console.log(`  日程项 ${parsed.data.scheduleItems.length} 条`);
  if (validation.warnings.length > 0) {
    console.log(`\n提示 ${validation.warnings.length} 条：`);
    for (const w of validation.warnings) console.log(`  - ${w.message}`);
  }
}

main();
