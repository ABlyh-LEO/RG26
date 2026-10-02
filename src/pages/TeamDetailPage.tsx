/**
 * 队伍详情页：下一场、历史比赛、成绩详情、晋级路径、关注按钮。
 *
 * 375px 宽度下必须完整显示最长队名（允许两行），比分不被长队名挤出屏幕。
 * 展示组详情显示预演、资料对接、抽签与正式演出，不出现竞技组胜负排名。
 */
import { Link, useParams } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { useEventClock } from '../data/clock';
import { deriveTeamJourney, effectiveStart, formatDate, formatTime } from '../data/view-model';
import { toSeriesView } from '../data/view-model';
import { Icon } from '../components/Icon';
import { finalsSeedLabel } from '../domain/finals';
import {
  BackButton,
  CopyLinkButton,
  EmptyState,
  FollowButton,
  MatchCard,
  OriginalStart,
  NameReviewBadge,
  ResultBadge,
  StatusBadge,
  Section,
} from '../components/ui';

export function TeamDetailPage() {
  const { teamId = '' } = useParams();
  const { derived, loading } = useData();
  const now = useEventClock();

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
    <div className="stack">
      <BackButton fallback="/teams" label="返回队伍" />
      <div className="detail-heading">
        <div className="detail-heading__identity">
          <span className="team-avatar tabular">{team.number.toString().padStart(2, '0')}</span>
          <div style={{ minWidth: 0 }}><h1>{team.name}</h1>
        <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
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
        ) : null}</div></div>
      <div className="detail-actions">
        <FollowButton teamId={team.id} />
        <CopyLinkButton path={`/teams/${team.id}`} label="分享队伍" />
      </div></div>

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
              time={effectiveStart(mediaItem)}
              end={mediaItem.plannedEnd}
              detail="将 PPT、视频、动画等媒体资料与赛程组负责人交接"
              status={mediaItem.executionStatus}
            />
          ) : null}
          {previewItem ? (
            <ScheduleRow
              label="预演彩排"
              time={effectiveStart(previewItem)}
              end={previewItem.plannedEnd}
              detail="15 分钟"
              status={previewItem.executionStatus}
            />
          ) : null}
          {drawItem ? (
            <ScheduleRow
              label="抽签"
              time={effectiveStart(drawItem)}
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
            hint={`决赛演出顺序由${drawItem ? `${formatDate(effectiveStart(drawItem))} ${formatTime(effectiveStart(drawItem))}` : '现场'}的抽签决定，结果确认后会在这里公布。`}
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
          {formatDate(effectiveStart(view.schedule))} {formatTime(effectiveStart(view.schedule))}
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
  const qualificationRank = derived.qualification.orderedTeamIds.indexOf(team.id);
  const completedSwiss = swissMatches.filter((match) => match.resultStatus === 'confirmed').length;
  const confirmedRuns = journey.qualificationRuns.filter((run) => run.resultStatus === 'confirmed').length;

  return <div className="detail-grid">
    <div className="stack" style={{ gap: 26 }}>
      <Section title={nextMatch?.executionStatus === 'running' ? '正在比赛' : '下一场'} action={<Link to={`/schedule?team=${team.id}`}>该队完整赛程<Icon name="arrow" size={15} /></Link>}>
        {nextMatch ? <MatchCard match={nextMatch} showStage showDate /> : <EmptyState title={journey.status === 'eliminated' || journey.status === 'champion' ? '本届比赛已完成' : '下一场对阵待公布'} hint={journey.status === 'eliminated' || journey.status === 'champion' ? '本届成绩与全部比赛记录保留在下方。' : '下一轮公布后，这里会更新出场时间与对阵。'} />}
      </Section>
      {journey.qualificationRuns.length > 0 ? <Section title="排位赛跑图"><div className="card">
        {[...journey.qualificationRuns].sort((a, b) => a.round - b.round).map((run) => {
          const schedule = derived.event.scheduleItems.find((item) => item.id === run.scheduleItemId);
          const isBest = derived.qualification.bestByTeam.get(team.id) === run.round;
          return <article className="record-card" key={run.id}><div className="record-card__head"><strong>第 {run.round} 轮 <span className="muted small">· {derived.venueLabels.get(run.venueId) ?? '场地待定'}</span></strong><ResultBadge status={run.resultStatus} /></div><div className="record-card__meta">{schedule ? <span><time dateTime={effectiveStart(schedule)}>{formatDate(effectiveStart(schedule))} {formatTime(effectiveStart(schedule))}</time>{schedule.revisedStart ? <span className="rescheduled"> · 已改期，原定 <OriginalStart schedule={schedule} /></span> : null}</span> : null}<span className="tabular">积分 <strong>{run.score ?? '—'}</strong></span><span className="tabular">到达最终分 {run.elapsedSeconds ? `${run.elapsedSeconds} 秒` : '—'}</span>{isBest ? <span className="badge badge--advanced">计入名次</span> : null}</div>{run.rawResult ? <p className="xsmall muted" style={{ marginTop: 6 }}>原始成绩：{run.rawResult}</p> : null}</article>;
        })}<p className="xsmall muted" style={{ marginTop: 12 }}>两轮取最优成绩；积分高者优，同分比较到达最终分时间。</p>
      </div></Section> : null}
      {swissMatches.length > 0 ? <Section title="瑞士轮比赛" action={<span className="xsmall muted">{completedSwiss} / {swissMatches.length} 场已确认</span>}><div className="stack">{swissMatches.map((match) => <MatchCard key={match.id} match={match} showStage showDate />)}</div></Section> : null}
      {finalsMatches.length > 0 ? <Section title="决赛比赛"><div className="stack">{finalsMatches.map((match) => <MatchCard key={match.id} match={match} showDate />)}</div></Section> : null}
    </div>
    <aside className="stack" style={{ gap: 24 }}>
      <Section title="成绩与状态"><div className="card"><div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">当前状态</span><strong className="small">{journey.statusLabel}</strong></div>
        {qualificationRank >= 0 ? <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}><span className="small muted">排位赛正式名次</span><strong className="tabular">第 {qualificationRank + 1} 名</strong></div> : null}
        {standingsEntry ? <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}><span className="small muted">瑞士轮战绩</span><strong className="tabular">{standingsEntry.wins} 胜 {standingsEntry.losses} 负</strong></div> : null}
        {seeds.length > 0 ? <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}><span className="small muted">八强种子</span><strong>{seeds.map(finalsSeedLabel).join('、')}</strong></div> : null}
        {standingsEntry ? <details className="disclosure" style={{ marginTop: 17 }}><summary>评分指标</summary><dl className="metrics-grid">{[['R 综合分', standingsEntry.display.r], ['P 表现分', standingsEntry.display.p], ['O 对手强度', standingsEntry.display.o], ['A 得分表现', standingsEntry.display.a], ['B 分差表现', standingsEntry.display.b], ['T 平均用时', standingsEntry.display.t], ['局均得分', standingsEntry.display.meanScore ?? '—'], ['局均分差', standingsEntry.display.meanDiff ?? '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tabular">{value}</dd></div>)}</dl><p className="xsmall muted">计入表现 n={standingsEntry.metrics.n}；已结算对阵 m={standingsEntry.metrics.m}。<Link to="/rules?section=scoring">查看评分说明</Link></p></details> : null}
      </div></Section>
      <Section title="参赛历程"><div className="card"><ol className="journey-steps"><PathItem done={confirmedRuns > 0} label="排位赛" detail={qualificationRank >= 0 ? `正式名次第 ${qualificationRank + 1} 名` : `${confirmedRuns} / ${journey.qualificationRuns.length || 2} 次跑图已确认`} /><PathItem done={completedSwiss > 0} label="瑞士轮" detail={completedSwiss > 0 ? `已完成 ${completedSwiss} 场 · ${standingsEntry?.record ?? ''}` : '等待瑞士轮结果'} /><PathItem done={seeds.length > 0 || finalsMatches.length > 0} label="八强决赛" detail={seeds.length > 0 ? `种子 ${seeds.map(finalsSeedLabel).join('、')}` : finalsMatches.length > 0 ? '已进入八强赛' : '等待晋级结果'} /></ol></div></Section>
      <details className="disclosure"><summary>队伍资料</summary><p className="small muted">编号 #{team.number}{team.thirdReviewRank !== null ? ` · 三审第 ${team.thirdReviewRank} 名` : ''}</p><p className="xsmall muted">三审排名仅用于出场安排，与正式名次无关。队名与编号依据官方名单。</p></details>
    </aside>
  </div>;
}

function PathItem({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return <li className={done ? 'is-complete' : ''}><span className="journey-steps__mark">{done ? <Icon name="check" size={13} /> : null}</span><div><strong>{label}</strong><p>{detail}</p></div></li>;
}
