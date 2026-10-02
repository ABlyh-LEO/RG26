/**
 * 仓库子路径部署验证（第 13.2 节流程 8、第 11.1 节）。
 *
 * GitHub Pages 项目站位于 https://<owner>.github.io/<repo>/ 子路径下。
 * 本脚本完整复现该形态并端到端验证：
 *
 *   1. 用 VITE_BASE_PATH=/<repo>/ 构建
 *   2. 把 dist 放到临时目录的 /<repo>/ 下（模拟 Pages 目录结构）
 *   3. 启动静态服务器
 *   4. 用真实浏览器验证：资源与数据走子路径、深链刷新不 404、无运行时错误
 *   5. 清理全部临时产物
 *
 * 用法：npm run check:subpath
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, existsSync, statSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const FAKE_REPO = 'RG26';
const PORT = 4181;
const TMP = join(ROOT, '.tmp-subpath');
const SERVE_ROOT = join(TMP, 'serve');
const DIST = join(ROOT, 'dist-testrepo');

function cleanTestDirectory(target: string): void {
  const resolved = resolve(target);
  const within = relative(ROOT, resolved);
  if (![TMP, DIST].includes(resolved) || !within || within.startsWith('..') || isAbsolute(within)) throw new Error('测试清理目录超出工作区');
  rmSync(resolved, { recursive: true, force: true });
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures += 1;
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((res, rej) => {
    const child: ChildProcess = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
      stdio: 'ignore',
    });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} 退出码 ${code}`))));
    child.on('error', rej);
  });
}

/** 极简静态文件服务器，避免依赖额外的 http-server 包。 */
function startServer(root: string, port: number): Promise<ReturnType<typeof createServer>> {
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const pathname = decodeURIComponent(url.pathname);
      const requestedPath = pathname.replace(/^\/+/, '');
      let filePath = join(root, requestedPath);

      // 目录请求映射到 index.html（模拟静态托管行为）。
      // 注意：必须先用 statSync 判断，不能对目录调用 readFile。
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, 'index.html');
      }

      // 越界保护
      const within = relative(resolve(root), resolve(filePath));
      if (within.startsWith('..') || isAbsolute(within)) {
        res.writeHead(403).end('forbidden');
        return;
      }

      const body = await readFile(filePath);
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' }).end(body);
    } catch {
      // GitHub Pages 对未知路径返回 404（不是 SPA 回退），这里如实模拟。
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((res) => server.listen(port, '127.0.0.1', () => res(server)));
}

async function main(): Promise<void> {
  console.log(`=== 1. 用子路径 base 构建（/${FAKE_REPO}/） ===`);
  await run('npx', ['vite', 'build', '--outDir', 'dist-testrepo'], { VITE_BASE_PATH: `/${FAKE_REPO}/` });
  check('构建完成', existsSync(join(DIST, 'index.html')));

  console.log('\n=== 2. 模拟 Pages 目录结构 ===');
  cleanTestDirectory(TMP);
  mkdirSync(join(SERVE_ROOT, FAKE_REPO), { recursive: true });
  cpSync(DIST, join(SERVE_ROOT, FAKE_REPO), { recursive: true });
  check(`${FAKE_REPO}/ 下已放置站点`, existsSync(join(SERVE_ROOT, FAKE_REPO, 'index.html')));

  const server = await startServer(SERVE_ROOT, PORT);
  const base = `http://127.0.0.1:${PORT}/${FAKE_REPO}/`;

  const browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM_CHANNEL ? { channel: process.env.E2E_CHROMIUM_CHANNEL } : {}) });
  const page = await browser.newPage();

  const badResponses: string[] = [];
  const runtimeErrors: string[] = [];
  const observed: { url: string; status: number }[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`[${r.status()}] ${r.url()}`);
    if (/\/(data\/|assets\/)/.test(r.url())) observed.push({ url: r.url(), status: r.status() });
  });
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') runtimeErrors.push(m.text());
  });

  try {
    console.log('\n=== 3. 子路径首页加载 ===');
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('main[data-ready="true"]', { timeout: 20_000 });
    check('元信息条可见（数据加载成功）', (await page.locator('.meta-bar').count()) === 1);
    const h1 = await page.locator('h1').first().innerText().catch(() => '');
    check('首页标题渲染', h1.includes('赛场动态'), `h1="${h1}"`);

    console.log('\n=== 4. 所有资源与数据都走子路径 ===');
    const dataReqs = observed.filter((r) => r.url.includes('/data/'));
    check('存在数据请求', dataReqs.length > 0);
    for (const r of observed) {
      check(`子路径请求 ${r.status}`, r.url.includes(`/${FAKE_REPO}/`), r.url);
    }

    console.log('\n=== 5. 深链刷新（hash 路由不应 404） ===');
    await page.goto(`${base}#/teams/competitive-18`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main[data-ready="true"]', { timeout: 20_000 });
    const teamH1 = await page.locator('h1').first().innerText().catch(() => '');
    check('队伍深链首次打开', teamH1.includes('Uniforest'), `h1="${teamH1}"`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('main[data-ready="true"]', { timeout: 20_000 });
    const afterReload = await page.locator('h1').first().innerText().catch(() => '');
    check('深链刷新后仍可用', afterReload.includes('Uniforest'), `h1="${afterReload}"`);

    console.log('\n=== 6. 全部路由在子路径下可用 ===');
    for (const route of ['/', '/schedule', '/progress?view=journey', '/progress?view=qualification', '/progress?view=swiss', '/progress?view=finals', '/teams', '/rules']) {
      await page.goto(`${base}#${route}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('main[data-ready="true"]', { timeout: 20_000 });
      const title = await page.locator('h1').first().innerText().catch(() => '');
      check(`${route} 渲染`, title.length > 0, `h1="${title}"`);
    }

    console.log('\n=== 7. 无失败请求与运行时错误 ===');
    check('没有 4xx/5xx 响应', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));
    check('没有 pageerror / console error', runtimeErrors.length === 0, runtimeErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    await new Promise((res) => server.close(res));
    cleanTestDirectory(TMP);
    cleanTestDirectory(DIST);
  }

  console.log(
    failures === 0
      ? '\n子路径部署验证全部通过（临时产物已清理）。'
      : `\n失败 ${failures} 项。`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
