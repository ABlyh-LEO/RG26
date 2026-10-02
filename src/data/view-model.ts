/**
 * 派生视图模型：把领域计算结果整理成页面直接可用的形状。
 *
 * 原则：
 * - 页面不重复实现任何规则；一切计算来自 domain/*。
 * - “待确认”与“正式公布”在这里就分开，UI 只负责呈现。
 * - 当前时间由调用方传入，不在派生逻辑里读时钟。
 */
import type {
  EventFile,
  QualificationRun,
  FinalsSeed,
  ScheduleItem,
  Series,
  SwissMatch,
  Team,
} from '../domain/schema';
import {
  type Standings,
  calculateSwissStandings,
} from '../domain/standings';
import { describeGroup, groupStakes, ROUND_GROUP_ORDER } from '../domain/swiss';
import { computeQualificationRanking } from '../domain/qualification-ranking';
import { type Sides, sidesForFinals, sidesForSwiss } from '../domain/sides';
import {
  type Awards,
  type FinalsResolution,
  deriveExtras,
  finalsMatchNoLabel,
  resolveFinals,
  seedingToMap,
} from '../domain/finals';

export interface TeamView {
  team: Team;
  displayName: string;
  shortLabel: string;
  /** 是否需要在 UI 上标注“待核对”。 */
  needsReview: boolean;
}

export function shortLabel(team: Team): string {
  return team.division === 'competitive' ? `${team.number} 号` : `展示 ${team.number} 号`;
}

