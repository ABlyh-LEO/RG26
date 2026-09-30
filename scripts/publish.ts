/**
 * 一条命令完成发布（简化更新流程）。
 *
 * 替代原来需要手动执行的 4 步：
 *   data:import → validate:data → data:build → git add/commit/push
 *
 * 用法：
 *   npm run publish -- --file <导出文件.json> -m "R1 结果确认"
 *   npm run publish -- --file <导出文件.json> -m "..." --dry-run   # 只检查不提交
 *   npm run publish -- --file <导出文件.json> -m "..." --no-push   # 提交但不推送
 *
 * 每一步失败都会**立即停止**，不会留下半成品：
 *   - 导入失败（含基础版本冲突）→ 源文件不变
 *   - 校验失败 → 回滚到导入前的源文件
 *   - 构建失败 → 回滚
 *   - 提交/推送失败 → 告知如何回滚
 */
import { existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'data', 'event.json');

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

function step(n: number, total: number, title: string): void {
  console.log(`\n${C.bold}${C.cyan}[${n}/${total}]${C.reset} ${C.bold}${title}${C.reset}`);
}
function ok(msg: string): void {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}
function info(msg: string): void {
  console.log(`  ${C.dim}${msg}${C.reset}`);
}
function die(msg: string, hint?: string): never {
  console.error(`\n${C.red}✗ ${msg}${C.reset}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

/** 运行子命令；stdio inherit 以便看到输出（沙箱下管道 stdio 会 EPERM）。 */
function run(cmd: string, args: string[]): number {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return r.status ?? 1;
}

function git(args: string[]): { code: number; out: string } {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function main(): void {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf('--file');
  const msgIdx = argv.indexOf('-m') >= 0 ? argv.indexOf('-m') : argv.indexOf('--message');
  const dryRun = argv.includes('--dry-run');
  const noPush = argv.includes('--no-push');

  const file = fileIdx >= 0 ? argv[fileIdx + 1] : undefined;
  const message = msgIdx >= 0 ? argv[msgIdx + 1] : undefined;

  const TOTAL = dryRun ? 3 : 5;

  if (!file) {
    console.error(`${C.bold}用法${C.reset}`);
    console.error('  npm run publish -- --file <导出文件.json> -m "提交说明"');
    console.error('');
    console.error(`${C.bold}选项${C.reset}`);
    console.error('  --dry-run   只导入并校验，不提交（用于预览）');
    console.error('  --no-push   提交但不推送');
    process.exit(2);
  }
  if (!message && !dryRun) {
    die('缺少提交说明。请用 -m "..." 说明改了什么（例如 -m "R1 结果确认"）。');
  }

  const importPath = resolve(process.cwd(), file);
  if (!existsSync(importPath)) die(`找不到导出文件：${importPath}`);

  // 备份，用于失败回滚
  const backup = join(ROOT, '.event-backup.json');
  if (existsSync(SOURCE)) copyFileSync(SOURCE, backup);
  const restore = () => {
    if (existsSync(backup)) {
      copyFileSync(backup, SOURCE);
      unlinkSync(backup);
      console.error(`  ${C.yellow}已回滚 data/event.json 到导入前的状态。${C.reset}`);
    }
  };

  try {
    step(1, TOTAL, '导入变更包');
    if (run('npx', ['tsx', 'scripts/import-event.ts', '--file', importPath]) !== 0) {
      die('导入失败，源文件未被修改。', '若提示「基础版本不一致」，请先 git pull 再重新打开维护工具。');
    }
    ok('已写入 data/event.json');

    step(2, TOTAL, '校验数据');
    if (run('npx', ['tsx', 'scripts/validate-data.ts']) !== 0) {
      restore();
      die('数据校验未通过，已回滚。');
    }
    ok('校验通过');

    step(3, TOTAL, '生成公开快照');
    if (run('npx', ['tsx', 'scripts/build-public-data.ts']) !== 0) {
      restore();
      die('生成公开快照失败，已回滚。');
    }
    ok('已生成 public/data/event.json');

    if (dryRun) {
      console.log(`\n${C.bold}${C.green}预览完成（--dry-run，未提交）。${C.reset}`);
      info(`预览请运行：npm run preview`);
      info(`确认无误后去掉 --dry-run 重新执行即可提交。`);
      if (existsSync(backup)) unlinkSync(backup);
      return;
    }

    step(4, TOTAL, '提交到 Git');
    const status = git(['status', '--porcelain']);
    if (status.out === '') {
      if (existsSync(backup)) unlinkSync(backup);
      console.log(`\n${C.yellow}没有检测到任何改动，无需提交。${C.reset}`);
      return;
    }
    info(status.out.split('\n').slice(0, 10).join('\n  '));
    if (run('git', ['add', 'data/event.json', 'public/data/event.json']) !== 0) {
      restore();
      die('git add 失败，已回滚。');
    }
    if (run('git', ['commit', '-m', message!]) !== 0) {
      restore();
      die('git commit 失败，已回滚。');
    }
    const head = git(['rev-parse', '--short', 'HEAD']);
    ok(`已提交 ${head.out}`);

    if (noPush) {
      if (existsSync(backup)) unlinkSync(backup);
      console.log(`\n${C.bold}${C.green}已提交（--no-push，未推送）。${C.reset}`);
      info('推送请运行：git push');
      return;
    }

    step(5, TOTAL, '推送到 GitHub');
    // 代理偶发 SSL 错误：自动重试最多 4 次
    let pushed = false;
    for (let i = 1; i <= 4; i += 1) {
      if (run('git', ['push', 'origin', 'HEAD']) === 0) {
        pushed = true;
        break;
      }
      if (i < 4) {
        console.log(`  ${C.yellow}第 ${i} 次推送失败（网络/代理），2 秒后重试…${C.reset}`);
        spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['/t', '2', '/nobreak'] : ['2'], { shell: true });
      }
    }
    if (!pushed) {
      if (existsSync(backup)) unlinkSync(backup);
      die(
        '推送失败（已重试 4 次）。提交已在本地，稍后运行 git push 即可。',
        '本次改动没有丢失，只是还没到 GitHub。',
      );
    }
    ok('已推送到 origin');

    if (existsSync(backup)) unlinkSync(backup);

    const remote = git(['config', '--get', 'remote.origin.url']);
    console.log(`\n${C.bold}${C.green}发布流程完成。${C.reset}`);
    console.log('');
    console.log(`  ${C.bold}接下来（自动）${C.reset}`);
    console.log('    GitHub Actions 会校验并部署，通常 1–3 分钟。');
    console.log('');
    console.log(`  ${C.bold}确认观众已看到${C.reset}`);
    console.log('    1. 打开仓库 Actions 页面，等 Deploy to GitHub Pages 变绿');
    console.log('    2. 打开站点，确认底部「数据更新时间」已变化');
    console.log('');
    console.log(`  ${C.dim}仓库：${remote.out}${C.reset}`);
    console.log(`  ${C.yellow}注意：push 成功 ≠ 观众已看到。务必做上面第 2 步。${C.reset}`);
  } catch (error) {
    if (existsSync(backup)) restore();
    throw error;
  }
}

main();
