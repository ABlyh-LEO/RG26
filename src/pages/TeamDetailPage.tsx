/**
 * 队伍详情页：下一场、历史比赛、成绩详情、晋级路径、关注按钮。
 *
 * 375px 宽度下必须完整显示最长队名（允许两行），比分不被长队名挤出屏幕。
 * 展示组详情显示预演、资料对接、抽签与正式演出，不出现竞技组胜负排名。
 */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { deriveTeamJourney, formatDate, formatTime } from '../data/view-model';
import { toSeriesView } from '../data/view-model';
import {
  CopyLinkButton,
  EmptyState,
  FollowButton,
  MatchCard,
  NameReviewBadge,
  ResultBadge,
  StatusBadge,
  TeamName,
} from '../components/ui';

export function TeamDetailPage() {
  const { teamId = '' } = useParams();
  const { derived, loading } = useData();
  const now = useMemo(() => new Date(), []);

  if (loading && !derived) return <div className="empty">正在加载…</div>;
  if (!derived) return null;

  const journey = deriveTeamJourney(derived, teamId, now);
  if (!journey) {
    return (
      <div className="card">
        <h1 className="page-head__title">找不到该队伍</h1>
        <p className="muted">队伍 ID「{teamId}」不存在。</p>
        <Link to="/teams" className="btn">
          返回队伍列表
        </Link>
      </div>
    );
  }

  const { team } = journey;
  const isShowcase = team.division === 'showcase';

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="page-head">
        <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'flex-start' }}>
          <span className="badge badge--neutral tabular">#{team.number}</span>
          <h1 className="page-head__title" style={{ overflowWrap: 'anywhere', margin: 0 }}>
            {team.name}
          </h1>
        </div>
        <div className="row" style={{ marginTop: 'var(--sp-2)', gap: 'var(--sp-2)' }}>
          <span className={`badge ${isShowcase ? 'badge--info' : journey.status === 'eliminated' ? 'badge--eliminated' : journey.status === 'advanced' || journey.status === 'champion' ? 'badge--advanced' : 'badge--neutral'}`}>
            {journey.statusLabel}
          </span>
          <span className="badge badge--neutral">{isShowcase ? '展示组' : '竞技组'}</span>
          <NameReviewBadge team={team} />
        </div>
        {!team.nameVerified && team.nameNote ? (
          <p className="xsmall" style={{ color: 'var(--pending)', marginTop: 'var(--sp-2)' }}>
            {team.nameNote}
          </p>
        ) : null}
      </div>

      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <FollowButton teamId={team.id} />
        <CopyLinkButton path={`/teams/${team.id}`} label="复制队伍链接" />
      </div>

      {isShowcase ? <ShowcaseDetail teamId={team.id} /> : <CompetitiveDetail journey={journey} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 展示组详情
 * ------------------------------------------------------------------ */

function ShowcaseDetail({ teamId }: { teamId: string }) {
  const { derived } = useData();
  if (!derived) return null;
  const { event } = derived;

  const previewItem = event.scheduleItems.find((s) => s.referenceId === teamId && s.id.startsWith('sched-showcase-preview'));
  const drawItem = event.scheduleItems.find((s) => s.id === 'sched-showcase-draw');
  const mediaItem = event.scheduleItems.find((s) => s.id === 'sched-showcase-media');

  // 抽签决定的演出顺序；未抽签时绝不能沿用编号顺序
  const drawOrder = event.showcase.drawOrder;
  const drawIndex = drawOrder ? drawOrder.indexOf(teamId) : -1;
  const finalSeriesId = drawIndex >= 0 ? `showcase-final-${drawIndex + 1}` : null;
  const finalSeries = finalSeriesId ? event.finals.series.find((s) => s.id === finalSeriesId) ?? null : null;

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="card">
        <div className="card__head">
          <span className="card__title">展示组日程</span>
        </div>
        <div className="stack stack--tight">
          {mediaItem ? (
            <ScheduleRow
              label="资料对接"
              time={mediaItem.plannedStart}
              end={mediaItem.plannedEnd}
              detail="将 PPT、视频、动画等媒体资料与赛程组负责人交接"
              status={mediaItem.executionStatus}
            />
          ) : null}
          {previewItem ? (
            <ScheduleRow
              label="预演彩排"
              time={previewItem.plannedStart}
              end={previewItem.plannedEnd}
              detail="15 分钟"
              status={previewItem.executionStatus}
            />
          ) : null}
          {drawItem ? (
            <ScheduleRow
              label="抽签"
              time={drawItem.plannedStart}
              end={drawItem.plannedEnd}
              detail="主席台前，决定决赛上台次序"
              status={drawItem.executionStatus}
            />
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">正式演出</span>
          {drawOrder ? (
            <span className="badge badge--advanced">已抽签</span>
          ) : (
            <span className="badge badge--pending">等待抽签</span>
          )}
        </div>
        {!drawOrder || !finalSeries ? (
          <EmptyState
            title="等待抽签"
            hint="决赛演出顺序由 10 月 3 日 12:00 的抽签决定。抽签结果录入前，这里不会推测上台顺序。"
          />
        ) : (
          <ShowcaseFinal seriesId={finalSeries.id} order={drawIndex + 1} />
        )}
      </div>
    </div>
  );
}

function ShowcaseFinal({ seriesId, order }: { seriesId: string; order: number }) {
  const { derived } = useData();
  if (!derived) return null;
  const { event, teamMap, venueLabels, finals } = derived;
  const series = event.finals.series.find((s) => s.id === seriesId);
  if (!series) return null;
  const view = toSeriesView(series, event, teamMap, venueLabels, finals);

  return (
    <div className="stack stack--tight">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small">抽签第 {order} 队上台</span>
        <StatusBadge status={view.executionStatus} />
      </div>
      {view.schedule ? (
        <div className="small muted">
          {formatDate(view.schedule.plannedStart)} {formatTime(view.schedule.plannedStart)}
          {view.schedule.plannedEnd ? `–${formatTime(view.schedule.plannedEnd)}` : ''}
        </div>
      ) : null}
      <div>
        <Link to={`/matches/${seriesId}`} className="small">
          查看详情 →
        </Link>
      </div>
    </div>
  );
}

function ScheduleRow({
  label,
  time,
  end,
  detail,
  status,
}: {
  label: string;
  time: string;
  end: string | null;
  detail: string;
  status: Parameters<typeof StatusBadge>[0]['status'];
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
      <div style={{ minWidth: 0 }}>
        <div className="small" style={{ fontWeight: 600 }}>
          {label}
        </div>
        <div className="xsmall muted">{detail}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="tabular small">
          {formatTime(time)}
          {end ? `–${formatTime(end)}` : ''}
        </div>
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 竞技组详情
 * ------------------------------------------------------------------ */

function CompetitiveDetail({ journey }: { journey: NonNullable<ReturnType<typeof deriveTeamJourney>> }) {
  const { derived } = useData();
  if (!derived) return null;
  const { team, swissMatches, finalsMatches, standingsEntry, nextMatch, seeds } = journey;
  void derived;

  const qualificationRank = derived.qualification.orderedTeamIds.indexOf(team.id);

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {/* 下一场 */}
      <div className="card">
        <div className="card__head">
          <span className="card__title">下一场</span>
        </div>
        {nextMatch ? (
          <MatchCard match={nextMatch} showStage />
        ) : (
          <EmptyState
            title="暂无后续比赛"
            hint={
              journey.status === 'eliminated'
                ? '该队已被淘汰，没有后续比赛。'
                : '等待上一轮结束后公布下一轮对阵。'
            }
          />
        )}
      </div>

      {/* 成绩详情 */}
      <div className="card">
        <div className="card__head">
          <span className="card__title">成绩详情</span>
          {seeds.length > 0 ? (
            <span className="row" style={{ gap: 'var(--sp-1)' }}>
              {seeds.map((s) => (
                <span key={s} className="badge badge--info">
                  {s}
                </span>
              ))}
            </span>
          ) : null}
        </div>

        {qualificationRank >= 0 ? (
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
            <span className="small muted">排位赛正式名次</span>
            <span className="tabular small" style={{ fontWeight: 700 }}>
              第 {qualificationRank + 1} 名
            </span>
          </div>
        ) : null}

        {team.thirdReviewRank !== null ? (
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
            <span className="small muted">三审排名（仅用于出场安排）</span>
            <span className="tabular small">第 {team.thirdReviewRank} 名</span>
          </div>
        ) : null}

        {standingsEntry ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
              <span className="small muted">瑞士轮战绩</span>
              <span className="tabular small" style={{ fontWeight: 700 }}>
                {standingsEntry.record}（{standingsEntry.wins} 胜 {standingsEntry.losses} 负）
              </span>
            </div>
            <details className="disclosure">
              <summary>评分指标</summary>
              <div className="table-wrap" style={{ paddingTop: 'var(--sp-2)' }}>
                <table className="table">
                  <caption className="visually-hidden">瑞士轮评分指标</caption>
                  <thead>
                    <tr>
                      <th className="num">R</th>
                      <th className="num">P</th>
                      <th className="num">O</th>
                      <th className="num">A</th>
                      <th className="num">B</th>
                      <th className="num">T</th>
                      <th className="num">局均得分</th>
                      <th className="num">局均分差</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="num tabular">{standingsEntry.display.r}</td>
                      <td className="num tabular">{standingsEntry.display.p}</td>
                      <td className="num tabular">{standingsEntry.display.o}</td>
                      <td className="num tabular">{standingsEntry.display.a}</td>
                      <td className="num tabular">{standingsEntry.display.b}</td>
                      <td className="num tabular">{standingsEntry.display.t}</td>
                      <td className="num tabular">{standingsEntry.display.meanScore ?? '—'}</td>
                      <td className="num tabular">{standingsEntry.display.meanDiff ?? '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
                计入表现的比赛数 n={standingsEntry.metrics.n}，已登记对阵 m={standingsEntry.metrics.m}。
                {standingsEntry.metrics.n === 0
                  ? '没有有效比赛时 A、B、P 记 0，T 记 360 秒。'
                  : ''}
                <Link to="/rules" style={{ marginLeft: 'var(--sp-1)' }}>
                  查看算法说明
                </Link>
              </p>
            </details>
          </>
        ) : (
          <p className="small muted">尚未参加瑞士轮。</p>
        )}
      </div>

      {/* 晋级路径 */}
      <div className="card">
        <div className="card__head">
          <span className="card__title">晋级路径</span>
        </div>
        <ol className="stack stack--tight" style={{ margin: 0, paddingLeft: '1.2em' }}>
          <PathItem
            done={journey.qualificationRuns.filter((r) => r.resultStatus === 'confirmed').length > 0}
            label={`排位赛两轮跑图（已确认 ${journey.qualificationRuns.filter((r) => r.resultStatus === 'confirmed').length} / ${journey.qualificationRuns.length || 2} 次）`}
            detail={qualificationRank >= 0 ? `正式名次 第 ${qualificationRank + 1} 名` : '名次待裁判确认'}
          />
          <PathItem
            done={swissMatches.length > 0}
            label={`瑞士轮（已打 ${swissMatches.length} 场）`}
            detail={standingsEntry ? standingsEntry.record : '尚未开始'}
          />
          <PathItem
            done={seeds.length > 0 || finalsMatches.length > 0}
            label="八强决赛"
            detail={seeds.length > 0 ? `种子 ${seeds.join('、')}` : '未进入八强或尚未公布种子'}
          />
        </ol>
      </div>

      {/* 历史比赛 */}
      <div className="card">
        <div className="card__head">
          <span className="card__title">瑞士轮比赛</span>
          <span className="xsmall muted">
            {
              swissMatches.filter((m) => m.resultStatus === 'confirmed').length
            }{' '}
            / {swissMatches.length} 场已确认
          </span>
        </div>
        {swissMatches.length === 0 ? (
          <EmptyState title="尚未比赛" hint="瑞士轮对阵公布后显示在这里。" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">瑞士轮比赛记录</caption>
              <thead>
                <tr>
                  <th className="num">轮次</th>
                  <th className="table__team">对手</th>
                  <th>结果</th>
                  <th>时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {swissMatches.map((m) => {
                  const opponent = m.sides?.find((s) => s.team?.id !== team.id);
                  const selfIsWinner = m.sides?.some((s) => s.team?.id === team.id && s.isWinner) ?? false;
                  const hasResult = m.resultStatus === 'confirmed';
                  return (
                    <tr key={m.id}>
                      <td className="num tabular">R{m.roundIndex}</td>
                      <td className="table__team">
                        <TeamName team={opponent?.team ?? null} fallback={opponent?.sourceLabel ?? '待定'} />
                      </td>
                      <td>
                        {hasResult ? (
                          <span className={`badge ${selfIsWinner ? 'badge--advanced' : 'badge--eliminated'}`}>
                            {selfIsWinner ? '胜' : '负'}
                          </span>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td className="tabular xsmall">
                        {m.schedule ? `${formatDate(m.schedule.plannedStart)} ${formatTime(m.schedule.plannedStart)}` : '—'}
                      </td>
                      <td>
                        <Link to={`/matches/${m.id}`} className="xsmall">
                          详情
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 决赛比赛 */}
      {finalsMatches.length > 0 ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">决赛比赛</span>
          </div>
          <div className="stack">
            {finalsMatches.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </div>
      ) : null}

      {/* 排位赛跑图 */}
      {journey.qualificationRuns.length > 0 ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">排位赛跑图</span>
          </div>
          <div className="stack stack--tight">
            {journey.qualificationRuns
              .sort((a, b) => a.round - b.round)
              .map((run) => (
                <div key={run.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small">
                    第 {run.round} 轮 · {derived.venueLabels.get(run.venueId) ?? run.venueId}
                  </span>
                  <span className="row" style={{ gap: 'var(--sp-2)' }}>
                    <span className="tabular small">
                      {run.rawResult ?? run.score ?? '—'}
                    </span>
                    <ResultBadge status={run.resultStatus} />
                  </span>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      <p className="xsmall muted">
        队名与编号来自官方名单。三审排名仅用于排位赛出场安排，与正式名次无关。
      </p>
    </div>
  );
}

function PathItem({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <li className="small">
      <span style={{ color: done ? 'var(--advanced)' : 'var(--text-muted)' }}>
        {done ? '✔ ' : '○ '}
        {label}
      </span>
      <span className="xsmall muted" style={{ display: 'block', marginLeft: '1.2em' }}>
        {detail}
      </span>
    </li>
  );
}
