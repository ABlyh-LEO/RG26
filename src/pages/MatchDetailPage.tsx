import { Link, useParams } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { effectiveStart, formatDate, formatDateTime, formatTime, todayInEventTz, toSeriesView, toSwissMatchView, type MatchView } from '../data/view-model';
import { finalsMatchNoLabel } from '../domain/finals';
import { assignSides, sidesForSeriesGame } from '../domain/sides';
import { BackButton, CopyLinkButton, EmptyState, OriginalStart, ResultBadge, Section, SideBadge, StatusBadge, TeamName } from '../components/ui';
import { Icon } from '../components/Icon';

export function MatchDetailPage() {
  const { matchId = '' } = useParams();
  const { derived, loading } = useData();
  if (loading && !derived) return <div className="empty">正在加载比赛…</div>;
  if (!derived) return null;
  const { event, teamMap, venueLabels, finals } = derived;
  const swiss = event.swiss.matches.find((match) => match.id === matchId);
  const series = event.finals.series.find((match) => match.id === matchId);
  const view: MatchView | null = swiss ? toSwissMatchView(swiss, event, teamMap, venueLabels) : series ? toSeriesView(series, event, teamMap, venueLabels, finals) : null;
  if (!view) return <EmptyState title="找不到这场比赛" hint="该链接可能已经调整，请从赛程重新选择比赛。" action={<Link to="/schedule" className="btn">返回赛程</Link>} />;
  if (view.stage === 'showcase') return <ShowcaseMatchDetail view={view} />;
  const schedule = view.schedule;
  const sideNote = swiss ? `第 ${swiss.roundIndex} 轮${swiss.roundIndex % 2 === 0 ? ' · 偶数轮换边' : ''}` : series?.format === 'BO3' ? '全系列赛不换边' : '八强双败不换边';
  const relatedIds = new Set([matchId, ...(swiss ? [swiss.roundId] : []), ...(series?.games.map((game) => game.id) ?? [])]);
  const corrections = event.corrections.filter((entry) => entry.affectedIds.some((id) => relatedIds.has(id)));
  const records = swiss?.attempts ?? series?.games ?? [];
  const resultLabels: Record<string, string> = { normal: '正常比赛', 'early-end': '提前结束', 'walkover-before-start': '未开赛弃权', 'administrative-loss': '行政判负', 'administrative-stop': '行政判负中止' };

  return <div className="stack">
    <BackButton fallback="/schedule" label="返回赛程" />
    <div className="detail-heading"><div><div className="eyebrow">{view.stage === 'swiss' ? 'SWISS ROUND' : 'FINALS'}</div><h1>{view.title}</h1><div className="row" style={{ marginTop: 12 }}><StatusBadge status={view.executionStatus} /><ResultBadge status={view.resultStatus} />{view.format ? <span className="badge badge--neutral">{view.format}</span> : null}{!view.countsForStandings ? <span className="badge badge--neutral">不计正式排名</span> : null}</div></div><CopyLinkButton path={`/matches/${matchId}`} label="分享比赛" /></div>
    <div className="detail-grid">
      <div className="stack" style={{ gap: 26 }}>
        <section className="detail-scoreboard" aria-label="对阵与比分">
          <div className="section__head"><h2 className="section__title">对阵</h2><span className="xsmall muted">{sideNote}</span></div>
          {view.sides ? view.sides.map((side, index) => <div className="scoreboard-row" key={index}><div className="scoreboard-name">{view.sidesInfo ? <SideBadge side={index === 0 ? view.sidesInfo.first : view.sidesInfo.second} /> : null}<TeamName team={side.team} fallback={side.sourceLabel} />{side.isWinner ? <span className="winner-mark" aria-label="胜者"><Icon name="check" size={18} /></span> : null}</div><div className="scoreboard-value"><strong className="tabular" style={{ color: side.isWinner ? 'var(--advanced)' : undefined }}>{series?.format === 'BO3' ? (view.homeWins ?? 0) + (view.awayWins ?? 0) > 0 ? index === 0 ? view.homeWins : view.awayWins : '—' : side.score ?? '—'}</strong>{side.seconds !== null ? <div className="xsmall muted tabular">{side.seconds} 秒</div> : null}</div></div>) : <EmptyState title="对阵尚待公布" hint="现场确认后将显示参赛队伍。" />}
          {view.format !== 'BO1' && view.homeWins !== null && view.awayWins !== null && view.homeWins + view.awayWins > 0 ? <p className="small muted" style={{ marginTop: 14 }}>系列赛比分 <strong className="tabular">{view.homeWins} : {view.awayWins}</strong>{view.notNeededGames.length > 0 ? ` · 第 ${view.notNeededGames.join('、')} 局不需要进行` : ''}</p> : null}
          <div className="detail-timing">{schedule ? <span><Icon name="clock" size={16} />{formatDate(effectiveStart(schedule))} {formatTime(effectiveStart(schedule))}</span> : null}{view.venueLabel ? <span><Icon name="pin" size={16} />{view.venueLabel}</span> : null}{schedule?.revisedStart ? <span className="rescheduled">已改期 · 原定 <OriginalStart schedule={schedule} /></span> : null}</div>
        </section>

        {series?.format === 'BO3' ? <Section title="小局记录" action={<span className="xsmall muted">三局两胜 · 全系列赛不换边</span>}><div className="stack">{[...series.games].sort((a, b) => a.index - b.index).map((game) => {
          const notNeeded = view.notNeededGames.includes(game.index);
          const first = game.homeTeamId ?? series.participantSnapshot?.[0] ?? view.sides?.[0]?.team?.id ?? null;
          const second = game.awayTeamId ?? series.participantSnapshot?.[1] ?? view.sides?.[1]?.team?.id ?? null;
          const sides = first && second ? assignSides(first, second, sidesForSeriesGame(game.index)) : null;
          return <article className="card" key={game.id}><div className="card__head"><strong className="small">第 {game.index} 局</strong>{notNeeded ? <span className="badge badge--neutral">不需要进行</span> : game.resultStatus === 'none' ? <span className="badge badge--neutral">未开始</span> : <ResultBadge status={game.resultStatus} />}</div>{notNeeded ? <p className="small muted">系列赛已决出胜者，无需进行本局。</p> : <div className="stack stack--tight">{(['red', 'blue'] as const).map((color) => {
            const id = sides?.[color] ?? null;
            const score = id === null ? null : id === game.homeTeamId ? game.homeScore : id === game.awayTeamId ? game.awayScore : null;
            const seconds = id === null ? null : id === game.homeTeamId ? game.homeReachedSeconds : id === game.awayTeamId ? game.awayReachedSeconds : null;
            const winner = game.resultStatus === 'confirmed' && id !== null && id === game.winnerId;
            return <div className={`match-side${winner ? ' match-side--winner' : ''}`} key={color}><div className="match-side__name"><SideBadge side={color} /><TeamName team={id ? teamMap.get(id)?.team ?? null : null} fallback="对阵待定" />{winner ? <span className="winner-mark" aria-label="胜者"><Icon name="check" size={16} /></span> : null}</div><div className="match-side__result"><strong className="tabular">{score ?? '—'}</strong><span className="xsmall muted">{seconds ? `${seconds} 秒` : '到达最终分时间待确认'}</span></div></div>;
          })}</div>}</article>;
        })}</div><p className="xsmall muted" style={{ marginTop: 12 }}>先赢 2 局者胜；2–0 时第 3 局不需要进行，不计为未完赛。</p></Section> : null}

        {view.note || view.conflicts.length > 0 ? <Section title="比赛说明"><div className="card">{view.note ? <p className="small">{view.note}</p> : null}{view.conflicts.length > 0 ? <div className="inline-notice">相关赛果正在复核，更新后会在这里公布。<details className="disclosure"><summary>查看复核说明</summary><p className="xsmall">{view.conflicts.join('；')}</p></details></div> : null}</div></Section> : null}
        <details className="card result-history"><summary>原始成绩与更正记录<Icon name="chevron" size={17} /></summary><div className="stack" style={{ marginTop: 18 }}>
          {records.length > 0 ? records.map((record, index) => {
            const effective = swiss ? record.id === swiss.effectiveAttemptId : record.resultStatus === 'confirmed';
            const supersedesId = 'supersedesId' in record ? record.supersedesId : null;
            const previousIndex = supersedesId ? records.findIndex((entry) => entry.id === supersedesId) : -1;
            return <article className="record-card" key={record.id}><div className="record-card__head"><strong>{swiss ? `第 ${index + 1} 次记录` : `第 ${'index' in record ? record.index : index + 1} 局`}</strong><span className={`badge ${effective ? 'badge--advanced' : 'badge--neutral'}`}>{effective ? '当前有效' : record.resultStatus === 'none' ? '尚未录入' : '历史记录'}</span></div><div className="record-card__meta"><span>{resultLabels[record.resultKind] ?? record.resultKind}</span>{record.confirmedAt ? <span>确认于 {formatDateTime(record.confirmedAt)}</span> : null}{previousIndex >= 0 ? <span>替代第 {previousIndex + 1} 次记录</span> : null}</div><div className="stack stack--tight" style={{ marginTop: 12 }}>{[{ id: record.homeTeamId, score: record.homeScore, seconds: record.homeReachedSeconds }, { id: record.awayTeamId, score: record.awayScore, seconds: record.awayReachedSeconds }].map((side, sideIndex) => <div className="record-card__head" key={sideIndex}><span className="small">{side.id ? teamMap.get(side.id)?.displayName ?? '队伍待核对' : '队伍待定'}{record.winnerId && record.winnerId === side.id ? <span className="badge badge--advanced" style={{ marginLeft: 8 }}>胜者</span> : null}</span><span className="small tabular">{side.score ?? '—'} 分 · {side.seconds ?? '—'} 秒</span></div>)}</div>{record.note ? <p className="small" style={{ marginTop: 10 }}>裁判说明：{record.note}</p> : null}</article>;
          }) : <p className="small muted">本场尚未录入原始成绩。</p>}
          {corrections.length > 0 ? <section><h3 className="small">更正记录</h3>{[...corrections].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((entry) => <article className="record-card" key={entry.id}><div className="record-card__meta">{formatDateTime(entry.at)}</div><p className="small" style={{ marginTop: 7 }}>{entry.reason}</p>{entry.previousValue ? <p className="xsmall muted">更正前：{entry.previousValue}</p> : null}{entry.newValue ? <p className="xsmall">更正后：{entry.newValue}</p> : null}{entry.note ? <p className="xsmall muted">组委会说明：{entry.note}</p> : null}<span className={`badge ${entry.allowsProgress ? 'badge--advanced' : 'badge--pending'}`}>{entry.allowsProgress ? '复核后继续比赛' : '等待复核，暂停推进'}</span></article>)}</section> : <p className="xsmall muted">暂无与本场相关的更正记录。</p>}
        </div></details>
      </div>
      <aside className="stack" style={{ gap: 26 }}>
        <Section title="时间与场地"><div className="card stack stack--tight">
          <DetailRow label={schedule?.revisedStart ? '调整后开始' : '计划开始'} value={schedule ? `${formatDate(effectiveStart(schedule))} ${formatTime(effectiveStart(schedule))}` : '待定'} />
          {schedule?.revisedStart ? <DetailRow label="原计划开始" value={formatDateTime(schedule.plannedStart)} /> : null}
          <DetailRow label="计划结束" value={schedule?.plannedEnd ? formatTime(schedule.plannedEnd) : series?.format === 'BO3' ? '随系列赛进程确定' : '待现场确认'} />
          <DetailRow label="场地" value={view.venueLabel ?? '待定'} />
          {schedule?.afterSeriesId ? <DetailRow label="前序安排" value={`${finalsMatchNoLabel(schedule.afterSeriesId) ?? '前一场比赛'}结束后开始`} /> : null}
          {schedule?.adjustmentNote ? <p className="inline-notice">{schedule.adjustmentNote}</p> : null}
          <p className="xsmall muted" style={{ marginTop: 12 }}>时间仅供参考，具体情况以现场安排为准。{series?.format === 'BO3' ? 'BO3 无固定结束时刻。' : ''}</p>
        </div></Section>
        <Section title="相关比赛"><div className="card"><RelatedMatches matchId={matchId} /></div></Section>
        <Link to="/progress" className="btn">查看晋级进展<Icon name="bracket" size={18} /></Link>
      </aside>
    </div>
  </div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}><span className="small muted">{label}</span><span className="small" style={{ textAlign: 'right' }}>{value}</span></div>;
}