export function buildTeamMap(event: EventFile): Map<string, TeamView> {
  const map = new Map<string, TeamView>();
  for (const team of event.teams) {
    map.set(team.id, {
      team: team,
      displayName: team.name,
      shortLabel: shortLabel(team),
      needsReview: !team.nameVerified,
    });
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * 赛事整体状态
 * ------------------------------------------------------------------ */

export type EventPhase = 'before' | 'during' | 'after' | 'unknown';

/**
 * 判断赛事阶段。
 * 依据是**已确认结果或显式赛事状态**，不能只看当前日期。
 * 时间已过去但没有成绩时显示“结果待发布”，不能生成虚假冠军。
 */
export function deriveEventPhase(event: EventFile, now: Date): EventPhase {
  if (resolveFinals(event.finals.series, event.finals.seeding).series.get('F-GF')?.decided) return 'after';
  const confirmedResults =
    event.qualification.ranking.status === 'confirmed' ||
    event.swiss.matches.some((m) => m.attempts.some((a) => a.resultStatus === 'confirmed')) ||
    event.finals.series.some((s) => s.games.some((g) => g.resultStatus === 'confirmed'));

  const firstDate = event.event.dates[0];
  const lastDate = event.event.dates[event.event.dates.length - 1];
  if (!firstDate || !lastDate) return 'unknown';

  const startOfFirst = Date.parse(`${firstDate}T00:00:00+08:00`);
  const endOfLast = Date.parse(`${lastDate}T23:59:59+08:00`);
  const t = now.getTime();

  if (t < startOfFirst && !confirmedResults) return 'before';
  if (t > endOfLast) {
    // 赛事日期已过：只有存在已确认结果才算结束，否则是“结果待发布”
    return 'during';
  }
  return 'during';
}

/** 默认展示日期：必须能容纳“当前时间不在赛事两天内”的情形，不能打开空白“今天”。 */
export function defaultDate(event: EventFile, now: Date): string {
  const dates = event.event.dates;
  const todayInTz = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  if (dates.includes(todayInTz)) return todayInTz;

  // 取当前时间之后最近的一天；都过去了则取最后一天；都还没到则取第一天。
  const upcoming = dates.filter((d) => d >= todayInTz).sort();
  if (upcoming.length > 0) return upcoming[0]!;
  return dates[dates.length - 1] ?? dates[0]!;
}

/* ------------------------------------------------------------------ *
 * 时间与显示工具（始终按赛事时区）
 * ------------------------------------------------------------------ */

export const EVENT_TIME_ZONE = 'Asia/Shanghai';

/** 修订时间是当前安排，原计划仍保留供对照。 */
export function effectiveStart(schedule: Pick<ScheduleItem, 'plannedStart' | 'revisedStart'>): string {
  return schedule.revisedStart ?? schedule.plannedStart;
}

/** 把带偏移的 ISO 时刻格式化为赛事时区的 HH:MM。 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', {
    timeZone: EVENT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', {
    timeZone: EVENT_TIME_ZONE,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

/** 赛事时区下的“今天”字符串。 */
export function todayInEventTz(now: Date): string {
  return now.toLocaleDateString('sv-SE', { timeZone: EVENT_TIME_ZONE });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

/* ------------------------------------------------------------------ *
 * 比赛卡视图
 * ------------------------------------------------------------------ */

export interface MatchSideView {
  /** 已确定的队伍；未确定时为 null。 */
  team: Team | null;
  /** 队伍来源说明，例如 "F-W1A 败者"、"排位赛第 1 名"。 */
  sourceLabel: string;
  score: string | null;
  seconds: string | null;
  isWinner: boolean;
}

export interface MatchView {
  id: string;
  kind: 'swiss' | 'series' | 'run';
  title: string;
  stage: 'qualification' | 'swiss' | 'finals' | 'showcase';
  groupRecord: string | null;
  groupDescription: string | null;
  stakes: string | null;
  roundIndex: number | null;
  orderInGroup: number | null;
  schedule: ScheduleItem | null;
  venueLabel: string | null;
  format: 'BO1' | 'BO2' | 'BO3' | null;
  executionStatus: ScheduleItem['executionStatus'];
  resultStatus: 'none' | 'provisional' | 'confirmed';
  /** 双方已确定队伍时才有值，用于自我对阵等异常提示。 */
  sides: [MatchSideView, MatchSideView] | null;
  /**
   * 本场红蓝方归属（第一个席位 / 第二个席位的颜色）。
   *
   * 由赛程结构推出（`domain/sides.ts`），不落库：
   * 默认第一席位蓝、第二红；瑞士轮偶数轮反向；八强双败不反向。
   * 对阵未确定时为 null —— **不猜测**颜色。
   * BO3 的每一局另有归属，见比赛详情页。
   */
  sidesInfo: Sides | null;
  homeWins: number | null;
  awayWins: number | null;
  /** BO3 中标记为“不需要进行”的小局序号。 */
  notNeededGames: number[];
  note: string | null;
  /** 依赖不一致等冲突。 */
  conflicts: string[];
  countsForStandings: boolean;
}

function slotSourceLabel(
  match: SwissMatch,
  index: number,
  teamMap: Map<string, TeamView>,
): string {
  const ref = match.slots[index];
  if (!ref) return '待定';
  switch (ref.kind) {
    case 'team': {
      const view = teamMap.get(ref.teamId);
      return view ? view.displayName : ref.teamId;
    }
    case 'qualification-rank':
      return `排位赛第 ${ref.rank} 名`;
    case 'pending':
      return ref.reason;
    case 'finals-seed':
      return ref.seed;
    // 一律用场次序号，不把内部 ID（F-L2A 之类）露给观众
    case 'winner': {
      const no = finalsMatchNoLabel(ref.seriesId);
      return no ? `${no}胜者` : '上一场胜者';
    }
    case 'loser': {
      const no = finalsMatchNoLabel(ref.seriesId);
      return no ? `${no}败者` : '上一场败者';
    }
  }
}

/** 把一次排位赛跑图转成视图。 */
export function toQualificationRunView(
  run: QualificationRun,
  event: EventFile,
  teamMap: Map<string, TeamView>,
  venueLabels: Map<string, string>,
): MatchView {
  const schedule = event.scheduleItems.find((s) => s.id === run.scheduleItemId) ?? null;
  const view = teamMap.get(run.teamId);
  const team = view?.team ?? null;

  // 跑图是单队项目：只有一个“本方”，没有对手。
  const sides: [MatchSideView, MatchSideView] | null = team
    ? [
        {
          team,
          sourceLabel: view?.displayName ?? run.teamId,
          score: run.score,
          seconds: run.elapsedSeconds,
          isWinner: false,
        },
        {
          team: null,
          sourceLabel: '单队跑图',
          score: null,
          seconds: null,
          isWinner: false,
        },
      ]
    : null;

  const [w = '0', l = '0'] = ['0', '0'];
  void w;
  void l;

  return {
    id: run.id,
    kind: 'run',
    // 单队跑图没有对手，因此没有红蓝方
    sidesInfo: null,
    title: `排位赛第 ${run.round} 轮 · ${view?.displayName ?? run.teamId}`,
    stage: 'qualification',
    groupRecord: null,
    groupDescription: null,
    stakes: null,
    roundIndex: run.round,
    orderInGroup: team?.thirdReviewRank ?? null,
    schedule,
    venueLabel: venueLabels.get(run.venueId) ?? run.venueId,
    format: null,
    executionStatus: run.executionStatus,
    resultStatus: run.resultStatus,
    sides,
    homeWins: null,
    awayWins: null,
    notNeededGames: [],
    note: run.judgeNote,
    conflicts: [],
    countsForStandings: false,
  };
}

/** 把一场瑞士轮比赛转成视图。 */
export function toSwissMatchView(
  match: SwissMatch,
  event: EventFile,
  teamMap: Map<string, TeamView>,
  venueLabels: Map<string, string>,
): MatchView {
  const schedule = event.scheduleItems.find((s) => s.id === match.scheduleItemId) ?? null;
  const effective = match.attempts.find((a) => a.id === match.effectiveAttemptId) ?? null;
  const snapshot = match.participantSnapshot;

  const sides: [MatchSideView, MatchSideView] | null = snapshot
    ? [
        makeSide(snapshot[0], effective, true, teamMap),
        makeSide(snapshot[1], effective, false, teamMap),
      ]
    : null;

  const fallbackSides: [MatchSideView, MatchSideView] = [
    { team: null, sourceLabel: slotSourceLabel(match, 0, teamMap), score: null, seconds: null, isWinner: false },
    { team: null, sourceLabel: slotSourceLabel(match, 1, teamMap), score: null, seconds: null, isWinner: false },
  ];

  const [w = '0', l = '0'] = match.groupRecord.split('-');

  return {
    id: match.id,
    kind: 'swiss',
    title: `瑞士轮 R${match.roundIndex} · ${match.groupRecord} 组第 ${match.orderInGroup} 场`,
    stage: 'swiss',
    groupRecord: match.groupRecord,
    groupDescription: describeGroup(match.groupRecord),
    stakes: groupStakes(Number(w), Number(l)),
    roundIndex: match.roundIndex,
    orderInGroup: match.orderInGroup,
    schedule,
    venueLabel: schedule?.venueId ? (venueLabels.get(schedule.venueId) ?? null) : null,
    format: 'BO1',
    executionStatus: match.executionStatus,
    resultStatus: effective?.resultStatus ?? 'none',
    sides: sides ?? fallbackSides,
    // 瑞士轮：偶数轮换边，由轮次推出
    sidesInfo: snapshot ? sidesForSwiss(match.roundIndex) : null,
    homeWins: null,
    awayWins: null,
    notNeededGames: [],
    note: match.note,
    conflicts: [],
    countsForStandings: true,
  };
}

function makeSide(
  teamId: string,
  effective: { homeTeamId: string; awayTeamId: string; homeScore: string | null; awayScore: string | null; homeReachedSeconds: string | null; awayReachedSeconds: string | null; winnerId: string | null } | null,
  isHome: boolean,
  teamMap: Map<string, TeamView>,
): MatchSideView {
  const view = teamMap.get(teamId);
  const hasResult = effective !== null;
  return {
    team: view?.team ?? null,
    sourceLabel: view?.displayName ?? teamId,
    score: hasResult ? (isHome ? effective.homeScore : effective.awayScore) : null,
    seconds: effective ? (isHome ? effective.homeReachedSeconds : effective.awayReachedSeconds) : null,
    isWinner: hasResult && effective.winnerId === teamId,
  };
}

/** 把决赛系列赛转成视图。 */
export function toSeriesView(
  series: Series,
  event: EventFile,
  teamMap: Map<string, TeamView>,
  venueLabels: Map<string, string>,
  resolution: FinalsResolution,
): MatchView {
  const schedule = event.scheduleItems.find((s) => s.id === series.scheduleItemId) ?? null;
  const res = resolution.series.get(series.id);
  const games = [...series.games].sort((a, b) => a.index - b.index);
  const firstConfirmed = games.find((g) => g.resultStatus === 'confirmed') ?? null;
  const singleGame = series.format === 'BO1' ? games.find((g) => g.resultStatus !== 'none') : null;
  const scoreFor = (teamId: string | null, metric: 'score' | 'seconds'): string | null => {
    if (!singleGame || !teamId || !['normal', 'early-end'].includes(singleGame.resultKind)) return null;
    if (singleGame.homeTeamId === teamId) return metric === 'score' ? singleGame.homeScore : singleGame.homeReachedSeconds;
    if (singleGame.awayTeamId === teamId) return metric === 'score' ? singleGame.awayScore : singleGame.awayReachedSeconds;
    return null;
  };
  const resultStatus: 'none' | 'provisional' | 'confirmed' = series.games.some(
    (g) => g.resultStatus === 'confirmed',
  )
    ? 'confirmed'
    : series.games.some((g) => g.resultStatus === 'provisional')
      ? 'provisional'
      : 'none';

  const showcaseTeam = series.showcaseTeamId ? teamMap.get(series.showcaseTeamId)?.team ?? null : null;
  const sides: [MatchSideView, MatchSideView] | null = series.stage === 'showcase'
    ? [
        { team: showcaseTeam, sourceLabel: showcaseTeam?.name ?? '演出队伍待抽签', score: null, seconds: null, isWinner: false },
        { team: null, sourceLabel: '单队展示', score: null, seconds: null, isWinner: false },
      ]
    : res
    ? [
        {
          team: res.slots[0].state === 'resolved' ? (teamMap.get(res.slots[0].teamId)?.team ?? null) : null,
          sourceLabel:
            res.slots[0].state === 'resolved'
              ? (teamMap.get(res.slots[0].teamId)?.displayName ?? res.slots[0].teamId)
              : res.slots[0].label,
          score: scoreFor(res.slots[0].state === 'resolved' ? res.slots[0].teamId : null, 'score'),
          seconds: scoreFor(res.slots[0].state === 'resolved' ? res.slots[0].teamId : null, 'seconds'),
          isWinner: res.decided && res.winnerId === (res.slots[0].state === 'resolved' ? res.slots[0].teamId : null),
        },
        {
          team: res.slots[1].state === 'resolved' ? (teamMap.get(res.slots[1].teamId)?.team ?? null) : null,
          sourceLabel:
            res.slots[1].state === 'resolved'
              ? (teamMap.get(res.slots[1].teamId)?.displayName ?? res.slots[1].teamId)
              : res.slots[1].label,
          score: scoreFor(res.slots[1].state === 'resolved' ? res.slots[1].teamId : null, 'score'),
          seconds: scoreFor(res.slots[1].state === 'resolved' ? res.slots[1].teamId : null, 'seconds'),
          isWinner: res.decided && res.winnerId === (res.slots[1].state === 'resolved' ? res.slots[1].teamId : null),
        },
      ]
    : null;

  const matchNo = finalsMatchNoLabel(series.id);

  return {
    id: series.id,
    kind: 'series',
    // 标题带场次序号，让"第 5 场败者"这类来源说明能对上号
    title: matchNo ? `${matchNo}·${res?.label ?? series.id}` : (res?.label ?? series.id),
    stage: series.stage,
    groupRecord: null,
    groupDescription: null,
    stakes: null,
    roundIndex: null,
    orderInGroup: null,
    schedule,
    venueLabel: schedule?.venueId ? (venueLabels.get(schedule.venueId) ?? null) : null,
    format: series.format,
    // 已确认的小局已经决出系列赛时，以实际赛果结束展示，兼容旧数据残留的 running。
    executionStatus: res?.decided ? 'finished' : series.executionStatus,
    resultStatus,
    sides,
    /*
     * 决赛红蓝方：八强双败**不换边**，一律第一席位蓝、第二红。
     * BO3 的每一局各自换边，因此系列赛层面不给单一归属 ——
     * 那种情况在比赛详情页按局展示，避免把"第 1 局的归属"误当成整个系列赛的。
     */
    sidesInfo: sides && series.slots && series.format !== 'BO3' ? sidesForFinals() : null,
    homeWins: res?.homeWins ?? null,
    awayWins: res?.awayWins ?? null,
    notNeededGames: res?.notNeededGameIndexes ?? [],
    note: series.note ?? firstConfirmed?.note ?? null,
    conflicts: res?.conflicts ?? [],
    countsForStandings: series.countsForStandings,
  };
}

/* ------------------------------------------------------------------ *
 * 汇总视图
 * ------------------------------------------------------------------ */

export interface DerivedEvent {
  event: EventFile;
  teamMap: Map<string, TeamView>;
  venueLabels: Map<string, string>;
  /** 正式排位赛排名（未确认时 status 为 none，UI 显示待公布）。 */
  qualification: {
    orderedTeamIds: string[];
    status: EventFile['qualification']['ranking']['status'];
    bestResultLabels: string[] | null;
    confirmedAt: string | null;
    publishedAt: string | null;
    /**
     * 每队计入名次的那一轮（1 或 2），由**已确认成绩**按
     * 「积分高者优，同分时用时短者优」算出。
     *
     * 用于在公开的跑图记录表里标出"哪一轮算数"，让观众能把
     * 原始成绩和名次表里的数字对上。无可用成绩的队伍不在表里。
     */
    bestByTeam: Map<string, 1 | 2>;
  };
  /** 瑞士轮排名（全部比赛，等价于“截至最后已确认轮次”）。 */
  standings: Standings;
  /** 决赛解析结果。 */
  finals: FinalsResolution;
  awards: Awards;
  scheduleByDate: ScheduleItem[];
  dates: string[];
  /** 已确认结果的瑞士轮场次数。 */
  swissConfirmedCount: number;
  /** 瑞士轮总槽位数。 */
  swissTotalCount: number;
}

/** 参赛十六强：正式排位前 16。 */
export function qualifiedTeamIds(event: EventFile): string[] {
  const ranking = event.qualification.ranking;
  if (ranking.status === 'confirmed' && ranking.orderedTeamIds.length >= 16) {
    return ranking.orderedTeamIds.slice(0, 16);
  }
  // 未确认时：若瑞士轮已有实际参赛队伍，用它们；否则用全部竞技组队伍（仅用于展示空状态）
  const fromSwiss = new Set<string>();
  for (const m of event.swiss.matches) {
    if (m.participantSnapshot) {
      fromSwiss.add(m.participantSnapshot[0]);
      fromSwiss.add(m.participantSnapshot[1]);
    }
  }
  if (fromSwiss.size > 0) return [...fromSwiss];
  return event.teams.filter((t) => t.division === 'competitive').map((t) => t.id);
}

export function deriveEvent(event: EventFile): DerivedEvent {
  const teamMap = buildTeamMap(event);
  const venueLabels = new Map(event.venues.map((v) => [v.id, v.label]));
  const teamIds = qualifiedTeamIds(event);

  const standings = calculateSwissStandings(teamIds, event.swiss.matches, event.qualification.ranking);

  const extras = deriveExtras(standings, event.qualification.ranking.orderedTeamIds);
  const finals = resolveFinals(event.finals.series, event.finals.seeding, extras);

  const swissConfirmedCount = event.swiss.matches.filter((m) =>
    m.attempts.some((a) => a.id === m.effectiveAttemptId && a.resultStatus === 'confirmed'),
  ).length;

  return {
    event,
    teamMap,
    venueLabels,
    qualification: {
      orderedTeamIds: event.qualification.ranking.orderedTeamIds,
      status: event.qualification.ranking.status,
      bestResultLabels: event.qualification.ranking.bestResultLabels,
      confirmedAt: event.qualification.ranking.confirmedAt,
      publishedAt: event.qualification.ranking.publishedAt,
      bestByTeam: computeBestRounds(event),
    },
    standings,
    finals,
    awards: finals.awards,
    scheduleByDate: [...event.scheduleItems].sort(
      (a, b) => Date.parse(effectiveStart(a)) - Date.parse(effectiveStart(b)),
    ),
    dates: event.event.dates,
    swissConfirmedCount,
    swissTotalCount: event.swiss.matches.length,
  };
}

/**
 * 每队计入名次的那一轮。
 *
 * 复用 domain 层的纯函数，口径与维护工具、名次表**完全一致**
 * （积分高者优；同分时用时短者优），避免页面自己重算出现分歧。
 */
function computeBestRounds(event: EventFile): Map<string, 1 | 2> {
  const result = new Map<string, 1 | 2>();
  for (const standing of computeQualificationRanking(event).standings) {
    const best = standing.best;
    if (best && !best.incomplete) result.set(standing.teamId, best.round);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * “正在进行 / 下一场”逻辑（首页）
 * ------------------------------------------------------------------ */
export interface NowPlaying {
  /** 显式标记为 running 的项目。 */
  running: MatchView[];
  /** 下一批计划项目（无 running 时）。 */
  upcoming: MatchView[];
  /**
   * 已过计划开始时间但仍未更新状态的项目 → 显示“等待现场确认”，
   * 绝不显示负数倒计时。
   */
  awaitingConfirmation: MatchView[];
  /** 赛事尚未开始时的首日安排。 */
  firstDayPreview: ScheduleItem[];
  /** 赛事结束后的归档入口日期。 */
  archiveDates: string[];
}

export function deriveNowPlaying(derived: DerivedEvent, now: Date): NowPlaying {
  const { event, teamMap, venueLabels } = derived;
  const phase = deriveEventPhase(event, now);
  const t = now.getTime();

  // 必须包含排位赛跑图：否则赛事开始前的"下一批比赛"只会显示瑞士轮，
  // 让观众误以为第一天没有排位赛。
  const allViews: MatchView[] = [
    ...event.qualification.runs.map((r) => toQualificationRunView(r, event, teamMap, venueLabels)),
    ...event.swiss.matches.map((m) => toSwissMatchView(m, event, teamMap, venueLabels)),
    ...event.finals.series.map((s) => toSeriesView(s, event, teamMap, venueLabels, derived.finals)),
  ].filter((view) => view.schedule?.kind !== 'activity' && !(view.kind === 'series' && !view.countsForStandings && view.stage !== 'showcase'));

  const running = allViews.filter((v) => v.executionStatus === 'running');

  const withTime = allViews
    .filter((v) => v.schedule !== null)
    .sort((a, b) => Date.parse(effectiveStart(a.schedule!)) - Date.parse(effectiveStart(b.schedule!)));

  const awaitingConfirmation = withTime.filter(
    (v) =>
      Date.parse(effectiveStart(v.schedule!)) <= t &&
      (v.executionStatus === 'scheduled' || v.executionStatus === 'ready') &&
      v.resultStatus === 'none',
  );

  const upcoming = withTime.filter((v) => Date.parse(effectiveStart(v.schedule!)) > t && ['scheduled', 'ready', 'delayed'].includes(v.executionStatus));

  const firstDay = event.event.dates[0];
  const firstDayPreview =
    phase === 'before' && firstDay
      ? derived.scheduleByDate.filter((s) => s.date === firstDay)
      : [];

  return {
    running,
    // 没有正在进行时显示下一批计划项目
    upcoming: upcoming.slice(0, 6),
    awaitingConfirmation: awaitingConfirmation.slice(-6).reverse(),
    firstDayPreview,
    archiveDates: phase === 'after' ? event.event.dates : [],
  };
}

/* ------------------------------------------------------------------ *
 * 队伍相关视图
 * ------------------------------------------------------------------ */

export interface TeamJourney {
  team: Team;
  /** 该队的瑞士轮比赛（按轮次）。 */
  swissMatches: MatchView[];
  /** 该队的决赛系列赛。 */
  finalsMatches: MatchView[];
  /** 该队的排位赛跑图。 */
  qualificationRuns: EventFile['qualification']['runs'];
  /** 当前状态文案。 */
  status: 'qualification' | 'swiss-active' | 'advanced' | 'eliminated' | 'champion' | 'unknown';
  statusLabel: string;
  /** 下一场比赛。 */
  nextMatch: MatchView | null;
  /** 该队在瑞士轮排名中的条目。 */
  standingsEntry: ReturnType<Standings['byTeam']['get']> | undefined;
  /** 决赛种子。 */
  seeds: FinalsSeed[];
}

export function deriveTeamJourney(derived: DerivedEvent, teamId: string, now: Date): TeamJourney | null {
  const { event, teamMap, venueLabels } = derived;
  const view = teamMap.get(teamId);
  if (!view) return null;
  const team = view.team;

  const swissMatches = event.swiss.matches
    .filter((m) => m.participantSnapshot?.includes(teamId))
    .map((m) => toSwissMatchView(m, event, teamMap, venueLabels))
    .sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0));

  const seriesSeeds = seedingToMap(event.finals.seeding);
  const isInFinals = Object.values(seriesSeeds).includes(teamId);

  const finalsMatches = event.finals.series
    .filter((s) => {
      if (s.showcaseTeamId === teamId) return true;
      if (s.participantSnapshot?.includes(teamId)) return true;
      const res = derived.finals.series.get(s.id);
      if (!res) return false;
      return res.slots.some((slot) => slot.state === 'resolved' && slot.teamId === teamId);
    })
    .map((s) => toSeriesView(s, event, teamMap, venueLabels, derived.finals));

  const standingsEntry = derived.standings.byTeam.get(teamId);

  const seeds = (Object.entries(seriesSeeds) as [FinalsSeed, string][])
    .filter(([, id]) => id === teamId)
    .map(([seed]) => seed);

  const t = now.getTime();
  const qualificationMatches = event.qualification.runs
    .filter((run) => run.teamId === teamId)
    .map((run) => toQualificationRunView(run, event, teamMap, venueLabels));
  const candidates = [...qualificationMatches, ...swissMatches, ...finalsMatches]
    .filter((m) => m.schedule !== null && !['cancelled', 'finished', 'not-needed'].includes(m.executionStatus) && (m.resultStatus !== 'confirmed' || m.executionStatus === 'running' || m.format === 'BO3'))
    .sort((a, b) => Date.parse(effectiveStart(a.schedule!)) - Date.parse(effectiveStart(b.schedule!)));
  const nextMatch = candidates.find((m) => m.executionStatus === 'running') ?? candidates.find((m) => Date.parse(effectiveStart(m.schedule!)) >= t - 60 * 60 * 1000) ?? candidates[0] ?? null;

  const { status, statusLabel } = teamStatus(derived, teamId, team, standingsEntry, isInFinals);

  return {
    team,
    swissMatches,
    finalsMatches,
    qualificationRuns: event.qualification.runs.filter((r) => r.teamId === teamId),
    status,
    statusLabel,
    nextMatch,
    standingsEntry,
    seeds,
  };
}

function teamStatus(
  derived: DerivedEvent,
  teamId: string,
  team: Team,
  entry: ReturnType<Standings['byTeam']['get']> | undefined,
  isInFinals: boolean,
): { status: TeamJourney['status']; statusLabel: string } {
  if (team.division === 'showcase') {
    return { status: 'qualification', statusLabel: '展示组' };
  }

  if (derived.awards.champion === teamId) return { status: 'champion', statusLabel: '冠军' };
  if (derived.awards.runnerUp === teamId) return { status: 'eliminated', statusLabel: '亚军' };
  if (derived.awards.third === teamId) return { status: 'eliminated', statusLabel: '季军' };
  if (derived.awards.topFour.includes(teamId)) return { status: 'eliminated', statusLabel: '四强' };
  if (derived.awards.topEight.includes(teamId)) return { status: 'eliminated', statusLabel: '八强' };
  if (isInFinals) return { status: 'advanced', statusLabel: '八强（晋级决赛）' };
  if (derived.awards.topSixteen.includes(teamId)) return { status: 'eliminated', statusLabel: '十六强' };
  if (derived.awards.honorableMention.includes(teamId)) return { status: 'eliminated', statusLabel: '优秀奖' };

  if (entry) {
    if (entry.wins >= 3) return { status: 'advanced', statusLabel: '晋级八强' };
    if (entry.losses >= 3) return { status: 'eliminated', statusLabel: '十六强（淘汰）' };
    if (entry.metrics.m > 0) {
      return { status: 'swiss-active', statusLabel: `瑞士轮进行中（${entry.record}）` };
    }
  }

  if (derived.qualification.status === 'confirmed') {
    const rank = derived.qualification.orderedTeamIds.indexOf(teamId);
    if (rank >= 0) {
      return rank < 16
        ? { status: 'advanced', statusLabel: `排位赛第 ${rank + 1} 名 · 晋级十六强` }
        : { status: 'eliminated', statusLabel: `排位赛第 ${rank + 1} 名 · 优秀奖` };
    }
  }

  return { status: 'qualification', statusLabel: '排位赛阶段' };
}

/* ------------------------------------------------------------------ *
 * 晋级页：各轮分组视图
 * ------------------------------------------------------------------ */

export interface RoundGroupView {
  record: string;
  description: string;
  stakes: string | null;
  matches: MatchView[];
  /** 该组在本轮的排名（用于展示参考排名）。 */
  entries: Standings['groups'][number]['entries'];
}

export interface RoundView {
  index: number;
  id: string;
  publicationStatus: EventFile['swiss']['rounds'][number]['publicationStatus'];
  publishedAt: string | null;
  closedAt: string | null;
  revisionNote: string | null;
  groups: RoundGroupView[];
  /** 该轮是否全部确认。 */
  complete: boolean;
  /** 该轮的评分是否可作为“正式”依据。 */
  basedOnRound: number;
}

export function deriveRounds(derived: DerivedEvent): RoundView[] {
  const { event, teamMap, venueLabels } = derived;
  const rounds = [...event.swiss.rounds].sort((a, b) => a.index - b.index);

  // 每一轮的排名快照：优先用已冻结的快照，否则用“截至该轮已确认结果”的实时计算。
  return rounds.map((round) => {
    const matches = round.matchIds
      .map((id) => event.swiss.matches.find((m) => m.id === id))
      .filter((m): m is SwissMatch => m !== undefined);

    const settledUpToRound = event.swiss.matches.filter((m) => {
      if (m.roundIndex > round.index) return false;
      return m.attempts.some((a) => a.id === m.effectiveAttemptId && a.resultStatus === 'confirmed');
    });
    const standingsForRound = calculateSwissStandings(
      qualifiedTeamIds(event),
      settledUpToRound,
      event.qualification.ranking,
    );

    const groupOrder = ROUND_GROUP_ORDER[round.index] ?? ['0-0'];
    const groups: RoundGroupView[] = groupOrder
      .map((record) => {
        const groupMatches = matches
          .filter((m) => m.groupRecord === record)
          .sort((a, b) => a.orderInGroup - b.orderInGroup)
          .map((m) => toSwissMatchView(m, event, teamMap, venueLabels));
        const [w = '0', l = '0'] = record.split('-');
        return {
          record,
          description: describeGroup(record),
          stakes: groupStakes(Number(w), Number(l)),
          matches: groupMatches,
          entries: standingsForRound.groups.find((g) => g.record === record)?.entries ?? [],
        };
      })
      .filter((g) => g.matches.length > 0);

    const complete =
      matches.length > 0 &&
      matches.every((m) =>
        m.attempts.some((a) => a.id === m.effectiveAttemptId && a.resultStatus === 'confirmed'),
      );

    return {
      index: round.index,
      id: round.id,
      publicationStatus: round.publicationStatus,
      publishedAt: round.publishedAt,
      closedAt: round.closedAt,
      revisionNote: round.revisionNote,
      groups,
      complete,
      basedOnRound: round.basedOnRound,
    };
  });
}

/** 竞赛计数：区分跑图次数、对阵/系列赛数量、已打小局数。 */
export interface CompetitionCounts {
  qualificationRuns: { total: number; completed: number };
  swissMatches: { total: number; completed: number };
  finals: {
    /** 计入排名的系列赛数量。 */
    seriesCount: number;
    /** BO1 场次数。 */
    bo1Count: number;
    /** BO3 系列赛数量。 */
    bo3Count: number;
    /** 已确认的小局数。 */
    gamesPlayed: number;
    /** 已在系列赛中达成有效结果的数量（已决出胜者的系列赛数）。 */
    seriesDecided: number;
  };
  showcase: { total: number; performed: number };
}

export function deriveCounts(derived: DerivedEvent): CompetitionCounts {
  const { event } = derived;

  const competitiveSeries = event.finals.series.filter((s) => s.countsForStandings);
  const showcaseSeries = event.finals.series.filter((s) => s.stage === 'showcase');

  let gamesPlayed = 0;
  let seriesDecided = 0;
  for (const s of competitiveSeries) {
    gamesPlayed += s.games.filter((g) => g.resultStatus === 'confirmed').length;
    const res = derived.finals.series.get(s.id);
    if (res?.decided) seriesDecided += 1;
  }

  return {
    qualificationRuns: {
      total: event.qualification.runs.length,
      completed: event.qualification.runs.filter((r) => r.resultStatus === 'confirmed').length,
    },
    swissMatches: {
      total: event.swiss.matches.length,
      completed: derived.swissConfirmedCount,
    },
    finals: {
      seriesCount: competitiveSeries.length,
      bo1Count: competitiveSeries.filter((s) => s.format === 'BO1').length,
      bo3Count: competitiveSeries.filter((s) => s.format === 'BO3').length,
      gamesPlayed,
      seriesDecided,
    },
    showcase: {
      total: showcaseSeries.length,
      performed: showcaseSeries.filter((s) => s.executionStatus === 'finished').length,
    },
  };
}
