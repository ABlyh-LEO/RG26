/**
 * 赛事数据上下文：加载、校验、缓存与刷新。
 *
 * 关键行为（第 10.4 节）：
 * - 只在 revision 变化时替换赛事内容，避免列表闪动；
 *   revision 相同但 builtAt/sourceCommit 变化时只更新发布元信息。
 * - 失败时保留最近一次成功快照，展示“暂时无法更新”和旧快照时间。
 * - 首次读取失败且无缓存时显示重试入口。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { publicSnapshotSchema, type PublicSnapshot } from '../domain/schema';
import { deriveEvent, type DerivedEvent } from './view-model';
import {
  DataFetchError,
  SnapshotPoller,
  describeFailure,
  fetchSnapshot,
  loadCachedSnapshot,
  safeStorage,
  saveCachedSnapshot,
} from './snapshot';

export interface DataState {
  /** 当前展示的赛事数据（可能来自缓存）。 */
  snapshot: PublicSnapshot | null;
  derived: DerivedEvent | null;
  /** 首次加载中（没有任何可用数据）。 */
  loading: boolean;
  /** 正在进行一次刷新。 */
  refreshing: boolean;
  /** 最近一次检查失败的原因；null 表示最近一次成功。 */
  failure: string | null;
  /** 当前显示的数据是否来自本机缓存（即最新一次网络检查未成功）。 */
  fromCache: boolean;
  /** 赛事内容最后更新时间（来自数据文件的 contentUpdatedAt）。 */
  contentUpdatedAt: string | null;
  /** 最近一次成功检查的时间。 */
  lastSuccessAt: string | null;
  /** 最近一次尝试检查的时间。 */
  lastAttemptAt: string | null;
  /** 首次失败且无缓存。 */
  fatal: boolean;
  refresh: () => void;
}

const DataContext = createContext<DataState | null>(null);

function isValidSnapshot(raw: unknown): { ok: true; value: PublicSnapshot } | { ok: false; message: string } {
  const parsed = publicSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first && first.path.length > 0 ? first.path.join('.') : '(根)';
    return { ok: false, message: first ? `${path}: ${first.message}` : '结构不符合 schema' };
  }
  return { ok: true, value: parsed.data };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastAttemptAt, setLastAttemptAt] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);

  // 用 ref 保存最新 revision，避免 tick 闭包读到旧值。
  const revisionRef = useRef<string | null>(null);
  const storageRef = useRef<Storage | null>(null);

  useEffect(() => {
    storageRef.current = safeStorage();
  }, []);

  const check = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setLastAttemptAt(new Date().toISOString());
    try {
      const { raw, text } = await fetchSnapshot();
      const result = isValidSnapshot(raw);
      if (!result.ok) {
        throw new DataFetchError('schema', result.message);
      }
      const next = result.value;
      const now = new Date().toISOString();

      // revision 变化才替换赛事内容；否则只更新发布元信息。
      if (revisionRef.current !== next.revision || snapshot === null) {
        revisionRef.current = next.revision;
        setSnapshot(next);
      } else {
        setSnapshot((prev) => (prev === null ? next : { ...prev, builtAt: next.builtAt, sourceCommit: next.sourceCommit }));
      }

      setFailure(null);
      setFromCache(false);
      setFatal(false);
      setLastSuccessAt(now);
      // 缓存写入失败不能影响正常在线浏览
      saveCachedSnapshot(text, storageRef.current);
    } catch (error) {
      setFailure(describeFailure(error));
      if (revisionRef.current === null) {
        // 还没有任何可用数据：尝试缓存
        const cached = loadCachedSnapshot(storageRef.current);
        if (cached) {
          try {
            const parsed = isValidSnapshot(JSON.parse(cached.text));
            if (parsed.ok) {
              revisionRef.current = parsed.value.revision;
              setSnapshot(parsed.value);
              setFromCache(true);
              setFatal(false);
            } else {
              setFatal(true);
            }
          } catch {
            setFatal(true);
          }
        } else {
          setFatal(true);
        }
      } else {
        setFromCache(true);
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [snapshot]);

  // 首次加载：先尝试网络，失败回落到缓存。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 优先立刻显示缓存，减少白屏（随后网络结果会覆盖）。
      const cached = loadCachedSnapshot(storageRef.current ?? safeStorage());
      if (cached && !cancelled) {
        try {
          const parsed = isValidSnapshot(JSON.parse(cached.text));
          if (parsed.ok) {
            revisionRef.current = parsed.value.revision;
            setSnapshot(parsed.value);
            setFromCache(true);
            setLoading(false);
          }
        } catch {
          // 缓存损坏：忽略，等待网络
        }
      }
      await check();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 轮询：可见时 60 秒一次；隐藏时暂停；回到前台立即检查。
  const pollerRef = useRef<SnapshotPoller | null>(null);

  useEffect(() => {
    const poller = new SnapshotPoller({
      onTick: async () => {
        await check();
      },
    });
    pollerRef.current = poller;
    poller.start();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poller.resume();
      } else {
        poller.pause();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      poller.stop();
      pollerRef.current = null;
    };
  }, [check]);

  // 每次检查后告知轮询器成功或失败，以便退避。
  useEffect(() => {
    const poller = pollerRef.current;
    if (!poller) return;
    if (failure === null && lastSuccessAt !== null) poller.reportSuccess();
    else if (failure !== null) poller.reportFailure();
  }, [failure, lastSuccessAt]);

  const refresh = useCallback(() => {
    const poller = pollerRef.current;
    if (poller) {
      void poller.triggerNow();
    } else {
      void check();
    }
  }, [check]);

  const derived = useMemo(() => (snapshot ? deriveEvent(snapshot.data) : null), [snapshot]);

  const value = useMemo<DataState>(
    () => ({
      snapshot,
      derived,
      loading,
      refreshing,
      failure,
      fromCache,
      contentUpdatedAt: snapshot?.data.event.contentUpdatedAt ?? null,
      lastSuccessAt,
      lastAttemptAt,
      fatal,
      refresh,
    }),
    [snapshot, derived, loading, refreshing, failure, fromCache, lastSuccessAt, lastAttemptAt, fatal, refresh],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData 必须在 DataProvider 内使用');
  return ctx;
}

/** 便利钩子：需要已就绪的派生数据时使用；未就绪返回 null。 */
export function useDerived(): DerivedEvent | null {
  return useData().derived;
}
