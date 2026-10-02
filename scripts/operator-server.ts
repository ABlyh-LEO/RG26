import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createViteServer } from 'vite';
import { createOperatorApi } from './operator/http';
import { OperatorService } from './operator/service';
import { safeMessage } from './operator/errors';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const service = new OperatorService(ROOT, { pagesUrl: process.env.OPERATOR_PAGES_URL });
await service.initialize();
const api = createOperatorApi(service, ORIGIN);
const server = createServer(async (req, res) => {
  // Vite's source-file middleware must not make persisted private drafts downloadable.
  let path: string;
  try { path = decodeURIComponent(new URL(req.url ?? '/', ORIGIN).pathname); }
  catch { res.writeHead(400).end(); return; }
  if (req.headers.host !== `127.0.0.1:${PORT}` || /(?:^|[/\\])(?:\.local|\.git)(?:[/\\]|$)/i.test(path)) {
    res.writeHead(403).end('forbidden'); return;
  }
  if (await api(req, res)) return;
  vite.middlewares(req, res);
});
const vite = await createViteServer({ root: ROOT, mode: 'operator', appType: 'mpa',
  server: { middlewareMode: true, hmr: { server }, open: false,
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.local/**', '*.{crt,pem}'] } } });
await new Promise<void>((done, fail) => {
  server.once('error', fail);
  server.listen(PORT, '127.0.0.1', () => { server.off('error', fail); done(); });
});
console.log(`\n维护工作台：${ORIGIN}/operator.html\n草稿保存在 .local/operator；确认发布前不会修改正式数据。\n`);
if (process.env.OPERATOR_NO_OPEN !== '1') {
  const url = `${ORIGIN}/operator.html`;
  const command = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] as const
    : process.platform === 'darwin' ? ['open', [url]] as const : ['xdg-open', [url]] as const;
  const opener = spawn(command[0], [...command[1]], { stdio: 'ignore', windowsHide: true });
  opener.on('error', () => console.log('浏览器未自动打开，请访问上面的地址。'));
  opener.unref();
}
let checking = false;
const poll = setInterval(() => {
  if (checking) return;
  checking = true;
  void service.checkPending().catch((error) => console.error(safeMessage(error))).finally(() => { checking = false; });
}, 15_000);
async function stop(): Promise<void> {
  clearInterval(poll);
  await vite.close();
  await service.close();
  server.close(() => process.exit(0));
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
