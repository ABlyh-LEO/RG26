/**
 * 晋级页：谁晋级了，下一轮怎么打。
 *
 * 三个视图：排位赛、瑞士轮、决赛。
 * - 排位赛区分“出场安排（三审顺序）”与“正式排名”。
 * - 瑞士轮按轮次显示战绩分组，默认只显示名次/队伍/战绩/R，展开看 A/B/P/O/T。
 * - 决赛桌面用固定流向图，手机按实际比赛顺序纵向卡片。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryParams } from '../app/useQueryParams';
import { useData } from '../data/DataProvider';
import { useEventClock } from '../data/clock';
import {
  deriveRounds,
  formatDate,
  formatTime,
  effectiveStart,
  type RoundGroupView,
} from '../data/view-model';
import { toSeriesView } from '../data/view-model';
import { EmptyState, MatchCard, PublicationBadge, TeamName } from '../components/ui';
import { BracketChart, type BracketNodeContent } from '../components/BracketChart';
import { FinalsBracket } from '../components/FinalsBracket';
import { FINAL_ROUNDS, finalsIncoming, finalsOutgoing } from '../data/finals-presentation';
import { buildSwissModel, nodeParticipants } from '../data/bracket-model';
import { sidesForFinals, sidesForSeriesGame, sidesForSwiss } from '../domain/sides';
import { FINALS_MATCH_ORDER, FINALS_SEED_ORDER, finalsSeedLabel, type FinalsResolution } from '../domain/finals';
import type { StandingsEntry } from '../domain/standings';
import type { EventFile } from '../domain/schema';

type View = 'qualification' | 'swiss' | 'finals' | 'journey';

export function ProgressPage() {
  const { derived, loading } = useData();
  const { params, setParams } = useQueryParams();
  const now = useEventClock();
  const event = derived?.event;
  const currentStage: View = event && (
    event.finals.seeding?.publicationStatus === 'published' ||
    event.finals.series.some((s) => s.countsForStandings && s.executionStatus !== 'scheduled') ||
    event.scheduleItems.some((s) => s.referenceId === 'F-M1' && Date.parse(effectiveStart(s)) <= now.getTime())
  ) ? 'finals' : event && (
    event.qualification.ranking.status === 'confirmed' ||
    event.swiss.matches.some((m) => m.executionStatus !== 'scheduled') ||
    event.scheduleItems.some((s) => s.stage === 'swiss' && Date.parse(effectiveStart(s)) <= now.getTime())
  ) ? 'swiss' : 'qualification';
  const requestedView = params.get('view');
  const view: View = ['qualification', 'swiss', 'finals', 'journey'].includes(requestedView ?? '')
    ? requestedView as View : currentStage;

  if (loading && !derived) return <div className="empty">正在加载晋级信息…</div>;
  if (!derived) return null;

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="page-head">
        <h1 className="page-head__title">晋级</h1>
        <p className="page-head__sub">排位赛 → 瑞士轮十六进八 → 八强决赛</p>
      </div>

      <div className="segmented" role="group" aria-label="选择赛段视图">
        {(
          [
            ['qualification', '排位赛'],
            ['swiss', '瑞士轮'],
            ['finals', '决赛'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="segmented__item"
            aria-pressed={view === key}
            onClick={() => setParams({ view: key, mode: null })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="progress-tools">
        <label className="progress-team-picker">定位队伍
          <select aria-label="定位队伍" value={params.get('team') ?? ''} onChange={(e) => setParams({ team: e.target.value || null })}>
            <option value="">全部队伍</option>
            {derived.event.teams.filter((t) => t.division === 'competitive').map((t) => <option key={t.id} value={t.id}>{t.number} 号 · {t.name}</option>)}
          </select>
        </label>
        <button className="btn" type="button" onClick={() => setParams({ view: view === 'journey' ? currentStage : 'journey', mode: null })}>
          {view === 'journey' ? '返回轮次视图' : '打开完整晋级图'}
        </button>
      </div>

      {view === 'qualification' ? <QualificationView /> : null}
      {view === 'swiss' ? <SwissView /> : null}
      {view === 'finals' ? <FinalsView /> : null}
      {view === 'journey' ? <FullJourneyView /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 排位赛
 * ------------------------------------------------------------------ */

