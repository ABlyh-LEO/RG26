import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryParams } from '../app/useQueryParams';
import { useData } from '../data/DataProvider';
import { useEventClock } from '../data/clock';
import { deriveTeamJourney, effectiveStart, formatDate, formatTime } from '../data/view-model';
import { EmptyState, FollowButton, NameReviewBadge, TeamName, useFollowing } from '../components/ui';
import { Icon } from '../components/Icon';

export function TeamsPage() {
  const { derived, loading } = useData();
  const { params, setParams } = useQueryParams();
  const { following } = useFollowing();
  const now = useEventClock();
  const query = params.get('q') ?? '';
  const division = params.get('division') ?? 'all';
  const onlyFollowing = params.get('following') === '1';
  const filtered = useMemo(() => {
    if (!derived) return [];
    const value = query.trim().toLowerCase();
    return derived.event.teams.filter((team) => (division === 'all' || team.division === division) && (!onlyFollowing || following.includes(team.id)) && (!value || team.name.toLowerCase().includes(value) || String(team.number) === value || team.id.toLowerCase().includes(value))).sort((a, b) => a.division === b.division ? a.number - b.number : a.division === 'competitive' ? -1 : 1);
  }, [derived, division, onlyFollowing, following, query]);
  if (loading && !derived) return <div className="empty">正在加载队伍…</div>;
  if (!derived) return null;
  const competitiveCount = derived.event.teams.filter((team) => team.division === 'competitive').length;

  return <div className="stack">
    <div className="page-head"><div className="eyebrow">MEET THE TEAMS</div><h1 className="page-head__title">队伍</h1><p className="page-head__sub">{competitiveCount} 支竞技队伍 · {derived.event.teams.length - competitiveCount} 支展示队伍。找到你支持的那一队。</p></div>
    <div className="teams-toolbar">
      <div className="search-field"><Icon name="search" size={18} /><label className="visually-hidden" htmlFor="team-search">搜索队伍</label><input id="team-search" className="input" type="search" placeholder="搜索队名或编号…" value={query} onChange={(event) => setParams({ q: event.target.value || null }, { replace: true })} /></div>
      <button type="button" className="btn" aria-pressed={onlyFollowing} onClick={() => setParams({ following: onlyFollowing ? null : '1' })}><Icon name="star" size={17} />我的关注{following.length > 0 ? ` ${following.length}` : ''}</button>
      <div className="segmented" role="group" aria-label="选择组别">{[['all', '全部'], ['competitive', '竞技组'], ['showcase', '展示组']].map(([key, label]) => <button key={key} type="button" className="segmented__item" aria-pressed={division === key} onClick={() => setParams({ division: key === 'all' ? null : key! })}>{label}</button>)}</div>
    </div>
    <div className="schedule-summary"><span>{filtered.length} 支队伍</span><span>关注会保存在当前浏览器</span></div>
    {filtered.length === 0 ? <EmptyState title={onlyFollowing && following.length === 0 ? '为你支持的队伍点亮星标' : '没有找到这支队伍'} hint="可以按队名或编号搜索，也可以查看全部参赛队伍。" action={<button className="btn btn--small" type="button" onClick={() => setParams({ following: null, q: null, division: null })}>查看全部队伍</button>} /> : null}
    <div className="teams-grid">{filtered.map((team) => {
      const journey = deriveTeamJourney(derived, team.id, now);
      const next = journey?.nextMatch;
      return <article key={team.id} className="card team-card"><div className="team-card__top"><div className="team-card__identity"><span className="team-avatar">{team.number.toString().padStart(2, '0')}</span><div style={{ minWidth: 0 }}><TeamName team={team} fallback={team.id} /><div className="team-card__caption">{team.division === 'showcase' ? '展示组' : '竞技组'}{journey?.standingsEntry ? ` · ${journey.standingsEntry.record}` : ''}</div></div></div><FollowButton teamId={team.id} teamName={team.name} compact /></div><div className="row"><span className={`badge ${journey?.status === 'champion' || journey?.status === 'advanced' ? 'badge--advanced' : 'badge--neutral'}`}>{journey?.statusLabel ?? '等待开赛'}</span><NameReviewBadge team={team} /></div><div className="team-card__next"><span>{next?.schedule ? `${formatDate(effectiveStart(next.schedule))} ${formatTime(effectiveStart(next.schedule))} · ${next.venueLabel ?? '场地待定'}` : team.division === 'showcase' ? '查看预演与演出安排' : '下一场对阵待公布'}</span><Link to={`/teams/${team.id}`} aria-label={`查看${team.name}队伍详情`}><Icon name="arrow" size={17} /></Link></div></article>;
    })}</div>
  </div>;
}

export { FollowButton };
