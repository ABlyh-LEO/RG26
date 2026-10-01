/**
 * 总览页：现在是什么情况，接下来是什么。
 *
 * 优先展示显式标记 running 的比赛；没有正在进行时显示下一计划项目；
 * 已过计划时间但未更新状态时标明“等待现场确认”，不显示负数倒计时。
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import {
  deriveCounts,
  deriveEventPhase,
  deriveNowPlaying,
  formatDate,
  formatTime,
  todayInEventTz,
} from '../data/view-model';
import { EmptyState, MatchCard, PublicationBadge, Section, TeamName } from '../components/ui';
import { FullJourneyBracket } from './ProgressPage';

export function OverviewPage() {
  const { derived, loading } = useData();
  const now = useMemo(() => new Date(), []);

  /**
   * 首日安排摘要。
   *
   * 排位赛有 44 次跑图（每个时间点 2 场），逐条列出会淹没页面，
   * 因此把同一时间点的跑图合并成一行，并显示对阵与场地。
   *
   * hook 必须在提前 return 之前调用。
   */
  const firstDayGroups = useMemo(() => {
    if (!derived) return [];
    const preview = deriveNowPlaying(derived, now).firstDayPreview;
    const groups: { key: string; time: string; title: string; detail: string | null }[] = [];
    const runByStart = new Map<string, { teams: string[]; venues: string[] }>();

    // 跑图日程项的 referenceId 是**跑图 ID**（不是队伍 ID），
    // 因此要先经 qualification.runs 解析出 teamId，再取队名。
    const runById = new Map(derived.event.qualification.runs.map((r) => [r.id, r]));

    for (const item of preview) {
      if (item.kind !== 'run') continue;
      // 同一批（同一起始时间）的两次跑图合并成一行
      const key = item.plannedStart;
      const bucket = runByStart.get(key) ?? { teams: [], venues: [] };
      const run = item.referenceId ? runById.get(item.referenceId) : undefined;
      const teamName = run
        ? (derived.teamMap.get(run.teamId)?.displayName ?? derived.teamMap.get(run.teamId)?.team.name ?? run.teamId)
        : '';
      const venue = item.venueId ? (derived.venueLabels.get(item.venueId) ?? item.venueId) : '';
      if (teamName) bucket.teams.push(teamName);
      if (venue) bucket.venues.push(venue);
      runByStart.set(key, bucket);
    }

    for (const [key, bucket] of [...runByStart.entries()].sort(
      (a, b) => Date.parse(a[0]) - Date.parse(b[0]),
    )) {
      groups.push({
        key: `run-${key}`,
        time: formatTime(key),
        title: '排位赛跑图',
        detail: `${bucket.teams.join(' / ')}（${bucket.venues.join('、')}）`,
      });
    }

    for (const item of preview) {
      if (item.kind === 'run') continue;
      groups.push({
        key: item.id,
        time: formatTime(item.revisedStart ?? item.plannedStart),
        title: item.title,
        detail: item.venueId ? (derived.venueLabels.get(item.venueId) ?? null) : null,
      });
    }

    return groups.sort((a, b) => a.time.localeCompare(b.time));
  }, [derived, now]);

  if (loading && !derived) {
    return <div className="empty">正在加载赛事数据…</div>;
  }
  if (!derived) return null;

  const { event } = derived;
  const phase = deriveEventPhase(event, now);
  const nowPlaying = deriveNowPlaying(derived, now);
  const counts = deriveCounts(derived);

  const phaseLabel =
    phase === 'before' ? '赛事尚未开始' : phase === 'after' ? '赛事已结束' : '赛事进行中';

  // 赛事日期已过但没有已确认结果 → 结果待发布，绝不生成虚假冠军
  const datesPassed = event.event.dates.every((d) => d < todayInEventTz(now));
  const awaitingResults = datesPassed && phase !== 'after';

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="page-head">
        <h1 className="page-head__title">总览</h1>
        <p className="page-head__sub">
          {phaseLabel}
          {' · '}
          {event.event.dates.map((d) => formatDate(`${d}T00:00:00+08:00`)).join('、')}
        </p>
      </div>

      <p className="xsmall muted">{event.event.scheduleNotice}</p>

      {awaitingResults ? (
        <div className="empty">
          <div className="empty__title">结果待发布</div>
          赛事日期已过，但还没有已确认的正式结果。成绩确认后会更新到此页面。
        </div>
      ) : null}

      {/* 正在进行 */}
      {nowPlaying.running.length > 0 ? (
        <Section title="正在进行">
          <div className="stack">
            {nowPlaying.running.map((m) => (
              <MatchCard key={m.id} match={m} showStage />
            ))}
          </div>
        </Section>
      ) : null}

      {/* 等待现场确认：已过计划开始时间但没有状态更新 */}
      {nowPlaying.running.length === 0 && nowPlaying.awaitingConfirmation.length > 0 ? (
        <Section title="等待现场确认">
          <p className="small muted" style={{ marginBottom: 'var(--sp-2)' }}>
            以下项目已过计划开始时间，但现场状态尚未更新。页面不会据此推测比赛已开始或已结束。
          </p>
          <div className="stack">
            {nowPlaying.awaitingConfirmation.slice(0, 3).map((m) => (
              <MatchCard key={m.id} match={m} showStage />
            ))}
          </div>
        </Section>
      ) : null}

      {/* 下一批比赛 */}
      {nowPlaying.upcoming.length > 0 ? (
        <Section
          title={nowPlaying.running.length > 0 ? '接下来' : '下一批比赛'}
          action={
            <Link to="/schedule" className="small">
              完整赛程 →
            </Link>
          }
        >
          <div className="stack">
            {nowPlaying.upcoming.slice(0, 4).map((m) => (
              <MatchCard key={m.id} match={m} showStage />
            ))}
          </div>
        </Section>
      ) : null}

      {/* 赛前：首日安排 */}
      {phase === 'before' && nowPlaying.firstDayPreview.length > 0 ? (
        <Section title="首日安排">
          <div className="card">
            <div className="stack stack--tight">
              {firstDayGroups.map((g) => (
                <div key={g.key}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                    <span className="tabular small" style={{ flexShrink: 0, fontWeight: 600 }}>
                      {g.time}
                    </span>
                    <span className="small" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {g.title}
                    </span>
                  </div>
                  {g.detail ? <div className="xsmall muted">{g.detail}</div> : null}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Link to="/schedule" className="small">
                查看完整两日赛程 →
              </Link>
            </div>
          </div>
        </Section>
      ) : null}

      {/* 完整晋级图 */}
      <Section
        title="完整晋级图"
        action={
          <Link to="/progress?view=journey" className="small">
            打开完整页面 →
          </Link>
        }
      >
        <p className="xsmall muted" style={{ marginBottom: 'var(--sp-2)' }}>
          瑞士轮 5 轮与决赛的全部对阵在一张图上，可左右滑动查看全部阶段。
          已结算的场次显示胜者、比分与到达最终分时间。
        </p>
        <FullJourneyBracket legend={false} />
      </Section>

      {/* 赛事结束后：最终结果与归档 */}
      {phase === 'after' ? <FinalResults /> : null}

      {/* 关注队伍 */}
      <FollowingSection />

      {/* 最新公告 */}
      {event.notices.length > 0 ? (
        <Section title="公告">
          <div className="stack">
            {[...event.notices]
              .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
              .slice(0, 3)
              .map((n) => (
                <div key={n.id} className="card">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong className="small">{n.title}</strong>
                    <span
                      className={`badge ${n.severity === 'critical' ? 'badge--danger' : n.severity === 'warning' ? 'badge--pending' : 'badge--info'}`}
                    >
                      {n.severity === 'critical' ? '重要' : n.severity === 'warning' ? '注意' : '信息'}
                    </span>
                  </div>
                  <p className="small muted" style={{ margin: 'var(--sp-2) 0 0' }}>
                    {n.body}
                  </p>
                </div>
              ))}
          </div>
        </Section>
      ) : null}

      {/* 赛况概要 */}
      <Section title="赛况概要">
        <div className="card">
          <dl className="stack stack--tight" style={{ margin: 0 }}>
            <CountRow
              label="排位赛跑图"
              value={`${counts.qualificationRuns.completed} / ${counts.qualificationRuns.total} 次`}
              hint="单队跑图次数"
            />
            <CountRow
              label="瑞士轮对阵"
              value={`${counts.swissMatches.completed} / ${counts.swissMatches.total} 场`}
              hint="每场 BO1"
            />
            <CountRow
              label="决赛"
              value={`${counts.finals.seriesDecided} / ${counts.finals.seriesCount} 个系列赛`}
              hint={`${counts.finals.bo1Count} 场 BO1 + ${counts.finals.bo3Count} 组 BO3`}
            />
            <CountRow
              label="决赛小局"
              value={`${counts.finals.gamesPlayed} 局已确认`}
              hint="BO3 最多 3 局，2–0 时第 3 局不需要进行"
            />
          </dl>
        </div>
      </Section>

      <p className="xsmall muted">
        数据更新于 {derived.event.event.contentUpdatedAt ? formatDate(derived.event.event.contentUpdatedAt) : '—'}。
        时间均为赛事时区（{event.event.timezone}）。
      </p>
    </div>
  );
}

function CountRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <dt className="small">
        {label}
        <span className="xsmall muted" style={{ display: 'block', fontWeight: 400 }}>
          {hint}
        </span>
      </dt>
      <dd className="tabular small" style={{ margin: 0, fontWeight: 700, flexShrink: 0 }}>
        {value}
      </dd>
    </div>
  );
}

