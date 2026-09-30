/**
 * 赛程页：某天、某队、某场地何时比赛。
 *
 * 筛选写入 hash 查询参数，分享后可恢复；点击筛选不使列表跳回顶部。
 */
import { useMemo } from 'react';
import { useQueryParams } from '../app/useQueryParams';
import { useData } from '../data/DataProvider';
import {
  defaultDate,
  formatDate,
  formatTime,
  type MatchView,
} from '../data/view-model';
import { toSeriesView, toSwissMatchView } from '../data/view-model';
import { EmptyState, MatchCard, TeamName } from '../components/ui';

const STAGE_LABELS: Record<string, string> = {
  all: '全部',
  qualification: '排位赛',
  swiss: '瑞士轮',
  finals: '决赛',
  showcase: '展示组',
};

export function SchedulePage() {
  const { derived, loading } = useData();
  const { params, setParams } = useQueryParams();
  const now = useMemo(() => new Date(), []);

  const date = params.get('date') ?? (derived ? defaultDate(derived.event, now) : '');
  const stage = params.get('stage') ?? 'all';
  const venue = params.get('venue');
  const teamId = params.get('team');

  // 组装当天全部比赛视图（瑞士轮 + 决赛系列赛）
  // hook 必须在提前 return 之前调用。
  const matchesOfDay: MatchView[] = useMemo(() => {
    if (!derived) return [];
    const { event, teamMap, venueLabels } = derived;
    const swiss = event.swiss.matches.map((m) => toSwissMatchView(m, event, teamMap, venueLabels));
    const series = event.finals.series.map((s) => toSeriesView(s, event, teamMap, venueLabels, derived.finals));
    return [...swiss, ...series].filter((m) => m.schedule?.date === date);
  }, [derived, date]);

  if (loading && !derived) return <div className="empty">正在加载赛程…</div>;
  if (!derived) return null;

  const { event, teamMap } = derived;

  const filtered = matchesOfDay.filter((m) => {
    if (stage !== 'all' && m.stage !== stage) return false;
    if (venue && m.schedule?.venueId !== venue) return false;
    if (teamId && !m.sides?.some((s) => s.team?.id === teamId)) return false;
    return true;
  });

  const activities = event.scheduleItems
    .filter((s) => s.date === date && s.kind === 'activity')
    .filter((s) => {
      if (stage !== 'all' && s.stage !== stage) return false;
      if (venue && s.venueId !== venue) return false;
      if (teamId) {
        // 活动与队伍有关时（展示组预演）按 referenceId 匹配
        if (s.referenceId !== teamId) return false;
      }
      return true;
    })
    .sort((a, b) => Date.parse(a.plannedStart) - Date.parse(b.plannedStart));

  // 合并比赛与活动成一条时间线
  const timeline = [
    ...filtered.map((m) => ({ kind: 'match' as const, time: m.schedule!.plannedStart, match: m })),
    ...activities.map((a) => ({ kind: 'activity' as const, time: a.plannedStart, activity: a })),
  ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

  const hasAnyFilter = stage !== 'all' || venue !== null || teamId !== null;

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="page-head">
        <h1 className="page-head__title">赛程</h1>
        <p className="page-head__sub">时间均为赛事时区（{event.event.timezone}）。{event.event.scheduleNotice}</p>
      </div>

      {/* 日期切换 */}
      <div className="segmented" role="group" aria-label="选择日期">
        {event.event.dates.map((d) => (
          <button
            key={d}
            type="button"
            className="segmented__item"
            aria-pressed={d === date}
            onClick={() => setParams({ date: d })}
          >
            {formatDate(`${d}T00:00:00+08:00`)}
          </button>
        ))}
      </div>

      {/* 赛段筛选 */}
      <div className="segmented" role="group" aria-label="选择赛段">
        {Object.entries(STAGE_LABELS).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="segmented__item"
            aria-pressed={key === stage}
            onClick={() => setParams({ stage: key === 'all' ? null : key })}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 场地筛选 */}
      {event.venues.length > 0 ? (
        <div className="segmented" role="group" aria-label="选择场地">
          <button
            type="button"
            className="segmented__item"
            aria-pressed={venue === null}
            onClick={() => setParams({ venue: null })}
          >
            全部场地
          </button>
          {event.venues.map((v) => (
            <button
              key={v.id}
              type="button"
              className="segmented__item"
              aria-pressed={venue === v.id}
              onClick={() => setParams({ venue: v.id })}
            >
              {v.label}
              {v.provisionalName ? '*' : ''}
            </button>
          ))}
        </div>
      ) : null}

      {/* 已选队伍提示 */}
      {teamId ? (
        <div className="card" style={{ padding: 'var(--sp-3)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small">
              正在筛选：<TeamName team={teamMap.get(teamId)?.team ?? null} fallback={teamId} />
            </span>
            <button type="button" className="btn btn--small" onClick={() => setParams({ team: null })}>
              清除
            </button>
          </div>
        </div>
      ) : null}

      {hasAnyFilter && filtered.length === 0 && activities.length === 0 ? (
        <EmptyState title="该筛选没有结果" hint="试试切换日期、赛段，或清除筛选条件。" />
      ) : null}

      {/* 时间线 */}
      <div className="stack">
        {timeline.map((item) =>
          item.kind === 'match' ? (
            <MatchCard key={item.match.id} match={item.match} showStage />
          ) : (
            <div key={item.activity.id} className="card" style={{ padding: 'var(--sp-3)' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                <strong className="tabular small" style={{ flexShrink: 0 }}>
                  {formatTime(item.activity.plannedStart)}
                  {item.activity.plannedEnd ? `–${formatTime(item.activity.plannedEnd)}` : ''}
                </strong>
                <span className="badge badge--neutral">
                  {STAGE_LABELS[item.activity.stage] ?? item.activity.stage}
                </span>
              </div>
              <div className="small" style={{ marginTop: 'var(--sp-1)', overflowWrap: 'anywhere' }}>
                {item.activity.title}
              </div>
              {item.activity.adjustmentNote ? (
                <div className="xsmall" style={{ marginTop: 'var(--sp-1)', color: 'var(--pending)' }}>
                  调整说明：{item.activity.adjustmentNote}
                </div>
              ) : null}
            </div>
          ),
        )}
      </div>

      {timeline.length === 0 && !hasAnyFilter ? (
        <EmptyState title="这一天没有安排" hint="请切换其他日期查看。" />
      ) : null}

      <p className="xsmall muted">
        * 表示场地名称仍为临时占位，真实名称待赛程组提供。原文说明：{event.event.scheduleNotice}
      </p>
    </div>
  );
}
