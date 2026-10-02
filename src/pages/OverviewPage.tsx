import { Link } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { useEventClock } from '../data/clock';
import { deriveCounts, deriveEventPhase, deriveNowPlaying, deriveTeamJourney, effectiveStart, formatDate, formatTime, toQualificationRunView, toSeriesView, toSwissMatchView, todayInEventTz } from '../data/view-model';
import { EmptyState, MatchCard, Section, TeamName, useFollowing } from '../components/ui';
import { Icon } from '../components/Icon';

export function OverviewPage() {
  const { derived, loading } = useData();
  const now = useEventClock();
  const { following } = useFollowing();
  if (loading && !derived) return <div className="empty">正在加载赛事数据…</div>;
  if (!derived) return null;

  const { event, teamMap, venueLabels, finals } = derived;
  const phase = deriveEventPhase(event, now);
  const playing = deriveNowPlaying(derived, now);
  const counts = deriveCounts(derived);
  const datesPassed = event.event.dates.every((date) => date < todayInEventTz(now));
  const awaiting = datesPassed && phase !== 'after';
  const phaseLabel = phase === 'before' ? '赛事尚未开始' : phase === 'after' ? '赛事已结束' : awaiting ? '结果待发布' : '赛事进行中';
  const competitiveCount = event.teams.filter((team) => team.division === 'competitive').length;
  const recent = [
    ...event.qualification.runs.map((run) => toQualificationRunView(run, event, teamMap, venueLabels)),
    ...event.swiss.matches.map((match) => toSwissMatchView(match, event, teamMap, venueLabels)),
    ...event.finals.series.map((series) => toSeriesView(series, event, teamMap, venueLabels, finals)),
  ].filter((match) => match.resultStatus === 'confirmed').sort((a, b) => Date.parse(b.schedule ? effectiveStart(b.schedule) : '') - Date.parse(a.schedule ? effectiveStart(a.schedule) : '')).slice(0, 4);
  const featured = playing.running.length > 0 ? playing.running : playing.awaitingConfirmation.length > 0 ? playing.awaitingConfirmation.slice(0, 2) : playing.upcoming.slice(0, 2);
  const featuredTitle = playing.running.length > 0 ? '正在进行' : playing.awaitingConfirmation.length > 0 ? '等待现场确认' : '下一批比赛';
  const notices = [...event.notices].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const critical = notices.find((notice) => notice.severity === 'critical') ?? notices.find((notice) => notice.severity === 'warning');
  const journeys = following.map((id) => deriveTeamJourney(derived, id, now)).filter((journey) => journey !== null);
  const progress = [
    { label: '排位赛', done: counts.qualificationRuns.completed, total: counts.qualificationRuns.total, unit: '次跑图' },
    { label: '瑞士轮', done: counts.swissMatches.completed, total: counts.swissMatches.total, unit: '场对阵' },
    { label: '八强决赛', done: counts.finals.seriesDecided, total: counts.finals.seriesCount, unit: '场系列赛' },
  ];

  return (
    <div className="overview-page">
      <div className="event-hero">
        <div><div className="eyebrow">THE COMPETITION / 2026</div><h1>赛场动态</h1><p className="event-hero__sub">{event.event.dates.map((date) => formatDate(`${date}T00:00:00+08:00`)).join(' — ')} · RoboGame 2026</p><div className="event-hero__status"><span className={`badge ${phase === 'during' ? 'badge--live' : 'badge--neutral'}`}>{phaseLabel}</span><span>对阵、成绩与晋级，一站查看</span></div></div>
        <div className="hero-meta"><div className="hero-meta__item"><strong className="tabular">{competitiveCount}</strong><span>竞技队伍</span></div><div className="hero-meta__item"><strong className="tabular">{event.teams.length - competitiveCount}</strong><span>展示队伍</span></div></div>
      </div>
      {critical ? <details className={`inline-notice priority-notice${critical.severity === 'critical' ? ' priority-notice--critical' : ''}`} open={critical.severity === 'critical'}><summary><Icon name="info" size={16} /><strong>{critical.title}</strong><span>查看通知</span></summary><p>{critical.body}</p></details> : null}
      <div className="overview-layout">
        <div className="overview-primary">
          {phase === 'after' ? <FinalResults /> : null}
          {featured.length > 0 ? <Section title={featuredTitle} action={<Link to="/schedule">完整赛程<Icon name="arrow" size={15} /></Link>}>
            {featuredTitle === '等待现场确认' ? <p className="small muted" style={{ marginBottom: 12 }}>计划时间已过，现场状态尚待更新。</p> : null}
            <div className="match-grid">{featured.map((match) => <MatchCard key={match.id} match={match} showStage showDate />)}</div>
          </Section> : phase !== 'after' ? <EmptyState title={awaiting ? '等待正式结果' : '下一场安排待公布'} hint="现场确认后，最新赛程和比赛结果会自动更新。" action={<Link to="/schedule" className="btn btn--small">查看赛程</Link>} /> : null}

          {journeys.length > 0 ? <Section title="我关注的队伍" action={<Link to="/teams?following=1">查看全部<Icon name="arrow" size={15} /></Link>}><div className="card">{journeys.map((journey) => <div className="followed-team" key={journey.team.id}><div className="team-avatar">{journey.team.number.toString().padStart(2, '0')}</div><div className="followed-team__info"><TeamName team={journey.team} fallback={journey.team.id} /><div className="followed-team__next">{journey.nextMatch?.schedule ? `下一场 ${formatDate(effectiveStart(journey.nextMatch.schedule))} ${formatTime(effectiveStart(journey.nextMatch.schedule))} · ${journey.nextMatch.venueLabel ?? '场地待定'}` : journey.statusLabel}</div></div><Link to={`/teams/${journey.team.id}`} className="btn btn--icon" aria-label={`查看${journey.team.name}赛程`}><Icon name="chevron" size={17} /></Link></div>)}</div></Section> : null}

          {playing.running.length > 0 && playing.upcoming.length > 0 ? <Section title="接下来"><div className="match-grid">{playing.upcoming.slice(0, 2).map((match) => <MatchCard key={match.id} match={match} showStage showDate />)}</div></Section> : null}
          {recent.length > 0 ? <Section title="最近结果" action={<Link to="/schedule">全部比赛<Icon name="arrow" size={15} /></Link>}><div className="match-grid">{recent.map((match) => <MatchCard key={match.id} match={match} showStage showDate />)}</div></Section> : null}
          <Section title="赛事进展" action={<Link to="/progress">查看晋级<Icon name="arrow" size={15} /></Link>}><div className="card"><div className="stage-progress">{progress.map((stage) => <div key={stage.label}><div className="stage-progress__head"><strong>{stage.label}</strong><span className="muted tabular">{stage.done} / {stage.total} {stage.unit}</span></div><span className="progress-track" role="progressbar" aria-label={stage.label} aria-valuenow={stage.done} aria-valuemax={stage.total} aria-valuemin={0}><span style={{ width: `${stage.total > 0 ? stage.done / stage.total * 100 : 0}%` }} /></span></div>)}</div><Link to="/progress?view=journey" className="stage-progress__link"><span>完整晋级图</span><Icon name="bracket" size={19} /></Link></div></Section>
        </div>
        <aside className="overview-secondary">
          {following.length === 0 ? <div className="card follow-prompt"><span className="follow-prompt__icon"><Icon name="star" size={21} /></span><div><strong>关注你的队伍</strong><p>把下一场时间和最新战绩，放在每次打开的首页。</p><Link to="/teams" className="btn btn--small">选择队伍<Icon name="arrow" size={15} /></Link></div></div> : null}
          <Section title="赛事公告">{notices.length > 0 ? <div className="card notice-list">{notices.slice(0, 4).map((notice) => <article className="notice-item" key={notice.id}><div className="notice-item__meta"><time dateTime={notice.at}>{formatDate(notice.at)} {formatTime(notice.at)}</time>{notice.severity !== 'info' ? <span className={`badge ${notice.severity === 'critical' ? 'badge--danger' : 'badge--pending'}`}>{notice.severity === 'critical' ? '重要' : '注意'}</span> : null}</div><h3>{notice.title}</h3><p>{notice.body}</p></article>)}</div> : <div className="card"><p className="small muted">暂无新公告。赛程变更和现场通知会发布在这里。</p></div>}</Section>
          <Section title="观赛指南"><div className="card"><p className="small">排位赛取最优成绩，瑞士轮三胜晋级，再由八强双败赛决出冠军。</p><p className="xsmall muted">{event.event.scheduleNotice}</p><Link to="/rules" className="stage-progress__link"><span>了解赛制与成绩口径</span><Icon name="book" size={17} /></Link></div></Section>
        </aside>
      </div>
    </div>
  );
}

