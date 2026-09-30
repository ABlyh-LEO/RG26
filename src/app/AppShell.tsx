/**
 * 应用外壳：顶部导航 + 手机底部导航 + 数据元信息条 + 路由出口。
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { formatDateTime } from '../data/view-model';

const TABS = [
  { to: '/', label: '总览', icon: '◎', end: true },
  { to: '/schedule', label: '赛程', icon: '▤', end: false },
  { to: '/progress', label: '晋级', icon: '⇗', end: false },
  { to: '/teams', label: '队伍', icon: '⚑', end: false },
] as const;

const DESKTOP_NAV = [
  { to: '/', label: '总览', end: true },
  { to: '/schedule', label: '赛程', end: false },
  { to: '/progress', label: '晋级', end: false },
  { to: '/teams', label: '队伍', end: false },
  { to: '/rules', label: '规则与说明', end: false },
] as const;

function DataMetaBar() {
  const { contentUpdatedAt, lastSuccessAt, failure, fromCache, refreshing, refresh } = useData();
  const stale = failure !== null;

  return (
    <div className={`meta-bar${stale ? ' meta-bar--stale' : ''}`} role="status" aria-live="polite">
      <span>
        赛事数据更新于：<strong>{contentUpdatedAt ? formatDateTime(contentUpdatedAt) : '—'}</strong>
      </span>
      <span>
        最近成功检查：<strong>{lastSuccessAt ? formatDateTime(lastSuccessAt) : '尚未成功'}</strong>
      </span>
      {stale ? (
        <span>
          {fromCache ? '暂时无法更新，正在显示本机缓存的数据。' : '暂时无法更新。'}（{failure}）
        </span>
      ) : null}
      <button type="button" className="btn btn--small" onClick={refresh} disabled={refreshing}>
        {refreshing ? '检查中…' : '立即刷新'}
      </button>
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const { fatal, loading, refresh } = useData();

  return (
    <div className="shell">
      <header className="header">
        <div className="header__inner">
          <NavLink to="/" className="header__brand">
            RoboGame<span className="header__year">2026</span>
            <span className="visually-hidden">赛事赛程与结果</span>
          </NavLink>
          <nav className="header__nav" aria-label="主导航">
            {DESKTOP_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="header__link">
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="header__menu">
            <NavLink to="/rules" className="header__link" aria-label="规则与说明">
              规则
            </NavLink>
          </div>
        </div>
      </header>

      <main className="main" id="main">
        {fatal && !loading ? (
          <div className="card">
            <h1 className="page-head__title">无法获取赛事数据</h1>
            <p className="muted">
              首次读取失败，且本机没有可用缓存。请检查网络后重试；如果刚部署过，请稍候片刻。
            </p>
            <button type="button" className="btn btn--primary" onClick={refresh}>
              重试
            </button>
          </div>
        ) : (
          <>
            <DataMetaBar />
            <Outlet />
          </>
        )}
      </main>

      <nav className="tabbar" aria-label="底部导航">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className="tabbar__link"
            aria-current={isActive(location.pathname, tab.to, tab.end) ? 'page' : undefined}
          >
            <span className="tabbar__icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function isActive(pathname: string, to: string, end: boolean): boolean {
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}
