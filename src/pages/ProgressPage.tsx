/**
 * 晋级页：谁晋级了，下一轮怎么打。
 *
 * 三个视图：排位赛、瑞士轮、决赛。
 * - 排位赛区分“出场安排（三审顺序）”与“正式排名”。
 * - 瑞士轮按轮次显示战绩分组，默认只显示名次/队伍/战绩/R，展开看 A/B/P/O/T。
 * - 决赛桌面用固定流向图，手机按实际比赛顺序纵向卡片。
 */
import { useMemo } from 'react';
import { useQueryParams } from '../app/useQueryParams';
import { useData } from '../data/DataProvider';
import {
  deriveRounds,
  formatDate,
  formatTime,
  type RoundGroupView,
} from '../data/view-model';
import { toSeriesView } from '../data/view-model';
import { EmptyState, MatchCard, PublicationBadge, TeamName } from '../components/ui';
import { BracketChart, type BracketNodeContent } from '../components/BracketChart';
import { buildFinalsModel, buildFullModel, nodeParticipants } from '../data/bracket-model';
import { FINALS_MATCH_ORDER } from '../domain/finals';
import type { StandingsEntry } from '../domain/standings';
import type { EventFile } from '../domain/schema';

type View = 'qualification' | 'swiss' | 'finals' | 'journey';

