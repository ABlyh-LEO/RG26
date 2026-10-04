/**
 * 晋级页：谁晋级了，下一轮怎么打。
 *
 * 三个视图：排位赛、瑞士轮、决赛。
 * - 排位赛区分“出场安排（三审顺序）”与“正式排名”。
 * - 瑞士轮共享战绩分组全景、实际对阵与单队历程。
 * - 决赛桌面用固定流向图，手机按实际比赛顺序纵向卡片。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQueryParams } from '../app/useQueryParams';
import { useData } from '../data/DataProvider';
import { useEventClock } from '../data/clock';
import {
  formatDate,
  formatTime,
  effectiveStart,
} from '../data/view-model';
import { toSeriesView } from '../data/view-model';
import { AwardBadge, EmptyState, MatchCard, PublicationBadge, TeamName } from '../components/ui';
import { AWARD_LABELS, awardForTeam, type AwardKind } from '../data/award-labels';
import type { BracketNodeContent } from '../components/BracketChart';
import { FinalsBracket } from '../components/FinalsBracket';
import { SwissProgress } from '../components/SwissProgress';
import { FINAL_ROUNDS, finalsIncoming, finalsOutgoing } from '../data/finals-presentation';
import { nodeParticipants } from '../data/bracket-model';
import { sidesForFinals } from '../domain/sides';
import { FINALS_MATCH_ORDER, FINALS_SEED_ORDER, finalsSeedLabel, type FinalsResolution } from '../domain/finals';
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

  /**
   * 三态展示（决策：成绩不完整时允许看实时排行，但必须标注为「当前排行」，
   * 且不得据此断言谁晋级）：
   * 1. 已定榜 → 正式排名 + 晋级状态；
   * 2. 未定榜但有已确认成绩 → 当前排行（实时、未确认、无晋级结论）；
   * 3. 完全没有已确认成绩 → 空状态，不推测名次。
   */
  const official = qualification.official;
  const live = qualification.live;
  const showLive = !official && live.hasAnyScore;
  const missingCount = qualification.completeness.missingTeamIds.length;
  /*
   * 名次表里的诚实标记：并列与"只录到一轮"必须在正式榜上也能看见，
   * 不能因为定了榜就消失。优先用定榜时持久化的记录，回退到当前计算。
   * `tiedTeamIds` 只标记"与前一名相同"的那一支，因此把它的前一名也算进并列。
   */
  const tiedIds = new Set(qualification.review.tiedTeamIds ?? qualification.completeness.tiedTeamIds);
  const tiedBothIds = new Set(tiedIds);
  qualification.orderedTeamIds.forEach((teamId, index) => {
    if (tiedIds.has(teamId) && index > 0) tiedBothIds.add(qualification.orderedTeamIds[index - 1]!);
  });
  const partialIds = new Set(qualification.review.partialTeamIds ?? qualification.completeness.partialTeamIds);
  const missingAtConfirm = qualification.review.missingTeamIds?.length ?? missingCount;

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="card">
        <div className="card__head">
          <span className="card__title">{official ? '正式排名' : showLive ? '当前排行' : '正式排名'}</span>
          <span className="row" style={{ gap: 'var(--sp-1)' }}>
            <PublicationBadge status={event.qualification.ranking.publicationStatus} />
            {official ? (
              <>
                <span className="badge badge--advanced">已确认</span>
                {qualification.overridden ? <span className="badge badge--pending">人工定榜</span> : null}
              </>
            ) : showLive ? (
              <span className="badge badge--pending">实时 · 未确认</span>
            ) : (
              <span className="badge badge--pending">待裁判确认</span>
            )}
          </span>
        </div>

        {official ? (
          <>
            <p className="xsmall muted">
              第 1–16 名晋级十六强，第 17–22 名结算优秀奖。两轮取最优成绩，同分规则由裁判确认。
              {qualification.sourceNote ? ` 来源：${qualification.sourceNote}` : ''}
            </p>
            {qualification.overridden ? (
              <div className="inline-notice">
                <strong>本次名次由人工录入，成绩不完整由人负责。</strong>
                定榜时 {missingAtConfirm} 支队伍没有可比成绩；名次依据：
                {qualification.sourceNote ?? '未填写来源说明'}
                {qualification.overrideReason && qualification.overrideReason !== qualification.sourceNote
                  ? `；豁免原因：${qualification.overrideReason}`
                  : ''}
              </div>
            ) : null}
            {qualification.review.reviewNote ? (
              <p className="xsmall muted">复核说明：{qualification.review.reviewNote}</p>
            ) : null}
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
                    const marks = [tiedBothIds.has(teamId) ? '并列' : null, partialIds.has(teamId) ? '仅一轮' : null]
                      .filter(Boolean)
                      .join(' · ');
                    /*
                     * 标签按**队伍 id** 取，不用 `bestResultLabels[下标]`：
                     * 人工调整名次后那个数组可能与名次错位，会把别人的成绩文字挂上来。
                     */
                    const bestLabel = qualification.bestLabelByTeam.get(teamId) ?? '—';
                    const label = `${bestLabel}${marks ? `（${marks}）` : ''}`;
                    const advanced = index < 16;
                    const award = !advanced && team ? awardForTeam(derived.awards, team) : null;
                    return (
                      <tr key={teamId}>
                        <td className="num tabular">{index + 1}</td>
                        <td className="table__team">
                          <TeamName team={team} fallback={teamId} />
                        </td>
                        <td className="num tabular">{team?.number ?? '—'}</td>
                        <td className="tabular">{label}</td>
                        <td>
                          {award ? <AwardBadge award={award} /> : <span className={`badge ${advanced ? 'badge--advanced' : 'badge--eliminated'}`}>
                            {advanced ? '晋级十六强' : '优秀奖'}
                          </span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : showLive ? (
          <>
            <div className="inline-notice">
              <strong>实时 · 成绩不完整，未确认，不作为晋级依据。</strong>
              已确认 {live.confirmedRunCount} / {live.totalRunCount} 次跑图；
              {live.teamCount} 支队伍中 {missingCount} 支尚无成绩。
            </div>
            <p className="xsmall muted">
              两轮取最优成绩，积分高者优、同分时到达最终分时间早者优。
              名次待裁判组核分确认后才会成为正式排名。
            </p>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">排位赛当前排行（实时，未确认）</caption>
                <thead>
                  <tr>
                    <th className="num">当前位次</th>
                    <th className="table__team">队伍</th>
                    <th className="num">编号</th>
                    <th>最优成绩</th>
                    <th>数据状态</th>
                  </tr>
                </thead>
                <tbody>
                  {live.entries.map((entry, index) => {
                    if (selectedTeam && entry.teamId !== selectedTeam) return null;
                    const team = teamMap.get(entry.teamId)?.team ?? null;
                    // 并列是双向的：与前一名相同，同时也意味着后一名与自己相同。
                    const tied = entry.tiedWithPrevious || live.entries[index + 1]?.tiedWithPrevious === true;
                    const hasMark = entry.incomplete || entry.partial || tied;
                    return (
                      <tr key={entry.teamId}>
                        <td className="num tabular">{entry.position}</td>
                        <td className="table__team">
                          <TeamName team={team} fallback={entry.teamId} />
                        </td>
                        <td className="num tabular">{team?.number ?? '—'}</td>
                        <td className="tabular">{entry.label}</td>
                        <td className="row" style={{ gap: 4 }}>
                          {entry.incomplete ? <span className="badge badge--neutral">无成绩</span> : null}
                          {entry.partial ? <span className="badge badge--pending">仅一轮</span> : null}
                          {tied ? <span className="badge badge--pending">并列</span> : null}
                          {!hasMark ? <span className="xsmall muted">第 {entry.round ?? '—'} 轮成绩</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState
            title="正式排名尚未公布"
            hint="排位赛两轮结束后，由裁判组核分确认 1–22 名的最终排名。确认前不推测名次。"
          />
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
          const runNo = derived.matchNumbers.byId.get(run.id);
          return (
            <div key={run.id}>
              {runNo !== undefined ? <span className="xsmall muted tabular">第 {runNo} 场 </span> : null}
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
  return <SwissProgress />;
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
            <AwardRow award="champion" />
            <AwardRow award="runnerUp" />
            <AwardRow award="third" />
            {(['topFour', 'topEight', 'topSixteen', 'honorableMention'] as const).map((award) => awards[award].length > 0 ? <AwardRow key={award} award={award} /> : null)}
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

function AwardRow({ award }: { award: AwardKind }) {
  const { derived } = useData();
  if (!derived) return null;
  const members = derived.awards[award];
  const teamIds = Array.isArray(members) ? members : members ? [members] : [];
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      {teamIds.length > 0 ? <AwardBadge award={award} /> : <span className="small muted">{AWARD_LABELS[award]}</span>}
      {teamIds.length > 0 ? (
        <div className="award-group__teams">{teamIds.map((teamId) => <TeamName key={teamId} team={derived.teamMap.get(teamId)?.team ?? null} fallback={teamId} />)}</div>
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
       * BO3 全系列赛保持同一红蓝方，各小局沿用对应席位颜色。
       * 队伍待定仍可标出正式赛制已确定的席位颜色。
       */
      const finalsSides = sidesForFinals();
      const sideRow = (side: typeof home, index: number): BracketNodeContent['rows'][number] => ({
        label: '',
        team: side?.team ? `${side.team.name}${series.format === 'BO1' && side.score !== null ? ` · ${side.score} 分${side.seconds !== null ? ` · ${side.seconds} 秒` : ''}` : ''}` : (side?.sourceLabel ?? '待定'),
        isWinner: side?.isWinner ?? false,
        dim: !side?.team,
        side: index === 0 ? finalsSides.first : finalsSides.second,
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
  const renderNode = useMemo(
    () => renderSeriesNode ?? ((nodeId: string): BracketNodeContent => ({ title: nodeId, rows: [] })),
    [renderSeriesNode],
  );

  if (!derived) return null;

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
      {legend ? <p className="small muted">按战绩组查看常规赛制，选择队伍查看真实参赛历程。</p> : null}
      <SwissProgress />
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
        瑞士轮最多五轮，累计三胜即晋级八强；决赛分区内实线表示胜者晋级，跨组去向可点击场次定位。
        排位赛不在本图内 —— 它是 44 次单队跑图，与瑞士轮没有逐场对应关系，
        请见上方「排位赛」页签。
      </p>
    </div>
  );
}