function QualificationView() {
  const { derived } = useData();
  const { params } = useQueryParams();
  const selectedTeam = params.get('team');

  /**
   * 按批次组织出场安排，直接读跑图与日程数据。
   *
   * 一个批次同时上场**两支**队伍（三审第 2b-1、2b 名），
   * 因此每个批次每轮要保留两条记录，而不是一条。
   *
   * 这里刻意不用硬编码的字符串拼时间 —— 那种写法会在分钟溢出时
   * 产生 Invalid Date，也无法反映真实场地。
   *
   * hook 必须在提前 return 之前调用。
   */
  const batches = useMemo(() => {
    if (!derived) return [];
    const { event, teamMap } = derived;
    type Run = (typeof event.qualification.runs)[number];
    const slots = new Map<number, { round1: Run[]; round2: Run[] }>();

    for (const run of event.qualification.runs) {
      if (selectedTeam && run.teamId !== selectedTeam) continue;
      const rank = teamMap.get(run.teamId)?.team?.thirdReviewRank;
      if (rank === undefined || rank === null) continue;
      const batch = Math.ceil(rank / 2);
      const slot = slots.get(batch) ?? { round1: [], round2: [] };
      if (run.round === 1) slot.round1.push(run);
      else slot.round2.push(run);
      slots.set(batch, slot);
    }

    // 批内按三审排名排序，保证第 1 名在第 2 名之前
    const byRank = (a: Run, b: Run) => {
      const ra = teamMap.get(a.teamId)?.team?.thirdReviewRank ?? 99;
      const rb = teamMap.get(b.teamId)?.team?.thirdReviewRank ?? 99;
      return ra - rb;
    };

    return [...slots.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([batch, slot]) => ({
        batch,
        round1: [...slot.round1].sort(byRank),
        round2: [...slot.round2].sort(byRank),
      }));
  }, [derived, selectedTeam]);

  if (!derived) return null;
  const { event, qualification, teamMap } = derived;

  const status = qualification.status;
  const confirmed = status === 'confirmed';

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="card">
        <div className="card__head">
          <span className="card__title">正式排名</span>
          <span className="row" style={{ gap: 'var(--sp-1)' }}>
            <PublicationBadge status={event.qualification.ranking.publicationStatus} />
            {confirmed ? (
              <span className="badge badge--advanced">已确认</span>
            ) : (
              <span className="badge badge--pending">待裁判确认</span>
            )}
          </span>
        </div>

        {!confirmed ? (
          <EmptyState
            title="正式排名尚未公布"
            hint="排位赛两轮结束后，由裁判组核分确认 1–22 名的最终排名。确认前不推测名次。"
          />
        ) : (
          <>
            <p className="xsmall muted">
              第 1–16 名晋级十六强，第 17–22 名结算优秀奖。两轮取最优成绩，同分规则由裁判确认。
              {event.qualification.ranking.sourceNote ? ` 来源：${event.qualification.ranking.sourceNote}` : ''}
            </p>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">排位赛正式排名</caption>
                <thead>
                  <tr>
                    <th className="num">名次</th>
                    <th className="table__team">队伍</th>
                    <th className="num">编号</th>
                    <th>最优成绩</th>
                    <th>晋级状态</th>
                  </tr>
                </thead>
                <tbody>
                  {qualification.orderedTeamIds.map((teamId, index) => {
                    if (selectedTeam && teamId !== selectedTeam) return null;
                    const team = teamMap.get(teamId)?.team ?? null;
                    const label = qualification.bestResultLabels?.[index] ?? '—';
                    const advanced = index < 16;
                    return (
                      <tr key={teamId}>
                        <td className="num tabular">{index + 1}</td>
                        <td className="table__team">
                          <TeamName team={team} fallback={teamId} />
                        </td>
                        <td className="num tabular">{team?.number ?? '—'}</td>
                        <td className="tabular">{label}</td>
                        <td>
                          <span className={`badge ${advanced ? 'badge--advanced' : 'badge--eliminated'}`}>
                            {advanced ? '晋级十六强' : '优秀奖'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* 出场安排（三审顺序）——必须与正式排名分开呈现 */}
      <div className="card">
        <div className="card__head">
          <span className="card__title">出场安排（三审顺序）</span>
          <span className="badge badge--neutral">不是正式排名</span>
        </div>
        <p className="xsmall muted">
          排位赛按三审排名顺序出场：第 1、2 名同时上场，此后依次第 3、4 名，直至第 21、22 名。
          上午与下午各一轮，两轮互换场地。
        </p>

        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">排位赛出场批次与场地</caption>
            <thead>
              <tr>
                <th className="num">批次</th>
                <th className="table__team">第一轮</th>
                <th className="table__team">第二轮</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(({ batch, round1, round2 }) => (
                <tr key={batch}>
                  <td className="num tabular">{batch}</td>
                  <RunCell runs={round1} />
                  <RunCell runs={round2} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
          每批 10 分钟（含上场准备、跑图与场地复位）。同一批的两支队伍在副场地A、副场地B 并行跑图；
          每队两轮各用一个不同场地（第 1 轮奇数名→A、偶数名→B，第 2 轮互换）。
          对抗类比赛（瑞士轮、决赛）均在主舞台进行。
        </p>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">跑图记录（原始成绩）</span>
          <span className="xsmall muted">
            共 {event.qualification.runs.length} 次 · 已确认{' '}
            {event.qualification.runs.filter((r) => r.resultStatus === 'confirmed').length} 次
          </span>
        </div>
        <p className="xsmall muted" style={{ marginTop: 0 }}>
          全部 44 次单队跑图的原始成绩都公开在这里。
          名次口径：积分高者优；积分相同时，到达最终分时间早者优。每队取两轮中最优的一轮。
        </p>
        {event.qualification.runs.every((r) => r.resultStatus === 'none') ? (
          <EmptyState title="尚未比赛" hint="排位赛成绩录入后显示在这里。" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="table__team">队伍</th>
                  <th className="num">轮次</th>
                  <th>场地</th>
                  <th className="num">积分</th>
                  <th className="num">到达最终分</th>
                  <th>成绩原文</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {event.qualification.runs.map((run) => {
                  if (selectedTeam && run.teamId !== selectedTeam) return null;
                  // 该队的最优一轮加标记，让观众能对上名次表里的数字
                  const best = qualification.bestByTeam.get(run.teamId);
                  const isBest = best !== undefined && best !== null && best === run.round;
                  return (
                    <tr key={run.id}>
                      <td className="table__team">
                        <TeamName team={teamMap.get(run.teamId)?.team ?? null} fallback={run.teamId} />
                        {isBest ? (
                          <span className="badge badge--advanced" style={{ marginLeft: 6 }}>
                            计入名次
                          </span>
                        ) : null}
                      </td>
                      <td className="num tabular">{run.round}</td>
                      <td>{derived.venueLabels.get(run.venueId) ?? run.venueId}</td>
                      <td className="num tabular">{run.score ?? '—'}</td>
                      <td className="num tabular">
                        {run.elapsedSeconds !== null && run.elapsedSeconds !== ''
                          ? `${run.elapsedSeconds} 秒`
                          : '—'}
                      </td>
                      <td>{run.rawResult ?? '—'}</td>
                      <td>
                        <span
                          className={`badge ${run.resultStatus === 'confirmed' ? 'badge--advanced' : 'badge--pending'}`}
                        >
                          {run.resultStatus === 'confirmed'
                            ? '已确认'
                            : run.resultStatus === 'provisional'
                              ? '待确认'
                              : '未录入'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** 出场安排表中的一个单元格：一个批次在同一轮的两支队伍（一个场地各一支）。 */
function RunCell({ runs }: { runs: EventFile['qualification']['runs'] }) {
  const { derived } = useData();
  if (!derived || runs.length === 0) return <td className="table__team muted">—</td>;

  return (
    <td className="table__team">
      <div className="stack" style={{ gap: 2 }}>
        {runs.map((run) => {
          const item = derived.event.scheduleItems.find((s) => s.id === run.scheduleItemId);
          const team = derived.teamMap.get(run.teamId)?.team ?? null;
          const venueLabel = derived.venueLabels.get(run.venueId) ?? run.venueId;
          // 修订后的时间优先显示
          const startIso = item?.revisedStart ?? item?.plannedStart;
          return (
            <div key={run.id}>
              {startIso ? <span className="xsmall muted tabular">{formatTime(startIso)} </span> : null}
              <TeamName team={team} fallback={run.teamId} />
              <span className="xsmall muted">（{venueLabel}）</span>
              {run.resultStatus === 'confirmed' ? (
                <span className="xsmall" style={{ color: 'var(--advanced)' }}>
                  {' '}
                  {run.rawResult ?? run.score ?? '已确认'}
                </span>
              ) : run.resultStatus === 'provisional' ? (
                <span className="xsmall" style={{ color: 'var(--pending)' }}>
                  {' '}
                  待确认
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </td>
  );
}

/* ------------------------------------------------------------------ *
 * 瑞士轮
 * ------------------------------------------------------------------ */

function SwissView() {
  const { derived } = useData();
  const { params, setParams } = useQueryParams();
  const now = useEventClock();
  if (!derived) return null;
  const { event } = derived;

  const rounds = deriveRounds(derived);
  const requested = Number(params.get('round') ?? '');
  const published = rounds.filter((r) => r.publicationStatus === 'published');
  const scheduled = rounds.filter((r) => r.groups.some((g) => g.matches.some((m) => m.schedule && Date.parse(effectiveStart(m.schedule)) <= now.getTime())));
  const fallbackRound = published.find((r) => !r.complete)?.index ?? published.at(-1)?.index ?? scheduled.at(-1)?.index ?? 1;
  const roundIndex = Number.isFinite(requested) && requested >= 1 && requested <= 5 ? requested : fallbackRound;
  const round = rounds.find((r) => r.index === roundIndex) ?? rounds[0];

  if (!round) return <EmptyState title="尚无瑞士轮数据" />;

  const anyResult = event.swiss.matches.some((m) => m.attempts.some((a) => a.resultStatus === 'confirmed'));

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="segmented" role="group" aria-label="选择瑞士轮轮次">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className="segmented__item"
            aria-pressed={n === roundIndex}
            onClick={() => setParams({ round: String(n), group: null })}
          >
            R{n}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small">
            第 {round.index} 轮 · {round.index === 1 ? '依据排位赛名次' : `依据第 ${round.basedOnRound} 轮成绩`}
          </span>
          <PublicationBadge status={round.publicationStatus} />
        </div>
        {round.publishedAt ? (
          <div className="xsmall muted" style={{ marginTop: 'var(--sp-1)' }}>
            公布时间：{formatDate(round.publishedAt)} {formatTime(round.publishedAt)}
          </div>
        ) : null}
        {round.revisionNote ? (
          <div className="xsmall" style={{ marginTop: 'var(--sp-1)', color: 'var(--pending)' }}>
            组委会修订：{round.revisionNote}
          </div>
        ) : null}
        {round.publicationStatus === 'draft' ? (
          <div className="xsmall muted" style={{ marginTop: 'var(--sp-1)' }}>
            本轮对阵尚未正式公布。以下是赛程预留的时间槽，参赛队伍在公布前不确定。
          </div>
        ) : null}
        {round.index === 3 ? (
          <div className="xsmall" style={{ marginTop: 'var(--sp-1)', color: 'var(--pending)' }}>
            第三轮全部 8 场在第二轮结束后一次性公布，于 10 月 3 日晚进行。
          </div>
        ) : null}
      </div>

      {!anyResult ? <p className="xsmall muted">尚无已确认成绩，以下先展示本轮安排。</p> : null}

      <div className="round-tabs" role="group" aria-label="选择战绩组">
        {[null, ...round.groups.map((g) => g.record)].map((record) => <button key={record ?? 'all'} type="button" className="btn" aria-pressed={(params.get('group') ?? null) === record} onClick={() => setParams({ group: record })}>{record ? `${record} 组` : '全部战绩组'}</button>)}
      </div>
      {round.groups.filter((g) => !params.get('group') || g.record === params.get('group')).map((group) => (
        <GroupBlock key={group.record} group={group} roundIndex={round.index} />
      ))}

      {round.groups.length === 0 ? (
        <EmptyState title="本轮没有可显示的对阵" hint={round.publicationStatus === 'draft' ? '等待上一轮结束后公布。' : undefined} />
      ) : null}
    </div>
  );
}

function GroupBlock({ group, roundIndex }: { group: RoundGroupView; roundIndex: number }) {
  const { derived } = useData();
  const { params } = useQueryParams();
  if (!derived) return null;
  const teamId = params.get('team');
  const matches = group.matches.filter((m) => !teamId || m.sides?.some((s) => s.team?.id === teamId));
  if (teamId && !matches.length && !group.entries.some((e) => e.teamId === teamId)) return null;

  return (
    <section>
      <div className="card__head" style={{ marginBottom: 'var(--sp-2)' }}>
        <h3 className="card__title">
          {group.record} 组
          <span className="muted small" style={{ fontWeight: 400, marginLeft: 'var(--sp-2)' }}>
            {group.description}
          </span>
        </h3>
        {group.stakes ? <span className="badge badge--info">{group.stakes}</span> : null}
      </div>

      {/* 组内排名（参考排名，标注结算截止轮次） */}
      {group.entries.length > 0 ? (
        <div className="card" style={{ marginBottom: 'var(--sp-2)' }}>
          <div className="xsmall muted" style={{ marginBottom: 'var(--sp-2)' }}>
            排名依据：{roundIndex === 1 ? '排位赛名次' : `截至 R${roundIndex - 1} 已确认成绩`}
          </div>
          <StandingsMiniTable entries={group.entries} />
        </div>
      ) : null}

      <div className="stack">
        {matches.map((m) => (
          <MatchCard key={m.id} match={m} />
        ))}
      </div>
    </section>
  );
}

/** 紧凑排名表：默认只有名次/队伍/战绩/R，展开看完整指标。 */
export function StandingsMiniTable({
  entries,
  showQualificationRank = true,
}: {
  entries: StandingsEntry[];
  showQualificationRank?: boolean;
}) {
  const { derived } = useData();
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button className="btn btn--small" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起评分明细' : '展开评分明细'}</button>
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th className="table__team">队伍</th>
            <th className="num">战绩</th>
            <th className="num">R</th>
            {expanded ? (['A', 'B', 'P', 'O', 'T'] as const).map(key => <th className="num" key={key}>{key}</th>) : null}
            {expanded && showQualificationRank ? <th className="num">排位</th> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.teamId}>
              <td className="num tabular">{e.rankWithinGroup || i + 1}</td>
              <td className="table__team">
                <TeamName team={derived?.teamMap.get(e.teamId)?.team ?? null} fallback="队伍待核对" />
              </td>
              <td className="num tabular">{e.record}</td>
              <td className="num tabular">{e.display.r}</td>
              {expanded ? (['a', 'b', 'p', 'o', 't'] as const).map(key => <td className="num tabular" key={key}>{e.display[key]}</td>) : null}
              {expanded && showQualificationRank ? (
                <td className="num tabular">{e.qualificationRank ?? '—'}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 决赛
 * ------------------------------------------------------------------ */

function FinalsView() {
  const { derived } = useData();
  const { params, setParams } = useQueryParams();
  const listRef = useRef<HTMLDivElement>(null);
  const focusedMatch = params.get('focusMatch');
  const dataReady = Boolean(derived);
  useEffect(() => {
    const target = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-final-match]') ?? [])
      .find((node) => node.dataset.finalMatch === focusedMatch);
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedMatch, params, dataReady]);
  if (!derived) return null;
  const { event, teamMap, venueLabels, finals, awards } = derived;

  const mode = params.get('mode') ?? 'list';

  const seriesViews = FINALS_MATCH_ORDER.map((id) => {
    const series = event.finals.series.find((s) => s.id === id);
    return series ? toSeriesView(series, event, teamMap, venueLabels, finals) : null;
  }).filter((v): v is NonNullable<typeof v> => v !== null);

  const anyDecided = seriesViews.some((v) => v.resultStatus === 'confirmed');
  const teamId = params.get('team');
  const rounds = FINAL_ROUNDS;
  const defaultRound = rounds.find((r) => r.ids.some((id) => !finals.series.get(id)?.decided))?.key ?? rounds.at(-1)?.key;
  const selectedRound = rounds.some((r) => r.key === params.get('finalsRound')) ? params.get('finalsRound') : defaultRound;
  const roundIds = new Set(rounds.find((r) => r.key === selectedRound)?.ids);
  const visible = seriesViews.filter((v) => teamId ? v.sides?.some((s) => s.team?.id === teamId) : roundIds.has(v.id));
  const locateMatch = (id: string) => {
    const round = rounds.find((r) => r.ids.includes(id));
    if (round) setParams({ finalsRound: round.key, focusMatch: id, team: null }, { replace: false });
  };

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {/* 视图切换 */}
      <div className="segmented" role="group" aria-label="选择决赛视图">
        <button
          type="button"
          className="segmented__item"
          aria-pressed={mode === 'list'}
          onClick={() => setParams({ mode: 'list' })}
        >
          按轮次查看
        </button>
        <button
          type="button"
          className="segmented__item"
          aria-pressed={mode === 'bracket'}
          onClick={() => setParams({ mode: 'bracket' })}
        >
          完整对阵图
        </button>
      </div>

      {mode === 'list' ? (
        <div className="stack" ref={listRef}>
          {!teamId ? <FinalsRoundTabs selected={selectedRound} onSelect={(key) => setParams({ finalsRound: key, focusMatch: null })} /> : <p className="small muted">展示该队已确定的决赛对阵；后续名额由赛果产生。</p>}
          {visible.map((v) => (
            <section key={v.id} className={`finals-round-match${focusedMatch === v.id ? ' is-focused' : ''}`} data-final-match={v.id} tabIndex={-1} aria-label={v.title}>
              <h3 className="finals-round-match__title">{v.title}</h3>
              <MatchCard match={v} />
              <div className="finals-round-match__flow" aria-label="本场来源与去向">
                {finalsIncoming(event, v.id).map((edge) => <button type="button" className="finals-round-transfer" key={`in-${edge.fromId}`} data-from-id={edge.fromId} data-to-id={edge.toId} data-via={edge.via} onClick={() => locateMatch(edge.fromId)}>来自第 {edge.fromMatchNo} 场{edge.via === 'winner' ? '胜者' : '败者'}</button>)}
                {finalsOutgoing(event, v.id).map((edge) => <button type="button" className="finals-round-transfer" key={`out-${edge.toId}`} data-from-id={edge.fromId} data-to-id={edge.toId} data-via={edge.via} onClick={() => locateMatch(edge.toId)}>{edge.via === 'winner' ? '胜者' : '败者'} → 第 {edge.toMatchNo} 场</button>)}
                {v.id === 'F-GF' ? <span>胜者夺冠 · 败者亚军</span> : v.id === 'F-QUAL' ? <span>败者获季军</span> : v.id === 'F-LSF' ? <span>败者结算四强</span> : ['F-L1A', 'F-L1B', 'F-L2A', 'F-L2B'].includes(v.id) ? <span>败者结算八强</span> : null}
              </div>
            </section>
          ))}
          {!visible.length ? <EmptyState title="暂无已确定的对阵" hint="队伍晋级或对阵公布后，这里会显示相关比赛。" /> : null}
        </div>
      ) : (
        <BracketView />
      )}
      <details className="card"><summary>八强排名与首轮对阵依据</summary><SeedTable /></details>

      {/* 奖项 */}
      {anyDecided ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">名次结算</span>
          </div>
          <div className="stack stack--tight">
            <AwardRow label="冠军" teamId={awards.champion} />
            <AwardRow label="亚军" teamId={awards.runnerUp} />
            <AwardRow label="季军" teamId={awards.third} />
          </div>
          <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
            八强败者组首轮与第二轮败者结算八强；半决赛败者组败者结算四强。
            并列的八强不编造精确第 5–8 名。
          </p>
        </div>
      ) : null}
    </div>
  );
}

function FinalsRoundTabs({ selected, onSelect }: { selected: string | null | undefined; onSelect: (key: string) => void }) {
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tabs.current;
    const active = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !active) return;
    const left = active.getBoundingClientRect().left - strip.getBoundingClientRect().left;
    strip.scrollTo({ left: strip.scrollLeft + left - (strip.clientWidth - active.offsetWidth) / 2, behavior: 'instant' });
  }, [selected]);
  return <div className="round-tabs" ref={tabs} role="group" aria-label="选择决赛轮次">
    {FINAL_ROUNDS.map((round) => <button className="btn" type="button" key={round.key} aria-pressed={selected === round.key} onClick={() => onSelect(round.key)}>{round.title}</button>)}
  </div>;
}

function AwardRow({ label, teamId }: { label: string; teamId: string | null }) {
  const { derived } = useData();
  if (!derived) return null;
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="small muted">{label}</span>
      {teamId ? (
        <TeamName team={derived.teamMap.get(teamId)?.team ?? null} fallback={teamId} />
      ) : (
        <span className="small muted">待产生</span>
      )}
    </div>
  );
}

function SeedTable() {
  const { derived } = useData();
  if (!derived) return null;
  const { event, teamMap } = derived;

  const seeding = event.finals.seeding;
  if (!seeding) {
    return (
      <div className="card">
        <div className="card__head">
          <span className="card__title">八强种子</span>
          <span className="badge badge--pending">待公布</span>
        </div>
        <EmptyState
          title="八强种子尚未公布"
          hint="第五轮瑞士轮结束后，按 3-0、3-1、3-2 战绩组内评分确定八强第 1–8 名。上午首轮为第 1 对第 5、第 2 对第 6、第 3 对第 7、第 4 对第 8 名；结果决定下午胜者组和败者组。"
        />
      </div>
    );
  }

  const seeds = seeding.seeds;
  const groups: { label: string; seeds: ('W1' | 'W2' | 'W3' | 'W4' | 'L1' | 'L2' | 'L3' | 'L4')[] }[] = [
    { label: '瑞士轮最终八强排名', seeds: [...FINALS_SEED_ORDER] },
  ];

  return (
    <div className="card">
      <div className="card__head">
        <span className="card__title">八强种子</span>
        <PublicationBadge status={seeding.publicationStatus} />
      </div>
      <div className="stack stack--tight">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="xsmall muted">{g.label}</div>
            <div className="stack stack--tight" style={{ marginTop: 'var(--sp-1)' }}>
              {g.seeds.map((seed) => {
                const teamId = seeds[seed];
                return (
                  <div key={seed} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="badge badge--info">{finalsSeedLabel(seed)}</span>
                    {teamId ? (
                      <TeamName team={teamMap.get(teamId)?.team ?? null} fallback={teamId} />
                    ) : (
                      <span className="small muted">待确定</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {seeding.basisNote ? (
        <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
          依据：{seeding.basisNote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 决赛节点渲染：一律走 view-model，不在这里重算规则。
 */
function useSeriesNode() {
  const { derived } = useData();

  return useMemo(() => {
    if (!derived) return null;
    const { event, teamMap, venueLabels, finals } = derived;
    const byId = new Map(event.finals.series.map((s) => [s.id, s]));

    return (nodeId: string): BracketNodeContent => {
      const series = byId.get(nodeId);
      if (!series) return { title: nodeId, rows: [] };

      const view = toSeriesView(series, event, teamMap, venueLabels, finals);
      const [home, away] = view.sides ?? [null, null];
      const res = finals.series.get(nodeId);

      const status: BracketNodeContent['status'] =
        view.executionStatus === 'running'
          ? 'live'
          : res?.decided
            ? 'done'
            : 'upcoming';

      // 未确定的对阵显示"在等什么"，绝不显示一个看起来像真的名次
      /*
       * 决赛红蓝方：八强双败不换边（第一席位蓝、第二红）。
       * BO3 逐局标色，系列赛层面不给单一归属。
       * 队伍待定仍可标出正式赛制已确定的席位颜色。
       */
      const finalsSides = series.format === 'BO3' ? null : sidesForFinals();
      const sideRow = (side: typeof home, index: number): BracketNodeContent['rows'][number] => ({
        label: '',
        team: side?.team ? `${side.team.name}${series.format === 'BO1' && side.score !== null ? ` · ${side.score} 分${side.seconds !== null ? ` · ${side.seconds} 秒` : ''}` : ''}` : (side?.sourceLabel ?? '待定'),
        isWinner: side?.isWinner ?? false,
        dim: !side?.team,
        side:
          finalsSides === null
            ? null
            : index === 0
              ? finalsSides.first
              : finalsSides.second,
      });

      const parts: string[] = [];
      if (view.format) parts.push(view.format);
      if (series.format !== 'BO1' && view.homeWins !== null && view.awayWins !== null && (view.homeWins > 0 || view.awayWins > 0)) {
        parts.push(`系列赛 ${view.homeWins} : ${view.awayWins}`);
      }
      if (res && res.notNeededGameIndexes.length > 0) {
        parts.push(`第 ${res.notNeededGameIndexes.join('、')} 局不需要进行`);
      }
      if (view.schedule) {
        parts.push(`${formatDate(effectiveStart(view.schedule))} ${formatTime(effectiveStart(view.schedule))}`);
      }
      const executionLabel = {
        scheduled: '未开始', ready: '准备中', running: '进行中',
        finished: '待赛果确认', delayed: '延迟', cancelled: '已取消',
        'not-needed': '不需要进行',
      }[view.executionStatus];
      parts.push(res?.decided ? '已完赛' : executionLabel);

      return {
        title: view.title,
        rows: [sideRow(home, 0), sideRow(away, 1)],
        gameSides: series.format === 'BO3' ? [1, 2, 3].map(gameIndex => ({
          gameIndex,
          sides: sidesForSeriesGame(gameIndex),
          notNeeded: res?.notNeededGameIndexes.includes(gameIndex) ?? false,
        })) : undefined,
        meta: parts.length > 0 ? parts.join(' · ') : null,
        status,
        to: `/matches/${nodeId}`,
      };
    };
  }, [derived]);
}

/**
 * 完整决赛对阵图。
 *
 * 胜者组、败者组与冠军争夺分区，跨区关系通过场次引用定位。
 */
function BracketView() {
  const { derived } = useData();
  const { params } = useQueryParams();
  const renderSeriesNode = useSeriesNode();

  const renderNode = useMemo(
    () => renderSeriesNode ?? ((nodeId: string): BracketNodeContent => ({ title: nodeId, rows: [] })),
    [renderSeriesNode],
  );

  if (!derived) return null;

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <FinalsBracket
        event={derived.event}
        renderNode={renderNode}
        highlightedNodeIds={highlightedNodes(derived.event, derived.finals, params.get('team'))}
      />
      <p className="xsmall muted">
        八强败者组首轮与第二轮败者结算八强；半决赛败者组败者结算四强。
        未决出的名额显示为来源说明（例如「第 8 场败者」），不提前填队名。
      </p>
    </div>
  );
}

/**
 * 完整晋级图的**图本体**（不含页签与说明文字）。
 *
 * 抽成独立组件是为了让「总览」页也能放同一张图，
 * 而不必复制那套节点渲染逻辑 —— 复制必然导致两处行为分叉
 * （例如胜者标记只在一处修好）。
 */
export function FullJourneyBracket({ legend = true }: { legend?: boolean }) {
  const { derived } = useData();
  const { params } = useQueryParams();
  const renderSeriesNode = useSeriesNode();

  const journeyRef = useRef<HTMLDivElement>(null);
  const model = useMemo(() => (derived ? buildSwissModel(derived.event) : null), [derived]);

  /** 瑞士轮与排位赛的节点用各自的数据描述，不借用决赛的解析结果。 */
  const renderNode = useMemo(() => {
    const fallbackNode = (nodeId: string): BracketNodeContent => ({ title: nodeId, rows: [] });
    const seriesNode = renderSeriesNode ?? fallbackNode;
    if (!derived) return fallbackNode;

    const { event, teamMap, finals } = derived;
    const swissById = new Map(event.swiss.matches.map((m) => [m.id, m]));

    return (nodeId: string): BracketNodeContent => {
      const match = swissById.get(nodeId);
      if (match) {
        const { home, away, pending } = nodeParticipants(nodeId, event, finals);

        /**
         * 本次结算的 attempt（只认 effectiveAttemptId，重赛的旧记录不算）。
         * 用它判断胜者与比分 —— 早先这里只塞了队名，
         * 于是**瑞士轮卡片从来不标胜者、也不显示比分**，
         * 图上分不出每场谁赢了。
         */
        const effective =
          match.effectiveAttemptId === null
            ? null
            : match.attempts.find((a) => a.id === match.effectiveAttemptId) ?? null;
        const decided = effective !== null && effective.resultStatus === 'confirmed';
        const winnerId = decided ? effective.winnerId : null;

        /**
         * 待公布时两侧是同一句"在等什么"，重复两遍只会把卡片撑高。
         * 这种情况合并成一行说明，绝不编造具体名次。
         */
        const refReason = (): string | null => {
          for (const ref of match.slots) {
            if (ref.kind === 'pending') return ref.reason;
            if (ref.kind === 'qualification-rank') return `等待排位赛第 ${ref.rank} 名`;
          }
          return null;
        };

        const label = (teamId: string | null, index: number): string => {
          if (teamId) return teamMap.get(teamId)?.displayName ?? teamId;
          const ref = match.slots[index];
          if (!ref) return '待定';
          if (ref.kind === 'pending') return ref.reason;
          if (ref.kind === 'qualification-rank') return `排位赛第 ${ref.rank} 名`;
          if (ref.kind === 'team') return teamMap.get(ref.teamId)?.displayName ?? ref.teamId;
          return '待定';
        };

        if (pending) {
          return {
            title: `R${match.roundIndex}`,
            rows: [{ label: '', team: refReason() ?? '对阵待公布', dim: true }],
            slotSides: sidesForSwiss(match.roundIndex),
            meta: `${match.groupRecord} 战绩组`,
            status: 'upcoming',
            to: `/matches/${nodeId}`,
          };
        }

        /** 表现统计只在有效比赛上有意义；弃权/行政中止无比分。 */
        const isPerformance =
          effective !== null &&
          (effective.resultKind === 'normal' || effective.resultKind === 'early-end');
        const scoreOf = (teamId: string | null): string | null => {
          if (!isPerformance || !effective || teamId === null) return null;
          if (teamId === effective.homeTeamId) return effective.homeScore;
          if (teamId === effective.awayTeamId) return effective.awayScore;
          return null;
        };
        const secsOf = (teamId: string | null): string | null => {
          if (!isPerformance || !effective || teamId === null) return null;
          if (teamId === effective.homeTeamId) return effective.homeReachedSeconds;
          if (teamId === effective.awayTeamId) return effective.awayReachedSeconds;
          return null;
        };

        /**
         * 每行末尾附上该队的比分与到达最终分时间，让图上能看出谁赢、赢多少；
         * 同时标出红蓝方（瑞士轮偶数轮换边，由轮次推出）。
         */
        const sideColor = sidesForSwiss(match.roundIndex);
        const rowOf = (teamId: string | null, index: number): BracketNodeContent['rows'][number] => {
          const score = scoreOf(teamId);
          const secs = secsOf(teamId);
          const suffix =
            score !== null
              ? ` ${score} 分${secs !== null && secs !== '' ? ` · ${secs} 秒` : ''}`
              : '';
          return {
            label: '',
            team: `${label(teamId, index)}${suffix}`,
            isWinner: winnerId !== null && teamId === winnerId,
            dim: teamId === null,
            side: index === 0 ? sideColor.first : sideColor.second,
          };
        };

        const metaParts: string[] = [`${match.groupRecord} 战绩组`];
        if (decided) {
          metaParts.push('已结算');
          if (effective && !isPerformance) {
            metaParts.push(effective.resultKind === 'walkover-before-start' ? '未开赛弃权' : '行政判负中止');
          }
        }

        return {
          title: `R${match.roundIndex}`,
          rows: [rowOf(home, 0), rowOf(away, 1)],
          meta: metaParts.join(' · '),
          status: decided ? 'done' : 'upcoming',
          to: `/matches/${nodeId}`,
        };
      }

      return seriesNode(nodeId);
    };
  }, [derived, renderSeriesNode]);

  const sectionLabel = useMemo(() => (section: string) => section, []);

  if (!derived || !model) return null;

  return (
    <div className="stack journey-bracket" ref={journeyRef}>
      <div className="round-tabs" role="group" aria-label="定位完整晋级图">
        {(['swiss', 'finals'] as const).map((stage) => <button className="btn" type="button" key={stage} onClick={() => {
          const heading = journeyRef.current?.querySelector<HTMLElement>(`[data-journey-stage="${stage}"] > h2`);
          heading?.focus({ preventScroll: true });
          heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
        }}>{stage === 'swiss' ? '瑞士轮' : '八强决赛'}</button>)}
      </div>
      <section className="journey-stage" data-journey-stage="swiss">
      <h2 tabIndex={-1}>瑞士轮 · 争夺八强席位</h2>
      {legend ? <p className="small muted">每轮重新配对，3 胜晋级、3 负淘汰。仅已公布的对阵显示同队跨轮轨迹，未公布的配对不预画连线。</p> : null}
      <BracketChart
        columns={model.columns}
        connections={model.connections}
        renderNode={renderNode}
        sectionLabel={sectionLabel}
        minColumnWidth={240}
        ariaLabel="瑞士轮晋级图，可横向滚动"
        showStageNavigation
        highlightedNodeIds={highlightedNodes(derived.event, derived.finals, params.get('team'))}
      />
      </section>
      <section className="journey-stage" data-journey-stage="finals">
        <h2 tabIndex={-1}>八强决赛 · 双败晋级</h2>
        <FinalsBracket event={derived.event} renderNode={renderNode} highlightedNodeIds={highlightedNodes(derived.event, derived.finals, params.get('team'))} />
      </section>
    </div>
  );
}

function highlightedNodes(event: EventFile, finals: FinalsResolution, teamId: string | null): string[] {
  if (!teamId) return [];
  return [...event.swiss.matches, ...event.finals.series].filter((m) => {
    const { home, away } = nodeParticipants(m.id, event, finals);
    return home === teamId || away === teamId;
  }).map((m) => m.id);
}

/**
 * 完整晋级图：瑞士轮 R1–R5 → 决赛，分区查看全部流程。
 *
 * 排位赛不在本图内：两者的关系是"排位前 16 名进入瑞士轮"，
 * 跨列连线只会变成一团乱麻，用文字说明更清楚。
 */
function FullJourneyView() {
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <FullJourneyBracket />
      <p className="xsmall muted">
        瑞士轮 5 轮后 3 胜晋级八强；决赛分区内实线表示胜者晋级，跨组去向可点击场次定位。
        排位赛不在本图内 —— 它是 44 次单队跑图，与瑞士轮没有逐场对应关系，
        请见上方「排位赛」页签。
      </p>
    </div>
  );
}
