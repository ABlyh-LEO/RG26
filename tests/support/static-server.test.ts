import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.each(['/', '/RG26/'])('公开产物静态服务（%s）', (base) => {
  let temporary: string;
  let child: ChildProcessWithoutNullStreams | undefined;
  let origin: string;

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'rg26-static-test-'));
    const root = join(temporary, 'dist');
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, 'data'));
    await mkdir(join(temporary, 'dist-sibling'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>测试公开站点</title>');
    await writeFile(join(root, 'assets', 'app.js'), 'export const ready = true;');
    await writeFile(join(root, 'data', 'event.json'), '{"revision":"fixture"}');
    await writeFile(join(temporary, 'dist-sibling', 'private.txt'), 'outside build');

    const server = spawn(process.execPath, [
      resolve('scripts/serve-subpath.mjs'), '--root', root, '--port', '0',
    ], {
      env: { ...process.env, E2E_BASE_URL: `http://127.0.0.1:4173${base}` },
      stdio: 'pipe',
    });
    child = server;
    origin = await new Promise<string>((res, rej) => {
      let output = '';
      let errors = '';
      const timeout = setTimeout(() => rej(new Error(`静态服务未就绪：${errors}`)), 8_000);
      server.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const address = /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
        if (address) { clearTimeout(timeout); res(address); }
      });
      server.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
      server.on('error', (error) => { clearTimeout(timeout); rej(error); });
      server.on('exit', (code) => { clearTimeout(timeout); rej(new Error(`静态服务退出 ${code}：${errors}`)); });
    });
  });

  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((res) => child!.once('exit', () => res()));
      child.kill();
      await stopped;
    }
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });

  it('首页、模块和带查询参数的数据返回正确内容及 MIME', async () => {
    const home = await fetch(`${origin}${base}`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('测试公开站点');
    const module = await fetch(`${origin}${base}assets/app.js`);
    expect(module.headers.get('content-type')).toContain('javascript');
    expect(await module.text()).toBe('export const ready = true;');
    const data = await fetch(`${origin}${base}data/event.json?revision=test`);
    expect(data.headers.get('content-type')).toContain('application/json');
    expect(await data.json()).toEqual({ revision: 'fixture' });
  });

  it('缺失资源和维护入口返回 404，绝不回退到 HTML', async () => {
    for (const path of ['assets/missing.js', 'data/missing.json', 'operator.html']) {
      const response = await fetch(`${origin}${base}${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.text()).not.toContain('<!doctype');
    }
  });

  it('拒绝编码越界路径和损坏 URL', async () => {
    for (const path of ['..%2fdist-sibling%2fprivate.txt', '..%5cdist-sibling%5cprivate.txt', '%ZZ']) {
      const response = await fetch(`${origin}${base}${path}`);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain('outside build');
    }
  });

  if (base !== '/') {
    it('子路径之外不能访问产物；缺少末尾斜杠时重定向', async () => {
      expect((await fetch(`${origin}/assets/app.js`)).status).toBe(404);
      expect((await fetch(`${origin}/RG26-extra/data/event.json`)).status).toBe(404);
      const redirect = await fetch(`${origin}${base.slice(0, -1)}`, { redirect: 'manual' });
      expect(redirect.status).toBe(301);
      expect(redirect.headers.get('location')).toBe(base);
    });
  }
});
