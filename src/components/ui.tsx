import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ScheduleItem, Team } from '../domain/schema';
import type { Side } from '../domain/sides';
import { effectiveStart, formatDate, formatTime, todayInEventTz, type MatchView } from '../data/view-model';
import { Icon } from './Icon';

export function SideBadge({ side }: { side: Side }) {
  return <span className={`badge ${side === 'red' ? 'badge--danger' : 'badge--info'} side-badge`} title={side === 'red' ? '红方' : '蓝方'} aria-label={side === 'red' ? '红方' : '蓝方'}>{side === 'red' ? '红' : '蓝'}</span>;
}

export function TeamName({ team, fallback, className = '', linkTo = true }: { team: Team | null; fallback: string; className?: string; linkTo?: boolean }) {
  const name = team?.name ?? fallback;
  const content = <span className={`team-name${!team ? ' muted' : ''}${name.length > 8 ? ' team-name--long' : ''} ${className}`} title={name}>{name}</span>;
  return team && linkTo ? <Link to={`/teams/${team.id}`} className="team-link">{content}</Link> : content;
}

export function TeamNumberBadge({ team }: { team: Team }) {
  return <span className="team-number" aria-label={`队伍编号 ${team.number}`}>#{team.number}</span>;
}

export function NameReviewBadge({ team }: { team: Team }) {
  return team.nameVerified ? null : <span className="badge badge--pending" title={team.nameNote ?? '队名待核对'}>队名待核对</span>;
}

export function StatusBadge({ status }: { status: MatchView['executionStatus'] }) {
  const map: Record<MatchView['executionStatus'], { label: string; cls: string }> = {
    scheduled: { label: '未开始', cls: 'badge--neutral' },
    ready: { label: '准备中', cls: 'badge--info' },
    running: { label: '进行中', cls: 'badge--live' },
    finished: { label: '已结束', cls: 'badge--neutral' },
    delayed: { label: '延迟', cls: 'badge--pending' },
    cancelled: { label: '已取消', cls: 'badge--danger' },
    'not-needed': { label: '不需要进行', cls: 'badge--neutral' },
  };
  const item = map[status];
  return <span className={`badge ${item.cls}`}>{status === 'running' ? <span className="live-dot" /> : null}{item.label}</span>;
}

export function ResultBadge({ status }: { status: MatchView['resultStatus'] }) {
  if (status === 'confirmed') return <span className="badge badge--advanced">已确认</span>;
  if (status === 'provisional') return <span className="badge badge--pending">待确认成绩</span>;
  return null;
}

export function PublicationBadge({ status }: { status: 'draft' | 'published' | 'superseded' }) {
  return <span className={`badge ${status === 'published' ? 'badge--advanced' : status === 'superseded' ? 'badge--danger' : 'badge--pending'}`}>{status === 'published' ? '已公布' : status === 'superseded' ? '已作废' : '未公布'}</span>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty__icon"><Icon name="calendar" size={24} /></span><div className="empty__title">{title}</div>{hint ? <p className="empty__hint">{hint}</p> : null}{action}</div>;
}

/** 跨日改期同时保留原日期，避免两个相同钟点造成误解。 */
export function OriginalStart({ schedule }: { schedule: ScheduleItem }) {
  const crossedDay = todayInEventTz(new Date(schedule.plannedStart)) !== todayInEventTz(new Date(effectiveStart(schedule)));
  return <s>{crossedDay ? `${formatDate(schedule.plannedStart)} ` : ''}{formatTime(schedule.plannedStart)}</s>;
}

