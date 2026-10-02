/**
 * 以真实部署前缀托管 dist；未知文件返回 404，不使用 SPA fallback。
 * 应用使用 hash 路由，因此 Pages 不需要服务端路由回退。
 *
 * Vite preview 也支持 base，但启动时会重新读取配置，不会自动继承
 * 之前构建命令的环境变量。独立静态服务让 E2E 明确验证已生成的文件。
 *
 * node scripts/serve-subpath.mjs --base /RG26/ --port 4173 --root dist
 * 也可从 E2E_BASE_URL 推导 base 和 port（Playwright 使用此方式）。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    port: { type: 'string' },
    root: { type: 'string', default: 'dist' },
  },
});
const target = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173/');
const BASE = `/${(values.base ?? target.pathname).replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\//, '/');
const PORT = Number(values.port ?? (target.port || '80'));
const ROOT = resolve(values.root);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('port 必须为 0–65535 的整数');
// 启动前确认入口存在，缺少构建时立即失败，不让 Playwright 等待超时。
await stat(join(ROOT, 'index.html'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) {
    res.writeHead(400).end('bad request');
    return;
  }
  if (BASE !== '/' && pathname === BASE.slice(0, -1)) {
    res.writeHead(301, { location: BASE }).end();
    return;
  }
  if (!pathname.startsWith(BASE)) {
    res.writeHead(404).end('not found');
    return;
  }

  const requested = pathname.slice(BASE.length);
  let filePath = resolve(ROOT, requested);
  const fromRoot = relative(ROOT, filePath);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    }).end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`静态服务：http://127.0.0.1:${server.address().port}${BASE}`);
});