function FinalResults() {
  const { derived } = useData();
  if (!derived) return null;
  const { awards, teamMap } = derived;
  const places = [{ label: '冠军', id: awards.champion }, { label: '亚军', id: awards.runnerUp }, { label: '季军', id: awards.third }];
  return <Section title="最终结果" action={<Link to="/progress?view=finals">全部名次<Icon name="arrow" size={15} /></Link>}><div className="podium">{places.map((place) => <div className="podium__place" key={place.label}><div className="podium__rank"><Icon name="trophy" size={20} />{place.label}</div>{place.id ? <TeamName team={teamMap.get(place.id)?.team ?? null} fallback="待公布" /> : <span className="muted small">待公布</span>}</div>)}</div>{awards.topFour.length > 0 || awards.topEight.length > 0 ? <details className="disclosure" style={{ marginTop: 16 }}><summary>其余获奖队伍</summary><div className="stack stack--tight small"><p>四强：{awards.topFour.map((id) => teamMap.get(id)?.displayName ?? id).join('、') || '待公布'}</p><p>八强：{awards.topEight.map((id) => teamMap.get(id)?.displayName ?? id).join('、') || '待公布'}</p><p>十六强：{awards.topSixteen.length} 队 · 优秀奖：{awards.honorableMention.length} 队</p></div></details> : null}</Section>;
}
