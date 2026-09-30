/**
 * hash 查询参数读写（筛选条件）。
 *
 * 用 hash 内的查询串（例如 #/schedule?date=2026-10-04&team=competitive-18），
 * 分享后可以恢复，不依赖服务端路由重写。
 */
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type QueryParams = Record<string, string | null>;

/** 解析 location.search（HashRouter 会把 hash 内的查询放进 search）。 */
export function useQueryParams(): {
  params: URLSearchParams;
  setParams: (updates: QueryParams, options?: { replace?: boolean }) => void;
  clearParams: (keys: string[]) => void;
} {
  const location = useLocation();
  const navigate = useNavigate();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const setParams = useCallback(
    (updates: QueryParams, options: { replace?: boolean } = {}) => {
      const next = new URLSearchParams(location.search);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '' },
        // replace 避免每次筛选都产生历史记录，同时保住滚动位置
        { replace: options.replace ?? true, preventScrollReset: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const clearParams = useCallback(
    (keys: string[]) => {
      const next = new URLSearchParams(location.search);
      for (const key of keys) next.delete(key);
      const qs = next.toString();
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true, preventScrollReset: true });
    },
    [location.pathname, location.search, navigate],
  );

  return { params, setParams, clearParams };
}
