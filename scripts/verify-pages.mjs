/** Verify the exact artifact after Pages deployment; an older valid snapshot is not success. */
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyPublishedSite({
  pageUrl, expectedRevision, expectedCommit,
  timeoutMs = 180_000, intervalMs = 5_000,
  fetcher = fetch, now = () => performance.now(), wait = delay, log = console.log,
}) {
  if (!/^[a-f0-9]{32}$/.test(expectedRevision ?? '')) throw new Error('缺少有效的构建目标 revision');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedCommit ?? '')) throw new Error('缺少有效的目标提交 SHA');
  const base = new URL(pageUrl);
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Pages 地址必须是不含凭据的 HTTPS URL');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000 || !Number.isFinite(intervalMs) || intervalMs < 1) {
    throw new Error('部署核验的等待上限必须在 1–180000 ms 内');
  }
  base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const deadline = now() + timeoutMs;
  let attempts = 0; let lastError = '尚未取得公开版本';
  while (now() < deadline) {
    attempts += 1;
    const home = new URL(base); const data = new URL('data/event.json', base);
    const nonce = `${expectedCommit}-${Date.now()}-${attempts}`;
    home.searchParams.set('verify', nonce); data.searchParams.set('verify', nonce);
    const signal = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(10_000, deadline - now()))));
    const options = { signal, cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'RG26-Pages-verifier' } };
    try {
      const [html, snapshot] = await Promise.all([
        fetcher(home.href, options).then(async (response) => {
          if (!response.ok) throw new Error(`首页 HTTP ${response.status}`);
          const html = await response.text();
          if (!html.includes('RoboGame2026')) throw new Error('首页未返回赛事入口');
          return html;
        }),
        fetcher(data.href, options).then(async (response) => {
          if (!response.ok) throw new Error(`公开快照 HTTP ${response.status}`);
          if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('公开快照未返回 JSON');
          return response.json();
        }),
      ]);
      if (!html || snapshot?.schemaVersion !== 1 || !snapshot.data || typeof snapshot.data !== 'object') throw new Error('公开快照结构不完整');
      if (snapshot.revision !== expectedRevision || snapshot.sourceCommit !== expectedCommit) {
        throw new Error(`公开版本尚未匹配：revision=${String(snapshot.revision)}, sourceCommit=${String(snapshot.sourceCommit)}`);
      }
      log(`部署已核验：revision=${snapshot.revision}，sourceCommit=${snapshot.sourceCommit}（第 ${attempts} 次检查）。`);
      return { attempts, revision: snapshot.revision, sourceCommit: snapshot.sourceCommit };
    } catch (error) {
      lastError = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]/g, ' ').slice(0, 300);
      log(`第 ${attempts} 次核验未通过：${lastError}`);
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(intervalMs, remaining));
  }
  throw new Error(`在 ${timeoutMs / 1000} 秒内未确认本次部署。${lastError}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await verifyPublishedSite({ pageUrl: process.env.PAGE_URL, expectedRevision: process.env.EXPECTED_REVISION,
      expectedCommit: process.env.GITHUB_SHA });
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