export function MatchCard({ match, showStage = false, showDate = false }: { match: MatchView; showStage?: boolean; showDate?: boolean }) {
  const schedule = match.schedule;
  const time = schedule ? effectiveStart(schedule) : null;
  const [home, away] = match.sides ?? [null, null];
  const isRun = match.kind === 'run';
  const isShowcase = match.stage === 'showcase';
  const duplicatePending = !isRun && !home?.team && !away?.team && home?.sourceLabel === away?.sourceLabel;
  const stage = match.stage === 'swiss' ? `瑞士轮 R${match.roundIndex}` : match.stage === 'qualification' ? `排位 R${match.roundIndex}` : match.stage === 'finals' ? '决赛' : '展示组';
  const href = isRun ? (home?.team ? `/teams/${home.team.id}` : null) : `/matches/${match.id}`;

  return (
    <article className={`match-card card${match.executionStatus === 'running' ? ' match-card--live' : ''}${match.resultStatus === 'confirmed' ? ' match-card--done' : ''}`} data-match-id={match.id}>
      <div className="match-card__head">
        <div className="match-card__time"><time className="tabular" dateTime={time ?? undefined}>{time ? formatTime(time) : '待定'}</time>{showDate && time ? <span className="xsmall muted">{formatDate(time)}</span> : null}{schedule?.revisedStart ? <span className="rescheduled">已改期 <OriginalStart schedule={schedule} /></span> : null}</div>
        <StatusBadge status={match.executionStatus} />
      </div>
      <div className="match-card__context">
        {/* 全局比赛编号：排位赛 1–44、瑞士轮 45–77、决赛 78–91。展示演出/表演赛没有编号。 */}
        {match.matchNo !== null ? <span className="match-card__no tabular">第 {match.matchNo} 场</span> : null}
        {match.venueLabel ? <span><Icon name="pin" size={13} />{match.venueLabel}</span> : null}{showStage ? <span>{stage}</span> : null}<span>{isShowcase ? '单队展示' : isRun ? '单队跑图' : match.format}</span></div>
      <div className="match-card__sides">
        {isShowcase ? <div className="match-side"><div className="match-side__name"><TeamName team={home?.team ?? null} fallback={home?.sourceLabel ?? '演出队伍待抽签'} /></div></div> : <SideRow side={home} sideColor={match.sidesInfo?.first ?? null} />}
        {!isRun && !isShowcase && !duplicatePending ? <SideRow side={away} sideColor={match.sidesInfo?.second ?? null} /> : null}
        {!home && !isShowcase ? <span className="muted small">对阵待公布</span> : null}
      </div>
      {!isShowcase && (match.format === 'BO3' || match.format === 'BO2') && match.homeWins !== null && match.awayWins !== null && (match.homeWins + match.awayWins > 0 || match.resultStatus !== 'none') ? <div className="match-card__series">系列赛 <strong className="tabular">{match.homeWins} : {match.awayWins}</strong>{match.notNeededGames.length > 0 ? <span> · 第 {match.notNeededGames.join('、')} 局不需要进行</span> : null}</div> : null}
      {schedule?.adjustmentNote ? <p className="match-card__notice">{schedule.adjustmentNote}</p> : null}
      {match.conflicts.length > 0 ? <p className="match-card__notice">赛果正在复核，请以现场公布为准。<span className="visually-hidden">{match.conflicts[0]}</span></p> : null}
      <div className="match-card__footer">{isShowcase ? <span className="xsmall muted">不计竞技排名</span> : <ResultBadge status={match.resultStatus} />}{href ? <Link to={href} className="match-card__open" aria-label={`${isRun ? '查看队伍' : isShowcase ? '查看演出' : '查看比赛'}详情：${match.title}`}>{isRun ? '队伍赛程' : isShowcase ? '演出详情' : '比赛详情'}<Icon name="arrow" size={15} /></Link> : null}</div>
    </article>
  );
}

function SideRow({ side, sideColor }: { side: { team: Team | null; sourceLabel: string; score: string | null; seconds?: string | null; isWinner: boolean } | null; sideColor: Side | null }) {
  if (!side) return null;
  return <div className={`match-side${side.isWinner ? ' match-side--winner' : ''}`}>
    <div className="match-side__name">{sideColor ? <SideBadge side={sideColor} /> : null}<TeamName team={side.team} fallback={side.sourceLabel} />{side.isWinner ? <span className="winner-mark" aria-label="胜者"><Icon name="check" size={16} /></span> : null}</div>
    <div className="match-side__result">{side.score !== null ? <strong className="tabular">{side.score}<span className="visually-hidden"> 分</span></strong> : null}{side.seconds ? <span className="tabular xsmall muted">{side.seconds} 秒</span> : null}</div>
  </div>;
}

