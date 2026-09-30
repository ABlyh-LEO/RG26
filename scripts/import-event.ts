/**
 * 导入维护工具导出的变更包（docs/IMPLEMENTATION_PLAN.md 第 10.2 节）。
 *
 * 行为：
 * - 检查 schema、基础版本和所有业务约束。
 * - 展示修改摘要。
 * - 校验成功后以临时文件 + 原子替换方式写入唯一源文件。
 * - 基础版本不一致时**拒绝覆盖**，要求重新载入并人工合并；
 *   **不提供默认 force 覆盖捷径**。
 * - 导入不自动执行 Git push。
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { changePackageSchema, eventFileSchema, type EventFile } from '../src/domain/schema';
import { validateEvent, formatValidation } from '../src/domain/validation';
import { canExportOfficial } from '../src/domain/corrections';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = resolve(ROOT, 'data', 'event.json');

/** 与 build-public-data.ts 使用同一算法，保证 revision 可比对。 */
export function computeRevision(eventJson: unknown): string {
  return createHash('sha256').update(JSON.stringify(eventJson)).digest('hex').slice(0, 32);
}

function summarize(before: EventFile | null, after: EventFile): string {
  const lines: string[] = [];
  if (!before) {
    lines.push('（没有旧版本可比对）');
  } else {
    const diff = (label: string, a: number, b: number) => {
      if (a !== b) lines.push(`  ${label}：${a} → ${b}`);
    };
    diff('队伍数', before.teams.length, after.teams.length);
    diff('排位赛跑图数', before.qualification.runs.length, after.qualification.runs.length);
    diff('瑞士轮比赛数', before.swiss.matches.length, after.swiss.matches.length);
    diff('决赛系列赛数', before.finals.series.length, after.finals.series.length);
    diff('日程项数', before.scheduleItems.length, after.scheduleItems.length);
    diff('公告数', before.notices.length, after.notices.length);
    diff('更正记录数', before.corrections.length, after.corrections.length);

    // 已确认结果的增量
    const confirmed = (e: EventFile) =>
      e.swiss.matches.filter((m) => m.attempts.some((a) => a.id === m.effectiveAttemptId && a.resultStatus === 'confirmed')).length;
    diff('已确认瑞士轮场次', confirmed(before), confirmed(after));

    const rankingBefore = before.qualification.ranking.status;
    const rankingAfter = after.qualification.ranking.status;
    if (rankingBefore !== rankingAfter) lines.push(`  排位赛排名状态：${rankingBefore} → ${rankingAfter}`);

    const seedingBefore = before.finals.seeding?.version ?? 0;
    const seedingAfter = after.finals.seeding?.version ?? 0;
    if (seedingBefore !== seedingAfter) lines.push(`  八强种子版本：${seedingBefore} → ${seedingAfter}`);

    if (before.showcase.drawOrder === null && after.showcase.drawOrder !== null) {
      lines.push('  展示组抽签：已登记');
    }
  }
  if (lines.length === 0) lines.push('  没有检测到结构性变化。');
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;

  if (!file) {
    console.error('用法：npm run data:import -- --file <导出文件路径>');
    process.exit(2);
  }

  const importPath = resolve(process.cwd(), file);
  if (!existsSync(importPath)) {
    console.error(`找不到导出文件：${importPath}`);
    process.exit(2);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(importPath, 'utf8'));
  } catch (error) {
    console.error(`导出文件不是合法 JSON：${(error as Error).message}`);
    process.exit(2);
  }

  // 1. 变更包结构
  const pkg = changePackageSchema.safeParse(raw);
  if (!pkg.success) {
    console.error('变更包结构校验失败：');
    for (const issue of pkg.error.issues.slice(0, 20)) {
      console.error(`  [${issue.path.join('.') || '(根)'}] ${issue.message}`);
    }
    console.error('\n提示：导入器只接受维护工具导出的完整变更包，不接受公开页面的缓存文件。');
    process.exit(1);
  }

  // 2. 读取当前源数据
  if (!existsSync(SOURCE)) {
    console.error(`找不到当前源数据：${SOURCE}`);
    process.exit(2);
  }
  const currentParsed = eventFileSchema.safeParse(JSON.parse(readFileSync(SOURCE, 'utf8')));
  if (!currentParsed.success) {
    console.error('当前源数据本身不符合 schema，拒绝导入（请先修复源数据）。');
    process.exit(1);
  }
  const current = currentParsed.data;
  const currentRevision = computeRevision(current);

  // 3. 基础版本必须一致 —— 不一致时拒绝覆盖，不提供 force 捷径
  if (pkg.data.baseRevision !== currentRevision) {
    console.error('基础版本不一致，拒绝覆盖。');
    console.error(`  变更包基于：${pkg.data.baseRevision}`);
    console.error(`  当前源版本：${currentRevision}`);
    console.error('\n请重新载入最新源数据，人工合并你的修改后重新导出。');
    console.error('导入器不提供强制覆盖选项，以免丢失其他人的修改。');
    process.exit(1);
  }

  // 4. 业务校验
  const validation = validateEvent(pkg.data.event);
  console.log(formatValidation(validation));
  if (!validation.ok) {
    console.error(`\n导入失败：${validation.errors.length} 条业务校验错误。`);
    process.exit(1);
  }

  const exportGate = canExportOfficial(pkg.data.event);
  if (!exportGate.ok) {
    console.error('\n存在未处置的更正，拒绝导入正式版本：');
    for (const reason of exportGate.reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }

  // 5. 修改摘要
  console.log('\n修改摘要：');
  console.log(summarize(current, pkg.data.event));

  // 6. 临时文件 + 原子替换
  const dir = dirname(SOURCE);
  const tmpDir = mkdtempSync(join(dir, '.import-'));
  const tmpFile = join(tmpDir, 'event.json');
  try {
    writeFileSync(tmpFile, `${JSON.stringify(pkg.data.event, null, 2)}\n`, 'utf8');
    // 再读一次确认可解析（防止写入过程出现问题）
    eventFileSchema.parse(JSON.parse(readFileSync(tmpFile, 'utf8')));
    renameSync(tmpFile, SOURCE);
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (error) {
    rmSync(tmpDir, { recursive: true, force: true });
    console.error(`写入失败，源文件未被修改：${(error as Error).message}`);
    process.exit(1);
  }

  console.log(`\n已写入 ${SOURCE}`);
  console.log(`  revision：${currentRevision} → ${computeRevision(pkg.data.event)}`);
  console.log('\n下一步：');
  console.log('  1. 运行 npm run validate:data 复核');
  console.log('  2. 运行 npm run data:build 生成公开快照并本地预览');
  console.log('  3. 提交 data/event.json 并推送到发布分支（导入不会自动 push）');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
