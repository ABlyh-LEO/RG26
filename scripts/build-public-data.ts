/**
 * 生成公开数据快照 public/data/event.json。
 *
 * 规则（第 9.1、10.4、11.2 节）：
 * - 只覆盖自己的生成目录，绝不删除原文、参考资料或草稿。
 * - 外层包含 revision（输入内容哈希）、builtAt、sourceCommit、schemaVersion。
 * - 同一数据版本不能出现互相冲突的内容。
 * - 公开产物不得包含维护草稿、工作人员记录、仓库凭据或原始文档。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { eventFileSchema } from '../src/domain/schema';
import { validateEvent, formatValidation } from '../src/domain/validation';
import { canExportOfficial } from '../src/domain/corrections';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = resolve(ROOT, 'data', 'event.json');
const TARGET = resolve(ROOT, 'public', 'data', 'event.json');

/** 计算输入内容哈希。对规范化 JSON 取哈希，保证同一内容得到同一 revision。 */
export function computeRevision(eventJson: unknown): string {
  return createHash('sha256').update(JSON.stringify(eventJson)).digest('hex').slice(0, 32);
}

function readSourceCommit(): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function main(): void {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(SOURCE, 'utf8'));
  } catch (error) {
    console.error(`无法读取或解析 ${SOURCE}：${(error as Error).message}`);
    console.error('请先运行 npm run data:seed 生成初始数据。');
    process.exit(2);
  }

  const parsed = eventFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('源数据不符合 schema，拒绝生成公开快照：');
    for (const issue of parsed.error.issues.slice(0, 20)) {
      console.error(`  [${issue.path.join('.') || '(根)'}] ${issue.message}`);
    }
    process.exit(1);
  }

  const validation = validateEvent(parsed.data);
  if (!validation.ok) {
    console.error('源数据未通过业务校验，拒绝生成公开快照：');
    console.error(formatValidation(validation));
    process.exit(1);
  }

  // 有未处置的更正时不得导出正式版本。
  const exportGate = canExportOfficial(parsed.data);
  if (!exportGate.ok) {
    console.error('存在未处置的更正，拒绝生成公开快照：');
    for (const reason of exportGate.reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }

  const revision = computeRevision(parsed.data);
  const snapshot = {
    schemaVersion: 1 as const,
    revision,
    builtAt: new Date().toISOString(),
    sourceCommit: readSourceCommit(),
    data: parsed.data,
  };

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  console.log(`已写入 ${TARGET}`);
  console.log(`  revision: ${revision}`);
  console.log(`  sourceCommit: ${snapshot.sourceCommit ?? '(非 git 仓库)'}`);
  console.log(`  schemaVersion: ${snapshot.schemaVersion}`);
  if (validation.warnings.length > 0) {
    console.log(`  提示 ${validation.warnings.length} 条（不影响发布）`);
  }
}

// 仅在直接执行时运行主流程，便于测试导入 computeRevision。
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