export function ProgressPage() {
  const { derived, loading } = useData();
  const { params, setParams } = useQueryParams();

  const view = (params.get('view') ?? 'swiss') as View;

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
            ['journey', '完整晋级图'],
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
            onClick={() => setParams({ view: key })}
          >
            {label}
          </button>
        ))}
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
  }, [derived]);

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
          每批 10 分钟（含上场准备、跑图与场地复位）。同一批的两支队伍在 A、B 两个副场地并行跑图；
          每队两轮各用一个不同场地（第 1 轮奇数名→A、偶数名→B，第 2 轮互换）。
          对抗类比赛（瑞士轮、决赛）均在主舞台进行。
        </p>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">跑图记录</span>
          <span className="xsmall muted">
            共 {event.qualification.runs.length} 次 · 已确认{' '}
            {event.qualification.runs.filter((r) => r.resultStatus === 'confirmed').length} 次
          </span>
        </div>
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
                  <th>成绩</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {event.qualification.runs
                  .filter((r) => r.resultStatus !== 'none')
                  .map((run) => (
                    <tr key={run.id}>
                      <td className="table__team">
                        <TeamName team={teamMap.get(run.teamId)?.team ?? null} fallback={run.teamId} />
                      </td>
                      <td className="num tabular">{run.round}</td>
                      <td>{derived.venueLabels.get(run.venueId) ?? run.venueId}</td>
                      <td className="tabular">
                        {run.rawResult ?? run.score ?? '—'}
                        {run.resultStatus === 'provisional' ? '（待确认）' : ''}
                      </td>
                      <td>
                        <span
                          className={`badge ${run.resultStatus === 'confirmed' ? 'badge--advanced' : 'badge--pending'}`}
                        >
                          {run.resultStatus === 'confirmed' ? '已确认' : '待确认'}
                        </span>
                      </td>
                    </tr>
                  ))}
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
  if (!derived) return null;
  const { event } = derived;

  const rounds = deriveRounds(derived);
  const requested = Number(params.get('round') ?? '');
  const latestWithMatches = rounds.filter((r) => r.groups.length > 0).map((r) => r.index);
  const fallbackRound = latestWithMatches.length > 0 ? Math.max(...latestWithMatches) : 1;
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
            onClick={() => setParams({ round: String(n) })}
          >
            R{n}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small">
            第 {round.index} 轮 · 依据第 {round.basedOnRound} 轮结算数据
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
            第三轮全部 8 场在第二轮结束后一次性公布，跨日期间保持固定；次日不重新排序。
          </div>
        ) : null}
      </div>

      {!anyResult ? (
        <EmptyState
          title="尚未比赛"
          hint="瑞士轮结果录入后，这里会显示各战绩组、评分与下一轮对阵。"
        />
      ) : null}

      {round.groups.map((group) => (
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
  if (!derived) return null;

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
            排名依据：截至 R{roundIndex === 1 ? 0 : roundIndex - 1} 已确认成绩
            {roundIndex === 1 ? '（排位赛名次）' : ''}
          </div>
          <StandingsMiniTable entries={group.entries} />
        </div>
      ) : null}

      <div className="stack">
        {group.matches.map((m) => (
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
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th className="table__team">队伍</th>
            <th className="num">战绩</th>
            <th className="num">R</th>
            <th className="num">P</th>
            <th className="num">T</th>
            {showQualificationRank ? <th className="num">排位</th> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.teamId}>
              <td className="num tabular">{e.rankWithinGroup || i + 1}</td>
              <td className="table__team">
                <TeamName team={null} fallback={e.teamId} linkTo={false} />
              </td>
              <td className="num tabular">{e.record}</td>
              <td className="num tabular">{e.display.r}</td>
              <td className="num tabular">{e.display.p}</td>
              <td className="num tabular">{e.display.t}</td>
              {showQualificationRank ? (
                <td className="num tabular">{e.qualificationRank ?? '—'}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 决赛
 * ------------------------------------------------------------------ */

function FinalsView() {
  const { derived } = useData();
  const { params, setParams } = useQueryParams();
  if (!derived) return null;
  const { event, teamMap, venueLabels, finals, awards } = derived;

  const mode = params.get('mode') ?? 'list';

  const seriesViews = FINALS_MATCH_ORDER.map((id) => {
    const series = event.finals.series.find((s) => s.id === id);
    return series ? toSeriesView(series, event, teamMap, venueLabels, finals) : null;
  }).filter((v): v is NonNullable<typeof v> => v !== null);

  const anyDecided = seriesViews.some((v) => v.resultStatus === 'confirmed');

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {/* 种子 */}
      <SeedTable />

      {/* 视图切换 */}
      <div className="segmented" role="group" aria-label="选择决赛视图">
        <button
          type="button"
          className="segmented__item"
          aria-pressed={mode === 'list'}
          onClick={() => setParams({ mode: 'list' })}
        >
          按比赛顺序
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

      {!anyDecided ? (
        <EmptyState
          title="决赛尚未开始"
          hint="八强种子与对阵来自瑞士轮最终成绩。下方按实际比赛顺序列出全部场次。"
        />
      ) : null}

      {mode === 'list' ? (
        <div className="stack">
          {seriesViews.map((v) => (
            <MatchCard key={v.id} match={v} />
          ))}
        </div>
      ) : (
        <BracketView />
      )}

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
          hint="种子在第五轮瑞士轮全部结束后统一计算：3-0 前两名为 W1/W2；3-1 前两名为 W3/W4、第三名为 L1；3-2 三名为 L2–L4。"
        />
      </div>
    );
  }

  const seeds = seeding.seeds;
  const groups: { label: string; seeds: ('W1' | 'W2' | 'W3' | 'W4' | 'L1' | 'L2' | 'L3' | 'L4')[] }[] = [
    { label: '八强胜者组', seeds: ['W1', 'W2', 'W3', 'W4'] },
    { label: '八强败者组', seeds: ['L1', 'L2', 'L3', 'L4'] },
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
                    <span className="badge badge--info">{seed}</span>
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
 * 图例：说明连线与卡片状态的含义。
 */
function BracketLegend() {
  return (
    <div className="bracket__legend">
      <span className="bracket__legend-item">
        <span className="bracket__legend-swatch bracket__legend-swatch--winner" aria-hidden="true" />
        胜者晋级方向
      </span>
      <span className="bracket__legend-item">
        <span className="bracket__legend-swatch bracket__legend-swatch--loser" aria-hidden="true" />
        败者落位方向
      </span>
      <span className="bracket__legend-item">浅色队名 = 对阵尚未确定</span>
      <span className="bracket__legend-item">左右滑动可查看全部阶段</span>
    </div>
  );
}

/** 决赛节点渲染：一律走 view-model，不在这里重算规则。 */
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
          : res?.decided || view.resultStatus === 'confirmed'
            ? 'done'
            : 'upcoming';

      // 未确定的对阵显示"在等什么"，绝不显示一个看起来像真的名次
      const sideRow = (side: typeof home): BracketNodeContent['rows'][number] => ({
        label: '',
        team: side?.team ? side.team.name : (side?.sourceLabel ?? '待定'),
        isWinner: side?.isWinner ?? false,
        dim: !side?.team,
      });

      const parts: string[] = [];
      if (view.format) parts.push(view.format);
      if (view.homeWins !== null && view.awayWins !== null && (view.homeWins > 0 || view.awayWins > 0)) {
        parts.push(`${view.homeWins} : ${view.awayWins}`);
      }
      if (res && res.notNeededGameIndexes.length > 0) {
        parts.push(`第 ${res.notNeededGameIndexes.join('、')} 局不需要进行`);
      }
      if (view.schedule) {
        parts.push(`${formatDate(view.schedule.date)} ${formatTime(view.schedule.revisedStart ?? view.schedule.plannedStart)}`);
      }

      return {
        title: view.title,
        rows: [sideRow(home), sideRow(away)],
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
 * 列式赛程图：列为依赖图层级、卡片堆叠、SVG 连线表示晋级流向。
 * 放在独立滚动容器里，保证页面本体不横向溢出。
 */
function BracketView() {
  const { derived } = useData();
  const renderSeriesNode = useSeriesNode();

  const model = useMemo(() => (derived ? buildFinalsModel(derived.event) : null), [derived]);

  const renderNode = useMemo(
    () => renderSeriesNode ?? ((nodeId: string): BracketNodeContent => ({ title: nodeId, rows: [] })),
    [renderSeriesNode],
  );

  if (!derived || !model) return null;

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <BracketLegend />
      <BracketChart
        columns={model.columns}
        connections={model.connections}
        renderNode={renderNode}
        ariaLabel="完整决赛对阵图，可横向滚动"
      />
      <p className="xsmall muted">
        八强败者组首轮与第二轮败者结算八强；半决赛败者组败者结算四强。
        未决出的名额显示为来源说明（例如“F-WSF 败者”），不提前填队名。
      </p>
    </div>
  );
}

/**
 * 完整晋级图：排位赛 → 瑞士轮 R1–R5 → 决赛，一张图看完全部流程。
 *
 * 排位赛与瑞士轮之间不画线：两者的关系是"排位前 16 名进入瑞士轮"，
 * 跨列连线只会变成一团乱麻，用列标题表达更清楚。
 */
function FullJourneyView() {
  const { derived } = useData();
  const renderSeriesNode = useSeriesNode();

  const model = useMemo(() => (derived ? buildFullModel(derived.event) : null), [derived]);

  /** 瑞士轮与排位赛的节点用各自的数据描述，不借用决赛的解析结果。 */
  const renderNode = useMemo(() => {
    const fallbackNode = (nodeId: string): BracketNodeContent => ({ title: nodeId, rows: [] });
    const seriesNode = renderSeriesNode ?? fallbackNode;
    if (!derived) return fallbackNode;

    const { event, teamMap, venueLabels, finals } = derived;
    const runById = new Map(event.qualification.runs.map((r) => [r.id, r]));
    const swissById = new Map(event.swiss.matches.map((m) => [m.id, m]));

    return (nodeId: string): BracketNodeContent => {
      const run = runById.get(nodeId);
      if (run) {
        const team = teamMap.get(run.teamId)?.team ?? null;
        return {
          title: `排位赛第 ${run.round} 轮`,
          rows: [
            { label: '', team: team ? team.name : run.teamId },
            { label: '', team: `${venueLabels.get(run.venueId) ?? run.venueId} 单独跑图`, dim: true },
          ],
          meta: run.rawResult ?? '尚未比赛',
          status: run.resultStatus === 'confirmed' ? 'done' : 'upcoming',
        };
      }

      const match = swissById.get(nodeId);
      if (match) {
        const { home, away, pending } = nodeParticipants(nodeId, event, finals);
        const decided = match.participantSnapshot
          ? match.attempts.some((a) => a.resultStatus === 'confirmed')
          : false;

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
            title: `瑞士轮 R${match.roundIndex}`,
            rows: [{ label: '', team: refReason() ?? '对阵待公布', dim: true }],
            meta: `${match.groupRecord} 战绩组`,
            status: 'upcoming',
            to: `/matches/${nodeId}`,
          };
        }

        return {
          title: `瑞士轮 R${match.roundIndex}`,
          rows: [
            { label: '', team: label(home, 0), dim: home === null },
            { label: '', team: label(away, 1), dim: away === null },
          ],
          meta: `${match.groupRecord} 战绩组${decided ? ' · 已结算' : ''}`,
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
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <BracketLegend />
      <BracketChart
        columns={model.columns}
        connections={model.connections}
        renderNode={renderNode}
        sectionLabel={sectionLabel}
        minColumnWidth={176}
        ariaLabel="完整晋级图：排位赛、瑞士轮与决赛，可横向滚动"
      />
      <p className="xsmall muted">
        排位赛为单队跑图（两轮取最优），前 16 名进入瑞士轮；瑞士轮 5 轮后 3 胜晋级八强；
        八强之后的连线表示胜者与败者的去向。排位赛与瑞士轮之间不连线，因为没有逐场对应关系。
      </p>
    </div>
  );
}