/** 展示组只有演出队伍与安排，不沿用竞技比赛的双队、比分和晋级结构。 */
function ShowcaseMatchDetail({ view }: { view: MatchView }) {
  const { derived } = useData();
  if (!derived) return null;
  const schedule = view.schedule;
  const performer = view.sides?.[0];
  const series = derived.event.finals.series.find((entry) => entry.id === view.id);
  const relatedIds = new Set([view.id, ...(series?.games.map((game) => game.id) ?? [])]);
  const corrections = derived.event.corrections.filter((entry) => entry.affectedIds.some((id) => relatedIds.has(id)));
  const records = series?.games.filter((game) => game.resultStatus !== 'none' || game.note !== null) ?? [];
  const scheduleParams = new URLSearchParams({ stage: 'showcase' });
  if (schedule) scheduleParams.set('date', todayInEventTz(new Date(effectiveStart(schedule))));
  if (performer?.team) scheduleParams.set('team', performer.team.id);
  return (
    <div className="stack">
      <BackButton fallback="/schedule" label="返回赛程" />
      <div className="detail-heading">
        <div>
          <div className="eyebrow">SHOWCASE</div>
          <h1>{view.title}</h1>
          <div className="row" style={{ marginTop: 12 }}><StatusBadge status={view.executionStatus} /><span className="badge badge--neutral">单队展示</span><span className="badge badge--neutral">不计竞技排名</span></div>
        </div>
        <CopyLinkButton path={`/matches/${view.id}`} label="分享演出" />
      </div>
      <div className="detail-grid">
        <div className="stack" style={{ gap: 26 }}>
          <section className="detail-scoreboard" aria-label="演出队伍与安排">
            <div className="section__head"><h2 className="section__title">演出队伍</h2></div>
            <div className="scoreboard-row"><div className="scoreboard-name"><TeamName team={performer?.team ?? null} fallback={performer?.sourceLabel ?? '演出队伍待抽签'} /></div></div>
            <p className="small muted" style={{ marginTop: 14 }}>{performer?.team ? '演出队伍与上台顺序已按抽签结果公布。' : '上台顺序由现场抽签决定，确认后将在这里公布。'}</p>
            <div className="detail-timing">
              {schedule ? <span><Icon name="clock" size={16} />{formatDate(effectiveStart(schedule))} {formatTime(effectiveStart(schedule))}</span> : null}
              {view.venueLabel ? <span><Icon name="pin" size={16} />{view.venueLabel}</span> : null}
              {schedule?.revisedStart ? <span className="rescheduled">已改期 · 原定 <OriginalStart schedule={schedule} /></span> : null}
            </div>
          </section>
          {view.note ? <Section title="演出说明"><div className="card"><p className="small">{view.note}</p></div></Section> : null}
          {records.length > 0 || corrections.length > 0 ? <details className="card result-history">
            <summary>演出记录与更正<Icon name="chevron" size={17} /></summary>
            <div className="stack" style={{ marginTop: 18 }}>
              {records.map((record, index) => <article className="record-card" key={record.id}><strong className="small">演出记录 {index + 1}</strong>{record.confirmedAt ? <p className="xsmall muted">确认于 {formatDateTime(record.confirmedAt)}</p> : null}{record.note ? <p className="small">{record.note}</p> : null}</article>)}
              {corrections.map((entry) => <article className="record-card" key={entry.id}><div className="record-card__meta">{formatDateTime(entry.at)}</div><p className="small">{entry.reason}</p>{entry.previousValue ? <p className="xsmall muted">更正前：{entry.previousValue}</p> : null}{entry.newValue ? <p className="xsmall">更正后：{entry.newValue}</p> : null}{entry.note ? <p className="xsmall muted">组委会说明：{entry.note}</p> : null}</article>)}
            </div>
          </details> : null}
        </div>
        <aside className="stack" style={{ gap: 26 }}>
          <Section title="时间与场地"><div className="card stack stack--tight">
            <DetailRow label={schedule?.revisedStart ? '调整后开始' : '计划开始'} value={schedule ? formatDateTime(effectiveStart(schedule)) : '待定'} />
            {schedule?.revisedStart ? <DetailRow label="原计划开始" value={formatDateTime(schedule.plannedStart)} /> : null}
            <DetailRow label="计划结束" value={schedule?.plannedEnd ? formatTime(schedule.plannedEnd) : '待现场确认'} />
            <DetailRow label="场地" value={view.venueLabel ?? '待定'} />
            {schedule?.adjustmentNote ? <p className="inline-notice">{schedule.adjustmentNote}</p> : null}
            <p className="xsmall muted">时间仅供参考，具体情况以现场安排为准。</p>
          </div></Section>
          <Link to={`/schedule?${scheduleParams.toString()}`} className="btn">查看展示组赛程<Icon name="calendar" size={18} /></Link>
          {performer?.team ? <Link to={`/teams/${performer.team.id}`} className="btn">查看队伍全部安排<Icon name="users" size={18} /></Link> : null}
        </aside>
      </div>
    </div>
  );
}