const FOLLOW_KEY = 'rg26.following.v1';
type FollowingSnapshot = { following: string[]; storageAvailable: boolean };
const serverFollowing: FollowingSnapshot = { following: [], storageAvailable: true };
let followingState = serverFollowing;
let followingLoaded = false;
const followingListeners = new Set<() => void>();

function loadFollowing() {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FOLLOW_KEY) ?? '[]');
    const following = Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string'))] : [];
    if (JSON.stringify(following) !== JSON.stringify(followingState.following) || !followingState.storageAvailable) followingState = { following, storageAvailable: true };
  } catch { followingState = { ...followingState, storageAvailable: false }; }
  followingLoaded = true;
}
function followingSnapshot() {
  if (!followingLoaded && typeof window !== 'undefined') loadFollowing();
  return followingState;
}
function syncFollowing(event: StorageEvent) {
  if (event.key !== null && event.key !== FOLLOW_KEY) return;
  loadFollowing();
  for (const listener of followingListeners) listener();
}
function subscribeFollowing(listener: () => void) {
  if (followingListeners.size === 0) window.addEventListener('storage', syncFollowing);
  followingListeners.add(listener);
  return () => {
    followingListeners.delete(listener);
    if (followingListeners.size === 0) window.removeEventListener('storage', syncFollowing);
  };
}
function toggleFollowing(teamId: string) {
  const current = followingSnapshot();
  const following = current.following.includes(teamId) ? current.following.filter((id) => id !== teamId) : [...current.following, teamId];
  let storageAvailable = true;
  try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(following)); } catch { storageAvailable = false; }
  followingState = { following, storageAvailable };
  for (const listener of followingListeners) listener();
}
export function useFollowing() {
  const snapshot = useSyncExternalStore(subscribeFollowing, followingSnapshot, () => serverFollowing);
  return { ...snapshot, toggle: toggleFollowing };
}

export function FollowButton({ teamId, compact = false, teamName }: { teamId: string; compact?: boolean; teamName?: string }) {
  const { following, toggle, storageAvailable } = useFollowing();
  const active = following.includes(teamId);
  return <span className="follow-control"><button type="button" className={`btn ${compact ? 'btn--icon' : 'btn--small'} follow-button`} aria-pressed={active} aria-label={`${active ? '取消关注' : '关注'}${teamName ?? '该队'}`} title={active ? '取消关注' : '关注队伍'} onClick={() => toggle(teamId)}><Icon name="star" size={18} />{compact ? null : active ? '已关注' : '关注该队'}</button>{!storageAvailable ? <span className="xsmall muted" role="status">本机存储不可用，关注仅在本次浏览有效。</span> : null}</span>;
}

export function CopyLinkButton({ label = '复制链接', path }: { label?: string; path?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [manual, setManual] = useState('');
  const onCopy = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}${path ? `#${path}` : window.location.hash}`;
    setManual(url);
    try { await navigator.clipboard.writeText(url); setState('ok'); } catch { setState('fail'); }
  }, [path]);
  return <span className="copy-control"><button type="button" className="btn btn--small" onClick={() => void onCopy()}><Icon name={state === 'ok' ? 'check' : 'share'} size={16} />{state === 'ok' ? '已复制' : label}</button>{state === 'fail' ? <label className="xsmall muted">请复制下方链接：<input className="input" readOnly value={manual} onFocus={(event) => event.currentTarget.select()} /></label> : null}<span className="visually-hidden" role="status">{state === 'ok' ? '链接已复制' : ''}</span></span>;
}

export function BackButton({ fallback = '/schedule', label = '返回' }: { fallback?: string; label?: string }) {
  const navigate = useNavigate();
  return <button className="back-link" type="button" onClick={() => { if (typeof window.history.state?.idx === 'number' && window.history.state.idx > 0) void navigate(-1); else void navigate(fallback); }}><Icon name="back" size={17} />{label}</button>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="section"><div className="section__head"><h2 className="section__title">{title}</h2>{action}</div>{children}</section>;
}
