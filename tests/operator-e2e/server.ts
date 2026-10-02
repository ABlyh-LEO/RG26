/** Real local API + shared UI, backed exclusively by a disposable repository. */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { buildSeedEvent } from '../../scripts/seed-data';
import { eventFileSchema } from '../../src/domain/schema';
import { OperatorService } from '../../scripts/operator/service';
import { createOperatorApi } from '../../scripts/operator/http';
import { revision } from '../../scripts/operator/storage';

const ROOT = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'rg26-operator-e2e-'));
const repo = join(temporary, 'repo'); const remote = join(temporary, 'remote.git');
await mkdir(join(repo, 'data'), { recursive: true }); await mkdir(join(repo, 'public/data'), { recursive: true });
const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${repo.replaceAll('\\', '/')}`, ...args], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
const event = eventFileSchema.parse(buildSeedEvent('2026-10-02T12:00:00+08:00'));
const series = event.finals.series.find((s) => s.format === 'BO3')!;
series.participantSnapshot = ['competitive-1', 'competitive-2'];
await writeFile(join(repo, 'data/event.json'), JSON.stringify(event, null, 2));
await writeFile(join(repo, 'public/data/event.json'), JSON.stringify({ schemaVersion: 1, revision: 'test', data: event }));
await writeFile(join(repo, '.gitignore'), '.local/\n');
git('init', '-b', 'main'); git('config', 'user.name', 'Operator E2E'); git('config', 'user.email', 'operator-test@example.invalid');
git('add', '.'); git('commit', '-m', 'isolated fixture');
execFileSync('git', ['init', '--bare', remote], { windowsHide: true, stdio: 'ignore' });
git('remote', 'add', 'origin', remote); git('push', '-u', 'origin', 'main');
const origin = 'http://127.0.0.1:5399';
const options = { pagesUrl: `${origin}/public-test/`, readJson: async (url: string) => {
  const response = await fetch(url); return { status: response.status, data: await response.json() as unknown };
} };
let service = new OperatorService(repo, options);
await service.initialize(); let api = createOperatorApi(service, origin);
const vite = await createViteServer({ root: ROOT, mode: 'operator', appType: 'mpa', server: { middlewareMode: true, hmr: false, open: false } });
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', origin).pathname;
  if (request.headers.host !== '127.0.0.1:5399') { response.writeHead(403).end(); return; }
  if (path === '/__test/state') {
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ source: await hash(join(repo, 'data/event.json')),
      snapshot: await hash(join(repo, 'public/data/event.json')), head: git('rev-parse', 'HEAD'), index: git('write-tree') })); return;
  }
  if (path === '/public-test/data/event.json') {
    const source = await service.source();
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ schemaVersion: 1, data: source.event,
      revision: revision(source.event), builtAt: new Date().toISOString(), sourceCommit: source.commit })); return;
  }
  if (request.method === 'POST' && (path === '/__test/reset' || path === '/__test/restart')) {
    await service.close();
    if (path.endsWith('reset')) {
      // Restore the original fixture after tests that deliberately publish to the disposable remote.
      await writeFile(join(repo, 'data/event.json'), JSON.stringify(event, null, 2));
      await writeFile(join(repo, 'public/data/event.json'), JSON.stringify({ schemaVersion: 1, revision: 'test', data: event }));
      if (git('status', '--porcelain')) { git('add', 'data/event.json', 'public/data/event.json'); git('commit', '-m', 'reset isolated fixture'); git('push', 'origin', 'main'); }
      const jobsPath = resolve(repo, '.local/operator/jobs');
      if (jobsPath.startsWith(resolve(temporary))) await rm(jobsPath, { recursive: true, force: true });
      const source = await service.source();
      await writeFile(join(repo, '.local/operator/draft.json'), JSON.stringify({ schemaVersion: 1, baseEvent: source.event, preview: null,
        draft: { version: 1, baseRevision: source.revision, baseCommit: source.commit, event: source.event, formInputs: {}, logs: [], dirty: false,
          updatedAt: new Date().toISOString(), migrationRequiresReview: false } }));
    }
    service = new OperatorService(repo, options); await service.initialize(); api = createOperatorApi(service, origin);
    response.writeHead(200).end('ok'); return;
  }
  if (await api(request, response)) return;
  vite.middlewares(request, response);
});
server.listen(5399, '127.0.0.1');
const checkTimer = setInterval(() => { void service.checkPending().catch(() => undefined); }, 1200);
async function stop() {
  clearInterval(checkTimer);
  await service.close(); await vite.close(); server.close();
  const resolved = resolve(temporary);
  if (resolved.startsWith(resolve(tmpdir())) && resolved.includes('rg26-operator-e2e-')) await rm(resolved, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
