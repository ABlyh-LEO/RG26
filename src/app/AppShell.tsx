import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { formatDateTime, formatTime } from '../data/view-model';
import { Icon, type IconName } from '../components/Icon';
import { NavigationRestoration } from './NavigationRestoration';

const TABS: { to: string; label: string; icon: IconName; end: boolean }[] = [
  { to: '/', label: '总览', icon: 'home', end: true },
  { to: '/schedule', label: '赛程', icon: 'calendar', end: false },
  { to: '/progress', label: '晋级', icon: 'bracket', end: false },
  { to: '/teams', label: '队伍', icon: 'users', end: false },
];

function CopyVersion({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setManual(true);
    }
  };
  return (
    <span className="data-version">
      <button type="button" className="data-version__copy" title={value} aria-label={`复制${label}完整值`} onClick={() => void copy()}>
        <code>{value.replace(/^sha256:/, '').slice(0, 12)}</code><span>{copied ? '已复制' : '复制'}</span>
      </button>
      {manual ? <input className="input" aria-label={`${label}完整值，选择后复制`} readOnly value={value} onFocus={(event) => event.currentTarget.select()} /> : null}
      <span className="visually-hidden" role="status">{copied ? `${label}已复制` : manual ? '请从下方输入框复制完整值' : ''}</span>
    </span>
  );
}

function DataMetaBar() {
  const { snapshot, contentUpdatedAt, lastSuccessAt, failure, fromCache, refreshing, refresh } = useData();
  return (
    <div className="data-status">
      <details className={`meta-bar${failure ? ' meta-bar--stale' : ''}`}>
        <summary><span className={`connection-dot${failure ? ' connection-dot--offline' : ''}`} /><span>{failure ? '暂时无法更新' : fromCache ? '已加载本机数据' : '赛事数据'}{contentUpdatedAt ? ` · ${formatTime(contentUpdatedAt)} 更新` : ' · 正在连接'}</span><Icon name="info" size={14} /></summary>
        <div className="meta-bar__details">
          <p>赛事数据更新于：<strong>{contentUpdatedAt ? formatDateTime(contentUpdatedAt) : '—'}</strong></p>
          <p>最近成功检查：<strong>{lastSuccessAt ? formatDateTime(lastSuccessAt) : '尚未成功'}</strong></p>
          {snapshot ? <>
            <div className="data-version-row"><span>数据版本：</span><CopyVersion key={snapshot.revision} label="数据版本" value={snapshot.revision} /></div>
            <div className="data-version-row"><span>源代码版本：</span>{snapshot.sourceCommit ? <CopyVersion key={snapshot.sourceCommit} label="源代码版本" value={snapshot.sourceCommit} /> : <span className="muted">尚未关联</span>}</div>
          </> : null}
          <p className="muted">查看期间自动检查更新。比赛状态和成绩以现场确认后发布的数据为准。</p>
          {failure ? <p>{fromCache ? '正在显示本机缓存的数据。' : ''}{failure}</p> : null}
        </div>
      </details>
      <button type="button" className="refresh-button" onClick={refresh} disabled={refreshing} aria-label="立即刷新"><Icon name="refresh" size={15} className={refreshing ? 'is-spinning' : ''} /><span>{refreshing ? '检查中' : '刷新'}</span></button>
    </div>
  );
}

export function AppShell() {
  const { fatal, loading, derived, refresh, updateSummary, dismissUpdate, failure } = useData();
  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); document.getElementById('main')?.focus(); }}>跳到主要内容</a>
      <NavigationRestoration />
      <header className="header"><div className="header__inner">
        <NavLink to="/" className="header__brand" aria-label="RoboGame2026 赛事首页"><span className="brand-mark" aria-hidden="true">R<span>G</span></span><span className="brand-type">ROBOGAME<span className="header__year">2026 <span className="brand-caption">赛事中心</span></span></span></NavLink>
        <nav className="header__nav" aria-label="主导航">{TABS.map((tab) => <NavLink key={tab.to} to={tab.to} end={tab.end} className="header__link"><Icon name={tab.icon} size={17} />{tab.label}</NavLink>)}</nav>
        <NavLink to="/rules" className="header__rules"><Icon name="book" size={18} /><span>规则</span></NavLink>
      </div></header>
      <main className="main" id="main" tabIndex={-1} data-ready={Boolean(derived && !loading)}>
        {fatal && !loading ? <div className="empty error-state"><Icon name="info" size={32} /><h1>暂时无法获取赛事数据</h1><p>请检查网络后重试。获取成功后，这里会显示最新赛程和成绩。</p><button type="button" className="btn btn--primary" onClick={refresh}>重新加载</button></div> : <><DataMetaBar />{failure ? <div className="inline-notice" role="status">正在展示最近一次可用数据，恢复连接后会自动更新。</div> : null}<Outlet /></>}
        <footer className="site-footer"><span>ROBOGAME 2026</span><span>时间均为北京时间 · 现场安排优先</span><NavLink to="/rules">规则与数据来源</NavLink></footer>
      </main>
      {updateSummary ? <div className="update-toast" role="status"><Icon name="check" size={18} /><span>{updateSummary}</span><button type="button" className="btn btn--icon" onClick={dismissUpdate} aria-label="关闭更新提示"><Icon name="close" size={16} /></button></div> : null}
      <nav className="tabbar" aria-label="底部导航">{TABS.map((tab) => <NavLink key={tab.to} to={tab.to} end={tab.end} className="tabbar__link"><Icon name={tab.icon} size={21} /><span>{tab.label}</span></NavLink>)}</nav>
    </div>
  );
}
