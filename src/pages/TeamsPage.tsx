/**
 * 队伍页：搜索、组别筛选、编号与队名、当前赛段状态。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryParams } from '../app/useQueryParams';
import { useData } from '../data/DataProvider';
import { EmptyState, FollowButton, NameReviewBadge, TeamName } from '../components/ui';
import { deriveTeamJourney } from '../data/view-model';

export function TeamsPage() {
  const { derived, loading } = useData();
  const { params, setParams } = useQueryParams();
  const [query, setQuery] = useState(params.get('q') ?? '');

  const division = params.get('division') ?? 'all';

  // 需要在渲染前统计：hook 之后、提前 return 之前
  const unverifiedCount = derived ? derived.event.teams.filter((t) => !t.nameVerified).length : 0;

  // 必须在任何提前 return 之前调用 hook。
  const filtered = useMemo(() => {
    if (!derived) return [];
    const q = query.trim().toLowerCase();
    return derived.event.teams
      .filter((t) => (division === 'all' ? true : t.division === division))
      .filter((t) => {
        if (q === '') return true;
        // 搜索不区分大小写；同时匹配队名与编号
        return t.name.toLowerCase().includes(q) || String(t.number) === q || t.id.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (a.division !== b.division) return a.division === 'competitive' ? -1 : 1;
        if (a.division === 'competitive') {
          return (a.thirdReviewRank ?? 99) - (b.thirdReviewRank ?? 99);
        }
        return a.number - b.number;
      });
  }, [derived, division, query]);

  if (loading && !derived) return <div className="empty">正在加载队伍…</div>;
  if (!derived) return null;

  const now = new Date();

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="page-head">
        <h1 className="page-head__title">队伍</h1>
        <p className="page-head__sub">
          竞技组 22 支 · 展示组 3 支。搜索不区分大小写。
        </p>
      </div>

      <div>
        <label className="visually-hidden" htmlFor="team-search">
          搜索队伍
        </label>
        <input
          id="team-search"
          className="input"
          type="search"
          placeholder="搜索队名或编号…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setParams({ q: e.target.value }, { replace: true });
          }}
        />
      </div>

      <div className="segmented" role="group" aria-label="选择组别">
        {(
          [
            ['all', '全部'],
            ['competitive', '竞技组'],
            ['showcase', '展示组'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="segmented__item"
            aria-pressed={division === key}
            onClick={() => setParams({ division: key === 'all' ? null : key })}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="该筛选没有结果" hint="试试其他关键词或切换组别。" />
      ) : null}

      <div className="stack">
        {filtered.map((team) => {
          const journey = deriveTeamJourney(derived, team.id, now);
          const entry = journey?.standingsEntry;
          return (
            <div key={team.id} className="card" style={{ padding: 'var(--sp-3)' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="row" style={{ gap: 'var(--sp-2)', minWidth: 0, flex: 1 }}>
                  <span className="badge badge--neutral tabular">#{team.number}</span>
                  <TeamName team={team} fallback={team.id} />
                </div>
                {journey ? (
                  <span className={`badge ${statusBadgeClass(journey.status)}`}>{journey.statusLabel}</span>
                ) : null}
              </div>

              <div className="row" style={{ marginTop: 'var(--sp-2)', gap: 'var(--sp-2)' }}>
                {team.division === 'competitive' && team.thirdReviewRank !== null ? (
                  <span className="xsmall muted">三审第 {team.thirdReviewRank} 名</span>
                ) : null}
                {entry ? (
                  <span className="xsmall muted tabular">
                    瑞士轮 {entry.record} · R {entry.display.r}
                  </span>
                ) : null}
                <NameReviewBadge team={team} />
              </div>

              <div className="row" style={{ marginTop: 'var(--sp-2)', gap: 'var(--sp-3)' }}>
                <Link to={`/teams/${team.id}`} className="small">
                  队伍详情 →
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <p className="xsmall muted">
        {unverifiedCount > 0
          ? `有 ${unverifiedCount} 支队伍的队名尚未核对，已明确标注，不会以推测的字形冒充官方名称。`
          : '队名与编号均依据官方名单核对。三审排名仅用于排位赛出场安排，与正式名次无关。'}
      </p>
    </div>
  );
}

function statusBadgeClass(status: string): string {
  if (status === 'champion') return 'badge--advanced';
  if (status === 'advanced') return 'badge--advanced';
  if (status === 'swiss-active') return 'badge--info';
  if (status === 'eliminated') return 'badge--eliminated';
  return 'badge--neutral';
}

export { FollowButton };
