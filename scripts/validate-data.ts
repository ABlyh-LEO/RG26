/**
 * 校验 data/event.json。
 *
 * 这是 CI 与 npm run build 的必需步骤：数据校验失败必须阻止部署。
 * 退出码：0 通过（可能有警告），1 有错误，2 文件缺失或无法解析。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eventFileSchema } from '../src/domain/schema';
import { validateEvent, formatValidation } from '../src/domain/validation';

const ROOT = resolve(import.meta.dirname, '..');
const TARGET = resolve(ROOT, 'data', 'event.json');

function main(): void {
  if (!existsSync(TARGET)) {
    console.error(`找不到数据文件：${TARGET}`);
    console.error('请先运行 npm run data:seed 生成初始数据。');
    process.exit(2);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(TARGET, 'utf8'));
  } catch (error) {
    console.error(`data/event.json 不是合法 JSON：${(error as Error).message}`);
    process.exit(2);
  }

  const parsed = eventFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('schema 校验失败：');
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(根)';
      console.error(`  [${path}] ${issue.message}`);
    }
    process.exit(1);
  }

  const result = validateEvent(parsed.data);
  console.log(formatValidation(result));

  const summary = [
    `队伍 ${parsed.data.teams.length} 支`,
    `跑图 ${parsed.data.qualification.runs.length} 次`,
    `瑞士轮 ${parsed.data.swiss.rounds.length} 轮 / ${parsed.data.swiss.matches.length} 槽`,
    `决赛系列赛 ${parsed.data.finals.series.length} 个`,
    `日程项 ${parsed.data.scheduleItems.length} 条`,
    `规则版本 ${parsed.data.rules.version}`,
  ];
  console.log(`\n概要：${summary.join('，')}`);

  if (!result.ok) {
    console.error(`\n校验未通过：${result.errors.length} 条错误。`);
    process.exit(1);
  }
  console.log('\n校验通过。');
}

main();