function RelatedMatches({ matchId }: { matchId: string }) {
  const { derived } = useData();
  if (!derived) return null;
  const { event, teamMap, venueLabels, finals } = derived;
  const series = event.finals.series.find((entry) => entry.id === matchId);
  if (!series) {
    const match = event.swiss.matches.find((entry) => entry.id === matchId);
    const sameRound = event.swiss.matches.filter((entry) => entry.roundIndex === match?.roundIndex && entry.id !== matchId).slice(0, 6);
    return <div className="stack stack--tight"><span className="xsmall muted">同轮其他场次</span>{sameRound.map((entry) => { const view = toSwissMatchView(entry, event, teamMap, venueLabels); return <Link key={entry.id} to={`/matches/${entry.id}`} className="related-match-link"><span>{view.sides?.map((side) => side.team?.name ?? side.sourceLabel).join(' / ') || view.title}</span><Icon name="chevron" size={15} /></Link>; })}</div>;
  }
  const related: { id: string; label: string }[] = [];
  for (const slot of series.slots ?? []) if (slot.kind === 'winner' || slot.kind === 'loser') related.push({ id: slot.seriesId, label: `来自${finalsMatchNoLabel(slot.seriesId) ?? '前场'}${slot.kind === 'winner' ? '胜者' : '败者'}` });
  for (const other of event.finals.series) for (const slot of other.slots ?? []) if ((slot.kind === 'winner' || slot.kind === 'loser') && slot.seriesId === matchId) related.push({ id: other.id, label: `${slot.kind === 'winner' ? '胜者' : '败者'}进入${finalsMatchNoLabel(other.id) ?? '下一场'}` });
  if (related.length === 0) return <p className="small muted">本场没有关联比赛。</p>;
  return <div className="stack stack--tight">{related.map((entry) => { const target = event.finals.series.find((item) => item.id === entry.id); const title = target ? toSeriesView(target, event, teamMap, venueLabels, finals).title : entry.label; return <Link key={`${entry.id}-${entry.label}`} to={`/matches/${entry.id}`} className="related-match-link"><span><strong>{entry.label}</strong><span className="xsmall muted" style={{ display: 'block' }}>{title}</span></span><Icon name="chevron" size={15} /></Link>; })}</div>;
}