function FinalResults() {
  const { derived } = useData();
  if (!derived) return null;
  const { awards, teamMap } = derived;

  const rows: { label: string; teamId: string | null }[] = [
    { label: '冠军', teamId: awards.champion },
    { label: '亚军', teamId: awards.runnerUp },
    { label: '季军', teamId: awards.third },
  ];

  return (
    <Section title="最终结果">
      <div className="card">
        <div className="stack stack--tight">
          {rows.map((r) => (
            <div key={r.label} className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">{r.label}</span>
              {r.teamId ? (
                <TeamName team={teamMap.get(r.teamId)?.team ?? null} fallback={r.teamId} />
              ) : (
                <span className="small muted">待公布</span>
              )}
            </div>
          ))}
        </div>
        {awards.topFour.length > 0 || awards.topEight.length > 0 ? (
          <details className="disclosure" style={{ marginTop: 'var(--sp-3)' }}>
            <summary>其余名次</summary>
            <div className="stack stack--tight" style={{ paddingTop: 'var(--sp-2)' }}>
              {awards.topFour.length > 0 ? (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small muted">四强</span>
                  <span className="small">
                    {awards.topFour.map((id) => teamMap.get(id)?.displayName ?? id).join('、')}
                  </span>
                </div>
              ) : null}
              {awards.topEight.length > 0 ? (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small muted">八强</span>
                  <span className="small">
                    {awards.topEight.map((id) => teamMap.get(id)?.displayName ?? id).join('、')}
                  </span>
                </div>
              ) : null}
              {awards.topSixteen.length > 0 ? (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small muted">十六强</span>
                  <span className="small">{awards.topSixteen.length} 队</span>
                </div>
              ) : null}
              {awards.honorableMention.length > 0 ? (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small muted">优秀奖</span>
                  <span className="small">{awards.honorableMention.length} 队</span>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <Link to="/progress" className="small">
          查看完整晋级图 →
        </Link>
      </div>
    </Section>
  );
}

function FollowingSection() {
  const { derived } = useData();
  const followed = useFollowingTeamIds();
  if (!derived) return null;
  if (followed.length === 0) return null;

  return (
    <Section title="我关注的队伍" action={<Link to="/teams" className="small">管理 →</Link>}>
      <div className="stack">
        {followed.map((teamId) => {
          const view = derived.teamMap.get(teamId);
          if (!view) return null;
          const entry = derived.standings.byTeam.get(teamId);
          const record = derived.event.finals.seeding
            ? Object.entries(derived.event.finals.seeding.seeds).find(([, id]) => id === teamId)?.[0]
            : null;
          return (
            <div key={teamId} className="card" style={{ padding: 'var(--sp-3)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <TeamName team={view.team} fallback={teamId} />
                <span className="row" style={{ gap: 'var(--sp-1)' }}>
                  {record ? <span className="badge badge--info">{record}</span> : null}
                  {entry ? <span className="badge badge--neutral">{entry.record}</span> : null}
                </span>
              </div>
              {entry ? (
                <div className="xsmall muted" style={{ marginTop: 'var(--sp-1)' }}>
                  R {entry.display.r} · P {entry.display.p} · {entry.wins} 胜 {entry.losses} 负
                </div>
              ) : null}
              <div style={{ marginTop: 'var(--sp-2)' }}>
                <Link to={`/teams/${teamId}`} className="small">
                  队伍详情 →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function useFollowingTeamIds(): string[] {
  // 关注列表在多个组件间共享会引入额外状态管理；
  // 总览页只在挂载时读取一次即可满足“本机关注”的需求。
  try {
    const raw = localStorage.getItem('rg26.following.v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export { PublicationBadge, EmptyState };
