import { useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQueryParams } from '../app/useQueryParams';
import { useData } from '../data/DataProvider';
import { useEventClock } from '../data/clock';
import { defaultDate, effectiveStart, formatDate, formatTime, todayInEventTz, toQualificationRunView, toSeriesView, toSwissMatchView, type MatchView } from '../data/view-model';
import { EmptyState, MatchCard, OriginalStart, useFollowing } from '../components/ui';
import { Icon } from '../components/Icon';

const STAGES: Record<string, string> = { all: '全部赛段', qualification: '排位赛', swiss: '瑞士轮', finals: '决赛', showcase: '展示组' };

export function SchedulePage() {
  const { derived, loading } = useData();
  const { params, setParams, clearParams } = useQueryParams();
  const { following } = useFollowing();
  const now = useEventClock();
  const dialog = useRef<HTMLDialogElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const availableDates = useMemo(() => derived ? [...new Set([...derived.event.event.dates, ...derived.event.scheduleItems.map((item) => todayInEventTz(new Date(effectiveStart(item))))])].sort() : [], [derived]);
  const date = params.get('date') ?? (derived ? defaultDate({ ...derived.event, event: { ...derived.event.event, dates: availableDates } }, now) : '');
  const stage = params.get('stage') ?? 'all';
  const venue = params.get('venue');
  const teamId = params.get('team');
  const onlyFollowing = params.get('following') === '1';
  // schema 1 的部分表演活动仍存成 match；按参与方式呈现，保留旧数据兼容。
  const activitySeries = useMemo(() => new Map(derived?.event.finals.series
    .filter((series) => !series.countsForStandings && series.stage !== 'showcase' && series.slots === null)
    .map((series) => [series.scheduleItemId, series]) ?? []), [derived]);

  const matchesOfDay: MatchView[] = useMemo(() => {
    if (!derived) return [];
    const { event, teamMap, venueLabels, finals } = derived;
    return [
      ...event.qualification.runs.map((run) => toQualificationRunView(run, event, teamMap, venueLabels)),
      ...event.swiss.matches.map((match) => toSwissMatchView(match, event, teamMap, venueLabels)),
      ...event.finals.series.filter((series) => !activitySeries.has(series.scheduleItemId) && event.scheduleItems.find((item) => item.id === series.scheduleItemId)?.kind !== 'activity').map((series) => toSeriesView(series, event, teamMap, venueLabels, finals)),
    ].filter((match) => match.schedule !== null && todayInEventTz(new Date(effectiveStart(match.schedule))) === date);
  }, [derived, date, activitySeries]);

  if (loading && !derived) return <div className="empty">正在加载赛程…</div>;
  if (!derived) return null;
  const { event, teamMap } = derived;
  const matches = matchesOfDay.filter((match) => (stage === 'all' || match.stage === stage) && (!venue || match.schedule?.venueId === venue) && (!teamId || match.sides?.some((side) => side.team?.id === teamId)) && (!onlyFollowing || match.sides?.some((side) => side.team && following.includes(side.team.id))));
  const activities = event.scheduleItems.filter((item) => todayInEventTz(new Date(effectiveStart(item))) === date && (item.kind === 'activity' || activitySeries.has(item.id)) && (stage === 'all' || item.stage === stage) && (!venue || item.venueId === venue) && (!teamId || item.referenceId === teamId) && (!onlyFollowing || (item.referenceId !== null && following.includes(item.referenceId))));
  const timeline = [
    ...matches.map((match) => ({ kind: 'match' as const, time: effectiveStart(match.schedule!), match })),
    ...activities.map((activity) => ({ kind: 'activity' as const, time: effectiveStart(activity), activity })),
  ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const groups = new Map<string, typeof timeline>();
  for (const item of timeline) groups.set(item.time, [...(groups.get(item.time) ?? []), item]);
  const activeCount = Number(stage !== 'all') + Number(Boolean(venue)) + Number(Boolean(teamId));
  const selectedTeam = teamId ? teamMap.get(teamId)?.displayName : null;
  const selectedVenue = venue ? event.venues.find((item) => item.id === venue)?.label : null;
  const reset = () => clearParams(['stage', 'venue', 'team', 'following']);
  const jumpToCurrent = () => {
    const target = timeline.find((item) => item.kind === 'match' && item.match.executionStatus === 'running') ?? timeline.find((item) => Date.parse(item.time) >= now.getTime()) ?? timeline[0];
    if (target) document.getElementById(`schedule-${target.time}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  };

  return (
    <div className="stack schedule-page">
      <div className="page-head"><div className="eyebrow">MATCH SCHEDULE</div><h1 className="page-head__title">赛程</h1><p className="page-head__sub">找到每一场的时间、场地与对阵。</p></div>
      <div className="schedule-toolbar">
        <div className="segmented" role="group" aria-label="选择日期">{availableDates.map((day, index) => <button key={day} type="button" className="segmented__item" aria-pressed={day === date} onClick={() => setParams({ date: day })}>DAY {index + 1} · {formatDate(`${day}T00:00:00+08:00`)}</button>)}</div>
        <div className="schedule-actions"><button type="button" className="btn btn--small" aria-pressed={onlyFollowing} onClick={() => setParams({ following: onlyFollowing ? null : '1' })}><Icon name="star" size={16} />只看关注</button><button ref={filterTrigger} type="button" className="btn btn--small" onClick={() => dialog.current?.showModal()}><Icon name="filter" size={17} />筛选{activeCount > 0 ? ` ${activeCount}` : ''}</button><button type="button" className="btn btn--small" onClick={jumpToCurrent}><Icon name="clock" size={16} />当前</button></div>
      </div>
      {activeCount > 0 ? <div className="filter-chips">{stage !== 'all' ? <button className="filter-chip" type="button" onClick={() => setParams({ stage: null })}>{STAGES[stage] ?? stage}<Icon name="close" size={13} /></button> : null}{venue ? <button className="filter-chip" type="button" onClick={() => setParams({ venue: null })}>{selectedVenue ?? venue}<Icon name="close" size={13} /></button> : null}{teamId ? <button className="filter-chip" type="button" onClick={() => setParams({ team: null })}>{selectedTeam ?? '所选队伍'}<Icon name="close" size={13} /></button> : null}</div> : null}
      <div className="schedule-summary"><span>{matches.length} 场比赛{activities.length > 0 ? ` · ${activities.length} 项活动` : ''}</span><span>北京时间 · 现场安排优先</span></div>
      <div className="schedule-feed">{[...groups.entries()].map(([time, items]) => <section className="time-group" key={time} id={`schedule-${time}`} aria-label={`${formatTime(time)} 的安排`}><div className="time-group__label"><time dateTime={time}>{formatTime(time)}</time>{items.filter((item) => item.kind === 'match').length > 1 ? <span className="visually-hidden">同时进行</span> : null}</div><div className="time-group__items">{items.map((item) => item.kind === 'match' ? <MatchCard key={item.match.id} match={item.match} showStage /> : <article key={item.activity.id} className="activity-card"><div><strong>{item.activity.kind === 'match' && activitySeries.has(item.activity.id) ? <Link to={`/matches/${activitySeries.get(item.activity.id)!.id}`}>{item.activity.title}</Link> : item.activity.title}</strong><span className="muted">{item.activity.venueId ? derived.venueLabels.get(item.activity.venueId) : '现场活动'}{item.activity.adjustmentNote ? ` · ${item.activity.adjustmentNote}` : ''}</span>{item.activity.revisedStart ? <div className="rescheduled">已改期 · 原定 <OriginalStart schedule={item.activity} /></div> : null}</div><span className="badge badge--neutral">{item.activity.kind === 'match' && activitySeries.has(item.activity.id) ? '表演活动' : STAGES[item.activity.stage] ?? '活动'}</span></article>)}</div></section>)}</div>
      {timeline.length === 0 ? <EmptyState title={onlyFollowing && following.length === 0 ? '还没有关注队伍' : '暂无符合条件的安排'} hint={onlyFollowing && following.length === 0 ? '在队伍页关注你支持的队伍，即可集中查看他们的比赛。' : '试试切换日期，或清除筛选查看完整赛程。'} action={<button type="button" className="btn btn--small" onClick={reset}>查看全部赛程</button>} /> : null}
      <p className="xsmall muted">{event.event.scheduleNotice}</p>
      <dialog ref={dialog} className="filter-dialog" aria-labelledby="schedule-filter-title" onClose={() => filterTrigger.current?.focus({ preventScroll: true })}>
        <div className="filter-dialog__head"><h2 id="schedule-filter-title">筛选赛程</h2><button type="button" className="btn btn--icon" onClick={() => dialog.current?.close()} aria-label="关闭筛选"><Icon name="close" /></button></div>
        <label className="filter-field"><span>赛段</span><select className="select" aria-label="选择赛段" value={stage} onChange={(event) => setParams({ stage: event.target.value === 'all' ? null : event.target.value })}>{Object.entries(STAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="filter-field"><span>场地</span><select className="select" aria-label="选择场地" value={venue ?? ''} onChange={(event) => setParams({ venue: event.target.value || null })}><option value="">全部场地</option>{event.venues.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="filter-field"><span>队伍</span><select className="select" aria-label="选择队伍" value={teamId ?? ''} onChange={(event) => setParams({ team: event.target.value || null })}><option value="">全部队伍</option>{event.teams.map((team) => <option key={team.id} value={team.id}>#{team.number} {team.name}</option>)}</select></label>
        <div className="filter-dialog__actions"><button type="button" className="btn" onClick={reset}>重置筛选</button><button type="button" className="btn btn--primary" onClick={() => dialog.current?.close()}>查看 {timeline.length} 项安排</button></div>
      </dialog>
    </div>
  );
}
