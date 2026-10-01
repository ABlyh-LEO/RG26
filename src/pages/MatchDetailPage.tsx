/**
 * 比赛详情页：对阵、结果和依赖是什么。
 *
 * 展示场地、时间、状态、双方分数/时间、异常说明与上下游链接。
 */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import {
  formatDate,
  formatDateTime,
  formatTime,
  toSeriesView,
  toSwissMatchView,
  type MatchView,
} from '../data/view-model';
import { finalsMatchNoLabel } from '../domain/finals';
import { assignSides, sidesForFinals, sidesForSeriesGame, sidesForSwiss } from '../domain/sides';
import {
  CopyLinkButton,
  EmptyState,
  ResultBadge,
  StatusBadge,
  TeamName,
} from '../components/ui';

export function MatchDetailPage() {
  const { matchId = '' } = useParams();
  const { derived, loading } = useData();
  const now = useMemo(() => new Date(), []);
  void now;

  if (loading && !derived) return <div className="empty">正在加载…</div>;
  if (!derived) return null;

  const { event, teamMap, venueLabels, finals } = derived;

  const swissMatch = event.swiss.matches.find((m) => m.id === matchId);
  const series = event.finals.series.find((s) => s.id === matchId);

  let view: MatchView | null = null;
  if (swissMatch) view = toSwissMatchView(swissMatch, event, teamMap, venueLabels);
  else if (series) view = toSeriesView(series, event, teamMap, venueLabels, finals);

  if (!view) {
    return (
      <div className="card">
        <h1 className="page-head__title">找不到该比赛</h1>
        <p className="muted">比赛 ID「{matchId}」不存在。</p>
        <Link to="/schedule" className="btn">
          返回赛程
        </Link>
      </div>
    );
  }

  const schedule = view.schedule;
  const isSeries = view.kind === 'series';

  /**
   * 本场红蓝方。
   *
   * 瑞士轮：按轮次（偶数轮换边）；
   * 决赛 BO1/BO2：八强双败不换边；
   * 决赛 BO3 的每一局各自换边，因此**不在系列赛层面**给单一归属 ——
   * 那种情况由下方「小局」表逐局展示。
   */
  const sidesInfo = (() => {
    if (swissMatch) {
      const s = sidesForSwiss(swissMatch.roundIndex);
      const snap = swissMatch.participantSnapshot;
      if (!snap?.[0] || !snap[1]) return null;
      return {
        ...assignSides(snap[0], snap[1], s),
        note:
          swissMatch.roundIndex % 2 === 0
            ? `第 ${swissMatch.roundIndex} 轮（偶数轮换边）`
            : `第 ${swissMatch.roundIndex} 轮`,
      };
    }
    if (series && series.format !== 'BO3') {
      const snap = series.participantSnapshot;
      if (!snap?.[0] || !snap[1]) return null;
      return {
        ...assignSides(snap[0], snap[1], sidesForFinals()),
        note: '八强双败不换边',
      };
    }
    return null;
  })();

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="page-head">
        <h1 className="page-head__title">{view.title}</h1>
        <div className="row" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          <StatusBadge status={view.executionStatus} />
          <ResultBadge status={view.resultStatus} />
          {view.format ? <span className="badge badge--neutral">{view.format}</span> : null}
          {!view.countsForStandings ? <span className="badge badge--neutral">不计正式排名</span> : null}
        </div>
      </div>

      {/* 对阵 */}
      <div className="card">
        <div className="card__head">
          <span className="card__title">对阵</span>
        </div>

        {/*
          红蓝方提示：由赛程结构自动推出，不落库、不需要人工维护。
          瑞士轮偶数轮换边；决赛八强双败不换边。
        */}
        {sidesInfo ? (
          <div className="row" style={{ gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
            <span>
              <span className="badge badge--danger" style={{ marginRight: 6 }}>
                红方
              </span>
              {teamMap.get(sidesInfo.red)?.displayName ?? sidesInfo.red}
            </span>
            <span>
              <span className="badge badge--info" style={{ marginRight: 6 }}>
                蓝方
              </span>
              {teamMap.get(sidesInfo.blue)?.displayName ?? sidesInfo.blue}
            </span>
            <span className="xsmall muted">{sidesInfo.note}</span>
          </div>
        ) : null}

        <div className="stack stack--tight">
          {view.sides?.map((side, i) => (
            <div
              key={i}
              className="row"
              style={{
                justifyContent: 'space-between',
                gap: 'var(--sp-2)',
                flexWrap: 'nowrap',
                padding: 'var(--sp-2)',
                borderRadius: 'var(--radius-sm)',
                background: side.isWinner ? 'var(--advanced-bg)' : 'transparent',
              }}
            >
              <div className="row" style={{ gap: 'var(--sp-2)', minWidth: 0, flex: 1 }}>
                <span style={{ flexShrink: 0 }} aria-hidden="true">
                  {side.isWinner ? '✔' : ''}
                </span>
                <TeamName team={side.team} fallback={side.sourceLabel} />
                {side.isWinner ? <span className="visually-hidden">胜者</span> : null}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {side.score !== null ? (
                  <strong className="tabular">{side.score}</strong>
                ) : (
                  <span className="muted small">—</span>
                )}
                {side.seconds !== null ? (
                  <div className="xsmall muted tabular">{side.seconds} 秒</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {view.homeWins !== null && view.awayWins !== null ? (
          <div className="small" style={{ marginTop: 'var(--sp-2)' }}>
            系列赛比分：
            <strong className="tabular">
              {' '}
              {view.homeWins} : {view.awayWins}
            </strong>
            {view.notNeededGames.length > 0 ? (
              <span className="muted"> · 第 {view.notNeededGames.join('、')} 局不需要进行</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 时间与场地 */}
      <div className="card">
        <div className="card__head">
          <span className="card__title">时间与场地</span>
        </div>
        <div className="stack stack--tight">
          <Row label="计划开始" value={schedule ? `${formatDate(schedule.plannedStart)} ${formatTime(schedule.plannedStart)}` : '待定'} />
          <Row
            label="计划结束"
            value={schedule?.plannedEnd ? formatTime(schedule.plannedEnd) : isSeries && view.format === 'BO3' ? '取决于系列赛进程' : '未给出'}
          />
          <Row
            label="场地"
            value={
              view.venueLabel
                ? `${view.venueLabel}${schedule?.venueId && event.venues.find((v) => v.id === schedule.venueId)?.provisionalName ? '（暂定名称）' : ''}`
                : '待定'
            }
          />
          {schedule?.afterSeriesId ? (
            <Row label="依赖" value={`${schedule.afterSeriesId} 结束后开始`} />
          ) : null}
          {schedule?.revisedStart ? (
            <Row label="修订后开始" value={formatDateTime(schedule.revisedStart)} />
          ) : null}
          {schedule?.adjustmentNote ? (
            <Row label="日程调整" value={schedule.adjustmentNote} />
          ) : null}
        </div>
        {isSeries && view.format === 'BO3' ? (
          <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
            原文未给出 BO3 的固定结束时刻，因此不编造准确开始或结束时间。
          </p>
        ) : null}
      </div>

      {/* 赛制说明 */}
      {view.groupRecord ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">所在战绩组</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="badge badge--info">{view.groupRecord} 组</span>
            <span className="small muted">{view.groupDescription}</span>
          </div>
          {view.stakes ? (
            <p className="small" style={{ margin: 'var(--sp-2) 0 0' }}>
              {view.stakes}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 小局（BO3） */}
      {isSeries && series && series.format === 'BO3' ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">小局</span>
          </div>
          <p className="xsmall muted" style={{ marginTop: 0 }}>
            BO3 **每局换边**：红蓝方按局号自动交替（第 1 局第一个席位蓝方，第 2 局换边，第 3 局换回）。
            到达最终分时间会一并列出 —— 积分相同时，它是判断本局胜负的重要依据。
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">局</th>
                  <th>红方</th>
                  <th className="num">红方积分</th>
                  <th className="num">红方到达最终分</th>
                  <th>蓝方</th>
                  <th className="num">蓝方积分</th>
                  <th className="num">蓝方到达最终分</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {[...series.games]
                  .sort((a, b) => a.index - b.index)
                  .map((g) => {
                    const notNeeded = view.notNeededGames.includes(g.index);
                    /*
                     * 该局的红蓝方。参赛双方优先用本局记录，缺省回落到
                     * 系列赛的参赛快照（尚未录入的局也能显示谁在哪一侧）。
                     * 归属由 `assignSides` 统一推出，不在页面里重算规则。
                     */
                    const first = g.homeTeamId ?? series.participantSnapshot?.[0] ?? null;
                    const second = g.awayTeamId ?? series.participantSnapshot?.[1] ?? null;
                    const sides =
                      first && second ? assignSides(first, second, sidesForSeriesGame(g.index)) : null;
                    const blueId = sides?.blue ?? null;
                    const redId = sides?.red ?? null;
                    const scoreOf = (id: string | null) =>
                      id === null
                        ? null
                        : id === g.homeTeamId
                          ? g.homeScore
                          : id === g.awayTeamId
                            ? g.awayScore
                            : null;
                    const secsOf = (id: string | null) =>
                      id === null
                        ? null
                        : id === g.homeTeamId
                          ? g.homeReachedSeconds
                          : id === g.awayTeamId
                            ? g.awayReachedSeconds
                            : null;
                    const nameOf = (id: string | null) =>
                      id ? teamMap.get(id)?.displayName ?? id : '—';
                    const secsText = (id: string | null) => {
                      const v = secsOf(id);
                      return v === null || v === '' ? '—' : `${v} 秒`;
                    };
                    return (
                      <tr key={g.id}>
                        <td className="num tabular">第 {g.index} 局</td>
                        <td>
                          <span className="badge badge--danger" style={{ marginRight: 6 }}>
                            红
                          </span>
                          {nameOf(redId)}
                        </td>
                        <td className="num tabular">{scoreOf(redId) ?? '—'}</td>
                        <td className="num tabular">{secsText(redId)}</td>
                        <td>
                          <span className="badge badge--info" style={{ marginRight: 6 }}>
                            蓝
                          </span>
                          {nameOf(blueId)}
                        </td>
                        <td className="num tabular">{scoreOf(blueId) ?? '—'}</td>
                        <td className="num tabular">{secsText(blueId)}</td>
                        <td>
                          {notNeeded ? (
                            <span className="badge badge--neutral">不需要进行</span>
                          ) : g.resultStatus === 'confirmed' && g.winnerId ? (
                            <span className="badge badge--advanced">
                              {teamMap.get(g.winnerId)?.displayName ?? g.winnerId} 胜
                            </span>
                          ) : g.resultStatus === 'provisional' ? (
                            <span className="badge badge--pending">待确认</span>
                          ) : (
                            <span className="badge badge--neutral">未开始</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
            先赢 2 局者胜；2–0 时第 3 局标为“不需要进行”，不计为未完赛。
          </p>
        </div>
      ) : null}

      {/* 异常说明 */}
      {view.note || view.conflicts.length > 0 ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">说明</span>
          </div>
          {view.note ? <p className="small">{view.note}</p> : null}
          {view.conflicts.length > 0 ? (
            <div className="badge badge--danger" style={{ whiteSpace: 'normal', display: 'block' }}>
              {view.conflicts.join('；')}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 上下游链接 */}
      <div className="card">
        <div className="card__head">
          <span className="card__title">相关比赛</span>
        </div>
        <RelatedMatches matchId={matchId} />
      </div>

      <CopyLinkButton path={`/matches/${matchId}`} label="复制比赛链接" />

      <div className="row">
        <Link to="/schedule" className="btn btn--small">
          ← 返回赛程
        </Link>
        <Link to="/progress" className="btn btn--small">
          晋级视图 →
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
      <span className="small muted" style={{ flexShrink: 0 }}>
        {label}
      </span>
      <span className="small" style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>
        {value}
      </span>
    </div>
  );
}

function RelatedMatches({ matchId }: { matchId: string }) {
  const { derived } = useData();
  if (!derived) return null;
  const { event, teamMap, venueLabels, finals } = derived;

  const series = event.finals.series.find((s) => s.id === matchId);

  if (!series) {
    // 瑞士轮比赛：显示同轮其他场次
    const swiss = event.swiss.matches.find((m) => m.id === matchId);
    if (!swiss) return <EmptyState title="没有相关比赛" />;
    const sameRound = event.swiss.matches.filter(
      (m) => m.roundIndex === swiss.roundIndex && m.id !== matchId,
    );
    return (
      <div className="stack stack--tight">
        <div className="xsmall muted">同轮其他场次（R{swiss.roundIndex}）</div>
        {sameRound.slice(0, 6).map((m) => {
          const v = toSwissMatchView(m, event, teamMap, venueLabels);
          return (
            <Link key={m.id} to={`/matches/${m.id}`} className="small">
              {v.sides?.[0]?.sourceLabel} vs {v.sides?.[1]?.sourceLabel}
            </Link>
          );
        })}
      </div>
    );
  }

  const upstream: string[] = [];
  const downstream: string[] = [];
  for (const ref of series.slots ?? []) {
    if (ref.kind === 'winner' || ref.kind === 'loser') {
      const no = finalsMatchNoLabel(ref.seriesId);
      upstream.push(`${no ?? ref.seriesId}（${ref.kind === 'winner' ? '胜者' : '败者'}）`);
    }
  }
  for (const other of event.finals.series) {
    for (const ref of other.slots ?? []) {
      if ((ref.kind === 'winner' || ref.kind === 'loser') && ref.seriesId === matchId) {
        const no = finalsMatchNoLabel(other.id);
        downstream.push(`${no ?? other.id}（${ref.kind === 'winner' ? '胜者进入' : '败者进入'}）`);
      }
    }
  }

  const v = toSeriesView(series, event, teamMap, venueLabels, finals);
  void v;

  return (
    <div className="stack stack--tight">
      {upstream.length > 0 ? (
        <div>
          <div className="xsmall muted">上游（来源）</div>
          {upstream.map((u) => (
            <div key={u} className="small">
              {u}
            </div>
          ))}
        </div>
      ) : (
        <div className="small muted">上游：来自八强种子（无前置比赛）</div>
      )}
      {downstream.length > 0 ? (
        <div>
          <div className="xsmall muted">下游（影响）</div>
          {downstream.map((d) => (
            <div key={d} className="small">
              {d}
            </div>
          ))}
        </div>
      ) : (
        <div className="small muted">下游：没有后续比赛</div>
      )}
    </div>
  );
}
