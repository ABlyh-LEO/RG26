import { describe, expect, it } from 'vitest';
import { verifyPublishedSite } from '../../scripts/verify-pages.mjs';

const revision = 'a'.repeat(32); const commit = 'b'.repeat(40);
const current = { schemaVersion: 1, revision, sourceCommit: commit, data: { event: { name: 'RoboGame2026' } } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function environment(read: (attempt: number) => Response | Promise<Response>) {
  let time = 0; let attempts = 0;
  const requests: { url: string; options: RequestInit | undefined }[] = [];
  const fetcher = async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input); requests.push({ url, options });
    if (new URL(url).pathname.endsWith('/data/event.json')) return read(++attempts);
    return new Response('<!doctype html><title>RoboGame2026</title>');
  };
  const options = { pageUrl: 'https://example.invalid/RG26/', expectedRevision: revision, expectedCommit: commit,
    fetcher, now: () => time, wait: async (milliseconds: number) => { time += milliseconds; },
    timeoutMs: 100, intervalMs: 25, log: () => undefined };
  return { options, requests, attempts: () => attempts, elapsed: () => time };
}

describe('Pages 本次部署核验', () => {
  it('仅接受目标双字段；读取真实子路径且每次请求带 cache-bust', async () => {
    const test = environment(() => json(current));
    expect(await verifyPublishedSite(test.options)).toMatchObject({ revision, sourceCommit: commit, attempts: 1 });
    expect(test.requests.map((request) => new URL(request.url).pathname)).toEqual(['/RG26/', '/RG26/data/event.json']);
    for (const request of test.requests) {
      expect(new URL(request.url).searchParams.get('verify')).toContain(commit);
      expect(request.options?.cache).toBe('no-store');
      expect(request.options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    { ...current, revision: 'c'.repeat(32) },
    { ...current, sourceCommit: 'd'.repeat(40) },
  ])('旧内容或错误提交即使 HTTP 200 / schema 正确也不能假绿', async (snapshot) => {
    const test = environment(() => json(snapshot));
    await expect(verifyPublishedSite(test.options)).rejects.toThrow('未确认本次部署');
    expect(test.elapsed()).toBe(100); expect(test.attempts()).toBe(4);
  });

  it('CDN 短暂503、旧版本及损坏JSON可以重试至本次版本', async () => {
    const test = environment((attempt) => {
      if (attempt === 1) return json(null, 503);
      if (attempt === 2) return json({ ...current, sourceCommit: 'e'.repeat(40) });
      if (attempt === 3) return new Response('invalid-json', { headers: { 'content-type': 'application/json' } });
      return json(current);
    });
    expect(await verifyPublishedSite(test.options)).toMatchObject({ attempts: 4 });
    expect(test.elapsed()).toBe(75);
    expect(new Set(test.requests.filter((request) => new URL(request.url).pathname.endsWith('.json')).map((request) => request.url)).size).toBe(4);
  });

  it('网络错误耗尽预算时失败，不能以最后一次已部署 action 状态代替成功', async () => {
    const test = environment(async () => { throw new Error('network unavailable'); });
    await expect(verifyPublishedSite(test.options)).rejects.toThrow('network unavailable');
    expect(test.elapsed()).toBe(100); expect(test.attempts()).toBe(4);
  });

  it('挂起的请求在剩余总预算内中止', async () => {
    const started = performance.now();
    const fetcher = (_input: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    });
    await expect(verifyPublishedSite({ pageUrl: 'https://example.invalid/', expectedRevision: revision, expectedCommit: commit,
      timeoutMs: 30, intervalMs: 1, fetcher, log: () => undefined })).rejects.toThrow('未确认本次部署');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('构建输出缺失时立即失败，不访问任何远端', async () => {
    const test = environment(() => json(current));
    await expect(verifyPublishedSite({ ...test.options, expectedRevision: '' })).rejects.toThrow('构建目标 revision');
    expect(test.requests).toHaveLength(0);
  });
});
