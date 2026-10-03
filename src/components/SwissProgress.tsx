/** 瑞士轮：规则去向、现场对阵与队伍历程分别表达。 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryParams } from '../app/useQueryParams';
import { useData } from '../data/DataProvider';
import { buildSwissPresentation, selectSwissRound, type SwissGroupPresentation, type SwissMatchPresentation, type SwissRoundPresentation } from '../data/swiss-presentation';
import { effectiveStart, formatDate, formatTime } from '../data/view-model';
import type { StandingsEntry } from '../domain/standings';
import { sidesForSwiss } from '../domain/sides';
import { EmptyState, OriginalStart, PublicationBadge, ResultBadge, SideBadge, StatusBadge, TeamName } from './ui';
import '../styles/swiss-progress.css';

type SummaryKind = 'advanced' | 'active' | 'eliminated';
type MapPath = { id: string; d: string; x: number; y: number; win: boolean };
const SUMMARY_LABELS: Record<SummaryKind, string> = { advanced: '已晋级', active: '仍在争夺', eliminated: '已淘汰' };
const EMPTY_LABELS: Record<SummaryKind, string> = { advanced: '尚无队伍达到三胜。', active: '所有参赛队伍均已完成瑞士轮。', eliminated: '尚无队伍累计三负。' };

function recordLabel(record: string): string {
  const [wins, losses] = record.split('-');
  return `${wins} 胜 ${losses} 负`;
}

function destination(record: string, win: boolean) {
  const [wins = 0, losses = 0] = record.split('-').map(Number);
  const nextWins = wins + (win ? 1 : 0);
  const nextLosses = losses + (win ? 0 : 1);
  return { record: `${nextWins}-${nextLosses}`, terminal: nextWins === 3 ? '晋级八强' : nextLosses === 3 ? '淘汰' : null };
}

function useCompactViewport() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

export function SwissProgress() {
  const { derived } = useData();
  const { params, setParams } = useQueryParams();
  const compact = useCompactViewport();
  const [layoutChoice, setLayoutChoice] = useState<'round' | 'overview' | null>(null);
  const [summaryKind, setSummaryKind] = useState<SummaryKind>('advanced');
  const model = useMemo(() => derived ? buildSwissPresentation(derived) : null, [derived]);
  const detailsRef = useRef<HTMLDivElement>(null);
  const detailsId = useId();
  const requested = params.has('round') ? Number(params.get('round')) : null;
  const round = model ? selectSwissRound(model, requested) : null;
  const selectedTeam = params.get('team');
  const selectedGroup = round?.groups.some(group => group.record === params.get('group')) ? params.get('group') : null;
  const overview = (layoutChoice ?? (compact ? 'round' : 'overview')) === 'overview';

  if (!derived || !model || !round) return <EmptyState title="尚无瑞士轮数据" />;
  const journey = selectedTeam ? model.journeys.get(selectedTeam) ?? [] : [];
  const highlightedGroups = new Set(journey.map(step => `${step.roundIndex}:${step.groupRecord}`));
  const team = selectedTeam ? derived.teamMap.get(selectedTeam)?.team : null;
  const selectGroup = (roundIndex: number, record: string) => {
    setParams({ round: String(roundIndex), group: record });
    detailsRef.current?.focus({ preventScroll: true });
    detailsRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };

  return <div className="swiss-progress">
    <section className="swiss-summary card" aria-label="瑞士轮晋级概览">
      <div className="swiss-section-heading"><div><h2>八强席位争夺</h2><p className="small muted">三胜晋级 · 三负淘汰 · 每轮重新配对</p></div><span className="swiss-eyebrow">16 → 8</span></div>
      <div className="swiss-summary__tabs" role="group" aria-label="查看晋级状态名单">
        {(['advanced', 'active', 'eliminated'] as const).map(kind => <button type="button" key={kind} className={`swiss-summary__tab swiss-summary__tab--${kind}`} aria-label={`${SUMMARY_LABELS[kind]} ${model.summary[kind].length}${kind === 'advanced' ? '/8' : ''}`} aria-pressed={summaryKind === kind} onClick={() => setSummaryKind(kind)}>
          <span>{SUMMARY_LABELS[kind]}</span><strong className="tabular">{model.summary[kind].length}{kind === 'advanced' ? <small>/8</small> : null}</strong>
        </button>)}
      </div>
      {!model.qualifiedTeamIds.length ? <p className="small muted">瑞士轮参赛名单待正式排位赛排名确认。</p> : <div className="swiss-roster" aria-label={`${SUMMARY_LABELS[summaryKind]}队伍名单`}>
        {model.summary[summaryKind].map(entry => <button type="button" key={entry.teamId} className="swiss-team-chip" aria-pressed={selectedTeam === entry.teamId} onClick={() => setParams({ team: selectedTeam === entry.teamId ? null : entry.teamId })}>
          <span>{derived.teamMap.get(entry.teamId)?.team.name ?? '队伍待核对'}</span><span className="tabular">{recordLabel(entry.record)}</span>
        </button>)}
        {!model.summary[summaryKind].length ? <p className="small muted">{EMPTY_LABELS[summaryKind]}</p> : null}
      </div>}
      {summaryKind === 'advanced' && model.summary.advanced.length > 0 ? <p className="xsmall muted swiss-summary__note">已获八强资格；八强名次以最终结算和正式公布为准。</p> : null}
    </section>

    {selectedTeam ? <section className="swiss-team-journey card" aria-label="队伍瑞士轮历程">
      <div className="swiss-section-heading"><h3>{team?.name ?? '所选队伍'} · 瑞士轮历程</h3><button className="btn btn--small" type="button" onClick={() => setParams({ team: null })}>清除队伍定位</button></div>
      {journey.length ? <ol className="swiss-team-journey__steps">{journey.map(step => {
        const opponentId = step.match.sides?.find(side => side.teamId !== selectedTeam)?.teamId;
        const opponent = opponentId ? derived.teamMap.get(opponentId)?.team.name : null;
        return <li key={step.match.view.id}>
          <span className={`swiss-outcome swiss-outcome--${step.side.outcome ?? 'pending'}`}>{step.side.outcome === 'win' ? '胜' : step.side.outcome === 'loss' ? '负' : '待赛果'}</span>
          <div><Link to={`/matches/${step.match.view.id}`}>R{step.roundIndex} · 第 {step.match.view.matchNo} 场</Link><p>对阵 {opponent ?? '队伍待核对'}</p><p className="small muted">{recordLabel(step.side.preRecord)}{step.side.postRecord ? ` → ${recordLabel(step.side.postRecord)}` : ' · 赛果待确认'}</p>
            {step.match.crossGroup ? <p className="xsmall swiss-adjustment">跨组调整 · 在 {step.groupRecord} 组场次参赛</p> : null}
          </div>
        </li>;
      })}</ol> : <p className="small muted">该队暂无已公布的瑞士轮对阵。</p>}
      {journey.at(-1) ? <p className="swiss-team-journey__condition">{journey.at(-1)!.side.condition}</p> : null}
    </section> : null}

    <section className="swiss-route card" aria-label="瑞士轮赛制与轮次">
      <div className="swiss-section-heading"><div><h2>{overview ? '瑞士轮全景' : '按轮次查看'}</h2><p className="small muted">战绩为进入本轮时的战绩；胜负去向表示常规赛制。</p></div><button className="btn btn--small" type="button" aria-pressed={overview} onClick={() => setLayoutChoice(overview ? 'round' : 'overview')}>{overview ? '按轮次查看' : '查看全景'}</button></div>
      <div className="swiss-round-tabs segmented" role="group" aria-label="选择瑞士轮轮次">
        {model.rounds.map(item => <button type="button" className="segmented__item" key={item.id} aria-label={`R${item.index}`} aria-pressed={item.index === round.index} onClick={() => setParams({ round: String(item.index), group: null })}><span>R{item.index}</span><small>{item.publicationStatus !== 'published' ? '待公布' : item.complete ? '已完成' : '已公布'}</small></button>)}
      </div>
      {overview ? <SwissMap rounds={model.rounds} selectedRound={round.index} selectedGroup={selectedGroup} highlightedGroups={highlightedGroups} detailsId={detailsId} onSelect={selectGroup} /> : <div className="swiss-round-groups">{round.groups.map(group => <GroupNode key={group.record} round={round} group={group} active={!selectedGroup || selectedGroup === group.record} highlighted={highlightedGroups.has(`${round.index}:${group.record}`)} detailsId={detailsId} onSelect={selectGroup} />)}</div>}
      <p className="swiss-route__note xsmall muted">每轮对手以正式公布为准。组委会调整时，实际战绩与参赛历程见下方详情。</p>
    </section>

    <div className="swiss-round-details" ref={detailsRef} id={detailsId} tabIndex={-1}>
      <div className="swiss-section-heading"><div><h2>第 {round.index} 轮对阵</h2><p className="small muted">{round.publicationStatus === 'published' ? `已确认 ${round.confirmedCount} / ${round.matchCount} 场` : '对阵待公布 · 可查看预留场次安排'}</p></div><PublicationBadge status={round.publicationStatus} /></div>
      {round.publishedAt && round.publicationStatus === 'published' ? <p className="xsmall muted">公布时间：{formatDate(round.publishedAt)} {formatTime(round.publishedAt)}</p> : null}
      {round.publicationStatus !== 'published' ? <p className="small muted">{round.publicationStatus === 'superseded' ? '本轮对阵已作废，等待组委会重新公布。' : !model.qualifiedTeamIds.length ? '等待排位赛正式名次确认后公布对阵。' : round.index > 1 && !model.rounds.find(item => item.index === round.index - 1)?.complete ? `等待第 ${round.index - 1} 轮结果确认后公布对阵。` : '配对依据已就绪，等待组委会正式公布对阵。'}</p> : null}
      {round.revisionNote ? <p className="swiss-revision" role="note">组委会修订：{round.revisionNote}</p> : null}
      <div className="round-tabs" role="group" aria-label="选择战绩组">{[null, ...round.groups.map(group => group.record)].map(record => <button className="btn" type="button" key={record ?? 'all'} aria-pressed={selectedGroup === record} onClick={() => setParams({ group: record })}>{record ? `${record} 组` : '全部战绩组'}</button>)}</div>
      {round.groups.filter(group => !selectedGroup || group.record === selectedGroup).map(group => <section className="swiss-group-details" key={`${round.index}:${group.record}`} aria-label={`R${round.index} ${group.record} 组对阵`}>
        <div className="swiss-group-details__heading"><h3>{recordLabel(group.record)}组 <span className="small muted">{group.details.length} 场</span></h3>{group.details.some(match => match.crossGroup) ? <span className="badge badge--pending">含跨组调整</span> : null}</div>
        <div className="match-grid">{group.details.map(match => <SwissMatchCard key={match.view.id} match={match} />)}</div>
        {group.entries.length ? <SwissScores entries={group.entries} roundIndex={round.index} /> : null}
      </section>)}
    </div>
  </div>;
}

function GroupNode({ round, group, active, highlighted, detailsId, onSelect }: { round: SwissRoundPresentation; group: SwissGroupPresentation; active: boolean; highlighted: boolean; detailsId: string; onSelect: (round: number, record: string) => void }) {
  const published = round.publicationStatus === 'published';
  return <button className={`swiss-group-node${active ? ' is-selected' : ''}${highlighted ? ' is-highlighted' : ''}`} type="button" data-swiss-group={`${round.index}:${group.record}`} aria-pressed={active} aria-controls={detailsId} aria-label={`查看 R${round.index} ${group.record} 组对阵`} onClick={() => onSelect(round.index, group.record)}>
    <strong>{recordLabel(group.record)}</strong><span className="swiss-group-node__progress">{published ? `已确认 ${group.confirmedCount} / ${group.details.length} 场` : '对阵待公布'}</span>
    <span className="swiss-group-node__meter" aria-hidden="true"><span style={{ width: `${group.details.length ? group.confirmedCount / group.details.length * 100 : 0}%` }} /></span>
    {([true, false] as const).map(win => { const to = destination(group.record, win); return <span className={`swiss-group-node__destination${to.terminal ? win ? ' is-advanced' : ' is-eliminated' : ''}`} key={String(win)}><b>{win ? '胜' : '负'}</b><span>→ {to.terminal ? `${to.record} ${to.terminal}` : recordLabel(to.record)}</span></span>; })}
    {group.details.some(match => match.crossGroup) ? <span className="xsmall swiss-adjustment">含跨组调整</span> : null}
  </button>;
}

function SwissMap({ rounds, selectedRound, selectedGroup, highlightedGroups, detailsId, onSelect }: { rounds: SwissRoundPresentation[]; selectedRound: number; selectedGroup: string | null; highlightedGroups: Set<string>; detailsId: string; onSelect: (round: number, record: string) => void }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const markerId = useId().replace(/:/g, '');
  const [geometry, setGeometry] = useState<{ width: number; height: number; paths: MapPath[] }>({ width: 0, height: 0, paths: [] });
  useLayoutEffect(() => {
    const board = boardRef.current;
    const scroller = board?.parentElement;
    const column = board?.querySelector<HTMLElement>(`[data-swiss-group^="${selectedRound}:"]`);
    if (!board || !scroller || !column || scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollTo({ left: column.getBoundingClientRect().left - board.getBoundingClientRect().left - 4, behavior: 'instant' });
  }, [selectedRound]);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      const bounds = board.getBoundingClientRect();
      const nodes = new Map([...board.querySelectorAll<HTMLElement>('[data-swiss-group]')].map(node => [node.dataset.swissGroup!, node.getBoundingClientRect()]));
      const paths: MapPath[] = [];
      for (const round of rounds) for (const group of round.groups) for (const win of [true, false]) {
        const target = destination(group.record, win);
        if (target.terminal) continue;
        const from = nodes.get(`${round.index}:${group.record}`);
        const to = nodes.get(`${round.index + 1}:${target.record}`);
        if (!from || !to) continue;
        const x1 = from.right - bounds.left + 2;
        const x2 = to.left - bounds.left - 4;
        const y1 = from.top - bounds.top + from.height * (win ? .35 : .65);
        const y2 = to.top - bounds.top + to.height * (win ? .65 : .35);
        const middle = (x1 + x2) / 2;
        paths.push({ id: `${round.index}:${group.record}:${win}`, d: `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`, x: x1 + 9, y: y1 - 5, win });
      }
      setGeometry(previous => {
        const next = { width: bounds.width, height: bounds.height, paths };
        return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    board.querySelectorAll('[data-swiss-group]').forEach(node => observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, [rounds]);
  return <div className="swiss-map" role="group" aria-label="瑞士轮五轮全景，可横向滚动" tabIndex={0}>
    <div className="swiss-map__board" ref={boardRef}>
      <svg className="swiss-map__arrows" width={geometry.width} height={geometry.height} aria-hidden="true"><defs><marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8" fill="none" stroke="context-stroke" strokeWidth="1.5" /></marker></defs>{geometry.paths.map(path => <g key={path.id} className={path.win ? 'swiss-map__win' : 'swiss-map__loss'}><path d={path.d} markerEnd={`url(#${markerId})`} /><text x={path.x} y={path.y}>{path.win ? '胜' : '负'}</text></g>)}</svg>
      <div className="swiss-map__columns">{rounds.map(round => <div className="swiss-map__column" key={round.id}><div className={`swiss-map__heading${round.index === selectedRound ? ' is-current' : ''}`}><strong>第 {round.index} 轮</strong><span>{round.publicationStatus !== 'published' ? '待公布' : round.complete ? '已完成' : '已公布'}</span></div><div className="swiss-map__groups">{round.groups.map(group => <GroupNode key={group.record} round={round} group={group} active={selectedRound === round.index && (!selectedGroup || selectedGroup === group.record)} highlighted={highlightedGroups.has(`${round.index}:${group.record}`)} detailsId={detailsId} onSelect={onSelect} />)}</div></div>)}</div>
    </div>
  </div>;
}

function SwissMatchCard({ match }: { match: SwissMatchPresentation }) {
  const { derived } = useData();
  const view = match.view;
  const schedule = view.schedule;
  const start = schedule ? effectiveStart(schedule) : null;
  const slotSides = sidesForSwiss(view.roundIndex ?? 1);
  return <article className={`match-card card swiss-match${view.executionStatus === 'running' ? ' match-card--live' : ''}${match.confirmed ? ' match-card--done' : ''}`} data-match-id={view.id}>
    <div className="match-card__head"><div className="match-card__time"><time dateTime={start ?? undefined}>{start ? formatTime(start) : '时间待定'}</time>{start ? <span className="xsmall muted">{formatDate(start)}</span> : null}{schedule?.revisedStart ? <span className="rescheduled">已改期 <OriginalStart schedule={schedule} /></span> : null}</div><StatusBadge status={view.executionStatus} /></div>
    <div className="match-card__context"><span className="match-card__no">第 {view.matchNo} 场</span><span>{view.venueLabel}</span><span>BO1</span>{match.crossGroup ? <span className="swiss-adjustment">跨组调整</span> : null}</div>
    {match.sides ? <div className="swiss-match__sides">{match.sides.map((side, index) => {
      const result = view.sides?.[index];
      const team = derived?.teamMap.get(side.teamId)?.team ?? null;
      return <div className={`swiss-match__side${side.outcome === 'win' ? ' is-winner' : ''}`} key={side.teamId}>
        <div><div className="swiss-match__team"><SideBadge side={index === 0 ? slotSides.first : slotSides.second} /><TeamName team={team} fallback="队伍待核对" />{side.outcome ? <span className={`swiss-outcome swiss-outcome--${side.outcome}`} aria-label={side.outcome === 'win' ? '胜者' : '负者'}>{side.outcome === 'win' ? '胜' : '负'}</span> : null}</div><p className="swiss-match__record">赛前 {recordLabel(side.preRecord)}{side.postRecord ? ` → ${recordLabel(side.postRecord)}` : ''}</p><p className="swiss-match__condition">{side.condition}</p></div>
        <div className="match-side__result">{result?.score !== null && result?.score !== undefined ? <strong>{result.score}<span className="visually-hidden"> 分</span></strong> : null}{result?.seconds ? <span className="xsmall muted">{result.seconds} 秒</span> : null}</div>
      </div>;
    })}</div> : <div className="swiss-match__pending"><p>对阵待公布</p><p className="xsmall muted">正式公布前不确定参赛队伍。</p><div className="swiss-match__slot-sides xsmall muted"><span>第一席位 <SideBadge side={slotSides.first} /></span><span>第二席位 <SideBadge side={slotSides.second} /></span></div></div>}
    {match.confirmed && match.resultKind && !['normal', 'early-end'].includes(match.resultKind) ? <p className="match-card__notice">{match.resultKind === 'walkover-before-start' ? '未开赛弃权' : '行政判负中止'} · 以裁判确认胜负结算</p> : null}
    {schedule?.adjustmentNote ? <p className="match-card__notice">{schedule.adjustmentNote}</p> : null}
    <div className="match-card__footer"><ResultBadge status={view.resultStatus} /><Link className="match-card__open" to={`/matches/${view.id}`} aria-label={`查看比赛详情：${view.title}`}>比赛详情 →</Link></div>
  </article>;
}

function SwissScores({ entries, roundIndex }: { entries: StandingsEntry[]; roundIndex: number }) {
  const { derived } = useData();
  const [expanded, setExpanded] = useState(false);
  return <div className="swiss-scores"><button className="btn btn--small" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起评分明细' : '展开评分明细'}</button>{expanded ? <div className="swiss-scores__content"><p className="xsmall muted">赛前参考评分：{roundIndex === 1 ? '依据正式排位赛名次' : `截至 R${roundIndex - 1} 已确认成绩`}。名次为各真实战绩组内参考名次，对阵以公布名单为准。</p><div className="table-wrap"><table className="table"><thead><tr><th>组内名次</th><th className="table__team">队伍</th><th>赛前战绩</th>{['R', 'A', 'B', 'P', 'O', 'T'].map(metric => <th key={metric}>{metric}</th>)}</tr></thead><tbody>{entries.map(entry => <tr key={entry.teamId}><td>{entry.rankWithinGroup || '—'}</td><td className="table__team"><TeamName team={derived?.teamMap.get(entry.teamId)?.team ?? null} fallback="队伍待核对" /></td><td>{entry.record}</td>{(['r', 'a', 'b', 'p', 'o', 't'] as const).map(metric => <td key={metric} className="tabular">{entry.display[metric]}</td>)}</tr>)}</tbody></table></div></div> : null}</div>;
}
