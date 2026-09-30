/**
 * 数据读取与刷新（docs/IMPLEMENTATION_PLAN.md 第 10.4 节）。
 *
 * 规则：
 * - 用 Vite base 拼接地址，绝不写死 /data/event.json。
 * - 每次读取先 schema 校验，再**一次性**替换前端状态，
 *   不能混用新 results 和旧 seeds。
 * - 可见页面每 60 秒检查一次；回到前台与手动刷新立即检查；
 *   隐藏页面暂停轮询；失败后退避到最多 5 分钟。
 * - 仅在 revision 变化时替换赛事内容；revision 相同但 builtAt/sourceCommit
 *   变化时只更新发布元信息。
 * - 失败时保留最近一次成功快照，并显示“暂时无法更新”与旧快照时间。
 */

export const POLL_INTERVAL_MS = 60_000;
export const MAX_BACKOFF_MS = 300_000;
export const FETCH_TIMEOUT_MS = 12_000;

/** 数据地址：使用 Vite base，支持项目站子路径与自定义域名根目录。 */
export function dataUrl(baseUrl: string = import.meta.env.BASE_URL): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}data/event.json`;
}

export type FetchFailureKind = 'network' | 'timeout' | 'http' | 'parse' | 'schema' | 'aborted';

export class DataFetchError extends Error {
  override readonly name = 'DataFetchError';
  readonly kind: FetchFailureKind;
  readonly status: number | null;

  constructor(kind: FetchFailureKind, message: string, status: number | null = null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** 人类可读的失败说明（UI 直接用）。 */
export function describeFailure(error: unknown): string {
  if (error instanceof DataFetchError) {
    switch (error.kind) {
      case 'network':
        return '网络连接失败，暂时无法获取最新数据。';
      case 'timeout':
        return '获取数据超时，暂时无法更新。';
      case 'http':
        return error.status === 404
          ? '数据文件不存在（404）。如果刚部署过，请稍后再试。'
          : `服务器返回错误（${error.status ?? '未知'}）。`;
      case 'parse':
        return '数据文件格式损坏，无法解析。';
      case 'schema':
        return `数据结构与当前版本不兼容：${error.message}`;
      case 'aborted':
        return '请求已取消。';
    }
  }
  return `发生未知错误：${(error as Error)?.message ?? String(error)}`;
}

/**
 * 拉取公开快照。
 *
 * 使用 `no-cache` 重新验证缓存模式，保留服务器 ETag 能力。
 * 注意：这不能消除托管 CDN 本身的传播延迟。
 */
export async function fetchSnapshot(
  options: { signal?: AbortSignal; url?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ raw: unknown; text: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url ?? dataUrl();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort);

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        cache: 'no-cache',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      if (options.signal?.aborted) throw new DataFetchError('aborted', '请求已取消');
      if ((error as Error)?.name === 'AbortError') throw new DataFetchError('timeout', `获取 ${url} 超时`);
      throw new DataFetchError('network', `无法连接：${(error as Error)?.message ?? String(error)}`);
    }

    if (!response.ok) {
      throw new DataFetchError('http', `HTTP ${response.status}`, response.status);
    }

    const text = await response.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new DataFetchError('parse', `JSON 解析失败：${(error as Error).message}`);
    }
    return { raw, text };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/* ------------------------------------------------------------------ *
 * 本机缓存（不依赖 Service Worker）
 * ------------------------------------------------------------------ */

const CACHE_KEY = 'rg26.snapshot.v1';

export interface CachedSnapshot {
  text: string;
  cachedAt: string;
}

/**
 * 保存最近一次成功的数据快照，用于临时读取失败。
 * 缓存写入失败绝不能影响正常在线浏览。
 */
export function saveCachedSnapshot(text: string, storage: Storage | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ text, cachedAt: new Date().toISOString() } satisfies CachedSnapshot));
    return true;
  } catch {
    // 空间不足或存储被禁用：静默降级
    return false;
  }
}

export function loadCachedSnapshot(storage: Storage | null = safeStorage()): CachedSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSnapshot;
    if (typeof parsed.text !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** localStorage 在隐私模式或被禁用时会抛错；这里安全探测。 */
export function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__rg26_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 轮询调度（退避 + 前后台）
 * ------------------------------------------------------------------ */

export interface PollerOptions {
  intervalMs?: number;
  maxBackoffMs?: number;
  onTick: () => void | Promise<void>;
  /** 用于测试注入。 */
  now?: () => number;
}

/**
 * 轮询器：正常 60 秒一次；连续失败按 2 倍退避至最多 5 分钟；
 * 页面隐藏时暂停；回到前台立即检查并重置退避。
 */
export class SnapshotPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 0;
  private stopped = true;
  private readonly intervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly onTick: () => void | Promise<void>;

  constructor(options: PollerOptions) {
    this.intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
    this.onTick = options.onTick;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 成功：重置退避。 */
  reportSuccess(): void {
    this.backoff = 0;
  }

  /** 失败：指数退避，上限 5 分钟。 */
  reportFailure(): void {
    this.backoff = Math.min(this.backoff === 0 ? this.intervalMs : this.backoff * 2, this.maxBackoffMs);
  }

  /** 立即检查（回到前台或手动刷新）。 */
  async triggerNow(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.onTick();
    if (!this.stopped) this.schedule();
  }

  /** 页面变为不可见时调用。 */
  pause(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 页面重新可见时调用：立即检查。 */
  async resume(): Promise<void> {
    if (this.stopped) return;
    await this.triggerNow();
  }

  private schedule(): void {
    if (this.stopped) return;
    const delay = this.backoff === 0 ? this.intervalMs : this.backoff;
    this.timer = setTimeout(() => {
      this.timer = null;
      void Promise.resolve(this.onTick()).finally(() => this.schedule());
    }, delay);
  }
}
