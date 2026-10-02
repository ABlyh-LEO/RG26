/**
 * 种子数据定义：队伍、场地、日程与空赛果结构。
 *
 * 这里是 docx 与实施计划第 3、4 节的忠实转写。规则要点：
 * - 队名逐项对照 docs/reference/image1.png 与 image2.png 人工核读。
 * - 未能 100% 确认的字形保留 nameVerified:false 与 nameNote，绝不臆造队名。
 * - 所有结果为 null / 空数组；绝不预演真实赛果。
 */
import { FINALS_NODES } from '../src/domain/finals';
import type { EventFile, Series, SlotRef, SwissMatch, SwissRound, Team, Venue } from '../src/domain/schema';

/**
 * 原始文档哈希。
 *
 * 2026-10 手册更新（docs/RoboGame2026赛程安排（暂定） (1).docx）：
 * 瑞士轮时间调整、第三轮改为首日晚间、增加次日上午双败首轮四场。
 * 哈希随之更新，以便校验器发现"源文档又变了"。
 */
export const SOURCE_DOC_SHA256 = '89c9fb3fd29f13c4daaacba8bd921744df7f5da264b86c3683cc8ca7484e7bf2';

export const EVENT_ID = 'robogame-2026';

export const RULES_VERSION = '4_6';

/* ------------------------------------------------------------------ *
 * 队伍名单（逐项对照官方图片核读）
 * ------------------------------------------------------------------ */

interface RosterEntry {
  number: number;
  name: string;
  verified: boolean;
  note: string | null;
}

/**
 * 竞技组 22 队，按三审排名 1–22。
 *
 * 队名已由用户提供的**官方名单**逐项确认（2026-10-01），全部 nameVerified: true。
 *
 * 此前从低分辨率图片核读时有四处存疑，现已定案：
 * - 第 5 名首字为「沫」（非「沬」）—— 图片上两点水与三点水难以分辨，以官方名单为准。
 * - 第 17 名为「少微摸个鱼队」（摸，非「模」）—— 此前按图片误判为「模」。
 * - 第 14 名小写 `rg`、第 16 名大写 `Rg`：两处写法确实不同，保留原样，不做统一。
 * - 第 11 名为「煽风点火队」（非「瀚」）。
 */
export const COMPETITIVE_ROSTER: readonly RosterEntry[] = [
  { number: 18, name: 'Uniforest队', verified: true, note: null },
  { number: 4, name: '机器曼妙队', verified: true, note: null },
  { number: 5, name: '保卫萝卜队', verified: true, note: null },
  { number: 14, name: 'All Last队', verified: true, note: null },
  { number: 35, name: '沫日堡垒队', verified: true, note: null },
  { number: 1, name: '萝卜施工队', verified: true, note: null },
  { number: 10, name: '吃饭要排队', verified: true, note: null },
  { number: 23, name: '组一辈子战队', verified: true, note: null },
  { number: 6, name: '肥西路奶龙拆迁大队', verified: true, note: null },
  { number: 28, name: '拼好队', verified: true, note: null },
  { number: 2, name: '煽风点火队', verified: true, note: null },
  { number: 21, name: '西餐不好吃队', verified: true, note: null },
  { number: 25, name: '黄瓜同好会', verified: true, note: null },
  { number: 17, name: '我也要打rg吗，队', verified: true, note: null },
  { number: 13, name: '名字够长就一定会有人看队', verified: true, note: null },
  { number: 27, name: 'Rg小队', verified: true, note: null },
  { number: 3, name: '少微摸个鱼队', verified: true, note: null },
  { number: 9, name: '超时空辉月机队', verified: true, note: null },
  { number: 31, name: '啊对对队', verified: true, note: null },
  { number: 12, name: '萝卜给猫队', verified: true, note: null },
  { number: 29, name: 'iRunTV队', verified: true, note: null },
  { number: 8, name: 'AAA平地起高楼施工队', verified: true, note: null },
];

/** 展示组 3 队，按队伍编号 1、2、3。决赛演出顺序由抽签决定，不沿用此顺序。 */
export const SHOWCASE_ROSTER: readonly RosterEntry[] = [
  { number: 1, name: '晓啸启宇队', verified: true, note: null },
  { number: 2, name: 'Aura-Bot', verified: true, note: null },
  { number: 3, name: '海底小纵队', verified: true, note: null },
];

export function competitiveTeamId(number: number): string {
  return `competitive-${number}`;
}

export function showcaseTeamId(number: number): string {
  return `showcase-${number}`;
}

export function buildTeams(): Team[] {
  const teams: Team[] = [];
  COMPETITIVE_ROSTER.forEach((entry, index) => {
    teams.push({
      id: competitiveTeamId(entry.number),
      division: 'competitive',
      number: entry.number,
      name: entry.name,
      nameVerified: entry.verified,
      nameNote: entry.note,
      thirdReviewRank: index + 1,
    });
  });
  SHOWCASE_ROSTER.forEach((entry) => {
    teams.push({
      id: showcaseTeamId(entry.number),
      division: 'showcase',
      number: entry.number,
      name: entry.name,
      nameVerified: entry.verified,
      nameNote: entry.note,
      thirdReviewRank: null,
    });
  });
  return teams;
}

/* ------------------------------------------------------------------ *
 * 场地
 * ------------------------------------------------------------------ */

/**
 * 场地结构（据用户确认）：
 * - **主舞台**：所有两两对抗都在这里 —— 瑞士轮 33 场、决赛全部 BO1/BO3。
 * - **副场地A / 副场地B**：仅排位赛使用，两块并行跑图；
 *   每队两轮各用一个不同的场地（第 1 轮奇数名→A、偶数名→B，第 2 轮互换）。
 *
 * 三个名称均已于 2026-10-01 由用户确认，**不再是暂定名称**
 * （provisionalName: false），校验不再对它们输出提示。
 */
export const VENUE_MAIN = 'venue-main';
export const VENUE_A = 'venue-a';
export const VENUE_B = 'venue-b';

export const VENUE_LABEL_MAIN = '主舞台';
export const VENUE_LABEL_A = '副场地A';
export const VENUE_LABEL_B = '副场地B';

export function buildVenues(): Venue[] {
  return [
    {
      id: VENUE_MAIN,
      label: VENUE_LABEL_MAIN,
      provisionalName: false,
      note: '对抗类比赛（瑞士轮、决赛）场地',
    },
    {
      id: VENUE_A,
      label: VENUE_LABEL_A,
      provisionalName: false,
      note: '仅排位赛跑图使用',
    },
    {
      id: VENUE_B,
      label: VENUE_LABEL_B,
      provisionalName: false,
      note: '仅排位赛跑图使用',
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 时间工具（赛事时区固定为 Asia/Shanghai, +08:00）
 * ------------------------------------------------------------------ */

const TZ = '+08:00';

/** 由日期与当天的分秒构造带偏移的 ISO 8601 时刻。 */
export function at(date: string, hhmm: string, addMinutes = 0): string {
  const [h = '0', m = '0'] = hhmm.split(':');
  const total = Number(h) * 60 + Number(m) + addMinutes;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date}T${pad(hh)}:${pad(mm)}:00${TZ}`;
}

export const DAY1 = '2026-10-03';
export const DAY2 = '2026-10-04';

/* ------------------------------------------------------------------ *
 * 日程常量（第 4 节）
 * ------------------------------------------------------------------ */

/** 排位赛：每批 10 分钟，共 11 批；上午 09:00 起，下午 13:30 起。 */
export const QUAL_BATCH_MINUTES = 10;
export const QUAL_BATCH_COUNT = 11;
export const QUAL_ROUND1_START = '09:00';
export const QUAL_ROUND2_START = '13:30';

/** 瑞士轮各轮首场时间（第 4.1、4.2 节）。 */
export const SWISS_SLOT_PLAN: Record<number, { date: string; start: string; groupOrder: string[]; counts: Record<string, number> }> = {
  1: { date: DAY1, start: '16:00', groupOrder: ['0-0'], counts: { '0-0': 8 } },
  2: { date: DAY1, start: '18:00', groupOrder: ['1-0', '0-1'], counts: { '1-0': 4, '0-1': 4 } },
  // 新版赛程：第三轮八场全部在首日晚间完成。
  3: { date: DAY1, start: '19:40', groupOrder: ['2-0', '1-1', '0-2'], counts: { '2-0': 2, '1-1': 4, '0-2': 2 } },
  4: { date: DAY2, start: '09:00', groupOrder: ['2-1', '1-2'], counts: { '2-1': 3, '1-2': 3 } },
  5: { date: DAY2, start: '10:20', groupOrder: ['2-2'], counts: { '2-2': 3 } },
};

/**
 * R3 的槽位到具体时间的映射（第 4.1、4.2、5.4 节）。
 * 一次性发布全部 8 场，19:40 至 21:00 完成。
 */
export const R3_SLOT_TIMES: readonly { groupRecord: string; orderInGroup: number; date: string; start: string }[] = [
  { groupRecord: '2-0', orderInGroup: 1, date: DAY1, start: '19:40' },
  { groupRecord: '2-0', orderInGroup: 2, date: DAY1, start: '19:50' },
  { groupRecord: '1-1', orderInGroup: 1, date: DAY1, start: '20:00' },
  { groupRecord: '1-1', orderInGroup: 2, date: DAY1, start: '20:10' },
  { groupRecord: '1-1', orderInGroup: 3, date: DAY1, start: '20:20' },
  { groupRecord: '1-1', orderInGroup: 4, date: DAY1, start: '20:30' },
  { groupRecord: '0-2', orderInGroup: 1, date: DAY1, start: '20:40' },
  { groupRecord: '0-2', orderInGroup: 2, date: DAY1, start: '20:50' },
];

/**
 * 决赛各节点的时间（赛程手册「赛段三：决赛」）。
 *
 * 手册原文只有一处给到时间块：「16:35 起，竞技组先行 BO3 总决赛名额争夺战…
 * 而后，竞技组进行 BO3 总决赛…此时间段最多比赛 6 场」，并注明「16:35 之后
 * 两项比赛的结束时间以实际赛况为准」。
 *
 * 这里把时间块**铺开成固定时段**，依据仍是手册自身给出的量：
 * - 每场 10 分钟（手册「本赛段按每场 10 分钟、逐场进行编排」，赛段三每个
 *   20 分钟区间恰好放两场 BO1，口径一致）；
 * - 两组 BO3 合计最多 6 局，故整块上限 6 × 10 = 60 分钟，即 16:35–17:35；
 * - 表演赛为 15 分钟 BO2。
 *
 * 于是：名额争夺战 16:35–17:05、总决赛 17:05–17:35、表演赛 17:35–17:50。
 * `plannedEnd` 填的是**计划时段**，实际结束仍以赛况为准（界面保留该提示）；
 * `afterSeriesId` 继续记录真实依赖，供排序与「前序安排」显示。
 */
export const FINALS_SCHEDULE: readonly {
  id: string;
  date: string;
  start: string;
  end: string | null;
  afterSeriesId: string | null;
}[] = [
  { id: 'F-M1', date: DAY2, start: '11:10', end: '11:20', afterSeriesId: null },
  { id: 'F-M2', date: DAY2, start: '11:20', end: '11:30', afterSeriesId: null },
  { id: 'F-M3', date: DAY2, start: '11:30', end: '11:40', afterSeriesId: null },
  { id: 'F-M4', date: DAY2, start: '11:40', end: '11:50', afterSeriesId: null },
  { id: 'opening', date: DAY2, start: '14:00', end: '14:30', afterSeriesId: null },
  { id: 'F-L1A', date: DAY2, start: '14:30', end: '14:40', afterSeriesId: null },
  { id: 'F-L1B', date: DAY2, start: '14:40', end: '14:50', afterSeriesId: null },
  { id: 'showcase-final-1', date: DAY2, start: '14:50', end: '15:05', afterSeriesId: null },
  { id: 'F-W1A', date: DAY2, start: '15:05', end: '15:15', afterSeriesId: null },
  { id: 'F-W1B', date: DAY2, start: '15:15', end: '15:25', afterSeriesId: null },
  { id: 'showcase-final-2', date: DAY2, start: '15:25', end: '15:40', afterSeriesId: null },
  { id: 'F-L2A', date: DAY2, start: '15:40', end: '15:50', afterSeriesId: null },
  { id: 'F-L2B', date: DAY2, start: '15:50', end: '16:00', afterSeriesId: null },
  { id: 'showcase-final-3', date: DAY2, start: '16:00', end: '16:15', afterSeriesId: null },
  // 半决赛：**胜者组先行、败者组随后**（赛程手册 16:15~16:35）
  { id: 'F-WSF', date: DAY2, start: '16:15', end: '16:25', afterSeriesId: null },
  { id: 'F-LSF', date: DAY2, start: '16:25', end: '16:35', afterSeriesId: null },
  // BO3 时间块：16:35–17:35，两组各占 30 分钟（上限 3 局 × 10 分钟）
  { id: 'F-QUAL', date: DAY2, start: '16:35', end: '17:05', afterSeriesId: null },
  { id: 'F-GF', date: DAY2, start: '17:05', end: '17:35', afterSeriesId: 'F-QUAL' },
  // 表演赛：15 分钟 BO2，排在总决赛计划时段之后
  { id: 'exhibition', date: DAY2, start: '17:35', end: '17:50', afterSeriesId: 'F-GF' },
];

/* ------------------------------------------------------------------ *
 * ID 约定（稳定，绝不根据数组下标或队名重新生成）
 * ------------------------------------------------------------------ */

export function qualificationRunId(round: 1 | 2, rank: number): string {
  return `qual-r${round}-rank${String(rank).padStart(2, '0')}`;
}

export function qualificationScheduleId(round: 1 | 2, rank: number): string {
  return `sched-qual-r${round}-rank${String(rank).padStart(2, '0')}`;
}

/** 瑞士轮时间槽：sched-swiss-r{轮}-{战绩组}-{组内序号}。 */
export function swissScheduleId(roundIndex: number, groupRecord: string, orderInGroup: number): string {
  return `sched-swiss-r${roundIndex}-${groupRecord.replace('-', '')}-${orderInGroup}`;
}

/** 瑞士轮比赛：swiss-r{轮}-{战绩组}-{组内序号}。 */
export function swissMatchId(roundIndex: number, groupRecord: string, orderInGroup: number): string {
  return `swiss-r${roundIndex}-${groupRecord.replace('-', '')}-${orderInGroup}`;
}

export function swissRoundId(index: number): string {
  return `swiss-round-${index}`;
}

export function finalsScheduleId(seriesId: string): string {
  return `sched-${seriesId}`;
}

export function seriesGameId(seriesId: string, index: number): string {
  return `${seriesId}-g${index}`;
}

/* ------------------------------------------------------------------ *
 * 空结果工厂
 * ------------------------------------------------------------------ */

/**
 * 一个空的 BO3/BO2/BO1 系列赛。
 * 未发生的局仍然建好占位，resultStatus 一律为 none，绝不计入“已完成”。
 */
export function buildEmptySeries(
  id: string,
  format: 'BO1' | 'BO2' | 'BO3',
  stage: 'finals' | 'showcase',
  countsForStandings: boolean,
  slots: [SlotRef, SlotRef] | null,
  scheduleItemId: string,
  showcaseTeamId: string | null,
): Series {
  const gameCount = format === 'BO1' ? 1 : format === 'BO2' ? 2 : 3;
  return {
    id,
    format,
    stage,
    countsForStandings,
    slots,
    participantSnapshot: null,
    games: Array.from({ length: gameCount }, (_, i) => ({
      id: seriesGameId(id, i + 1),
      index: i + 1,
      homeTeamId: null,
      awayTeamId: null,
      homeScore: null,
      awayScore: null,
      homeReachedSeconds: null,
      awayReachedSeconds: null,
      winnerId: null,
      resultKind: 'normal' as const,
      resultStatus: 'none' as const,
      confirmedAt: null,
      note: null,
    })),
    executionStatus: 'scheduled',
    scheduleItemId,
    showcaseTeamId,
    note: null,
  };
}

/** 一个空的对阵（无 attempts）。 */
export function buildEmptyMatch(
  id: string,
  roundId: string,
  roundIndex: number,
  groupRecord: string,
  orderInGroup: number,
  scheduleItemId: string,
): SwissMatch {
  return {
    id,
    roundId,
    roundIndex,
    groupRecord,
    orderInGroup,
    slots: [
      { kind: 'team', teamId: '' },
      { kind: 'team', teamId: '' },
    ],
    participantSnapshot: null,
    attempts: [],
    effectiveAttemptId: null,
    executionStatus: 'scheduled',
    scheduleItemId,
    note: null,
  };
}

/* ------------------------------------------------------------------ *
 * 汇总：完整种子事件（空赛果）
 * ------------------------------------------------------------------ */

/**
 * 生成初始事件。
 *
 * 关键取舍：
 * - 44 次排位跑图直接绑定真实队伍与场地（三审顺序已知）。
 * - 33 个瑞士轮时间槽先只记录轮次、战绩组、组内序号与时间；对阵引用留空，
 *   待每轮正式公布后再绑定实际比赛与队伍。不预演任何赛果。
 * - 决赛预建第 4.3 节的 18 个节点（14 个竞技系列赛 + 3 个展示演出 + 表演赛），
 *   队伍来源全部使用引用。
 */
export function buildSeedEvent(now: string): EventFile {
  void buildEmptyMatch; // 骨架工厂保留给 operator 使用
  const teams = buildTeams();
  const venues = buildVenues();
  const scheduleItems: EventFile['scheduleItems'] = [];

  /* ---------- 展示组活动（10/3） ---------- */
  scheduleItems.push({
    id: 'sched-showcase-media',
    kind: 'activity',
    stage: 'showcase',
    date: DAY1,
    plannedStart: at(DAY1, '10:50'),
    plannedEnd: at(DAY1, '11:30'),
    afterSeriesId: null,
    venueId: VENUE_MAIN,
    referenceId: null,
    title: '展示资料对接（PPT、视频、动画等）',
    executionStatus: 'scheduled',
    adjustmentNote: null,
    revisedStart: null,
  });

  SHOWCASE_ROSTER.forEach((entry, index) => {
    scheduleItems.push({
      id: `sched-showcase-preview-${entry.number}`,
      kind: 'activity',
      stage: 'showcase',
      date: DAY1,
      plannedStart: at(DAY1, '11:30', index * 15),
      plannedEnd: at(DAY1, '11:30', (index + 1) * 15),
      afterSeriesId: null,
      venueId: VENUE_MAIN,
      referenceId: showcaseTeamId(entry.number),
      title: `展示组预演 · ${entry.name}`,
      executionStatus: 'scheduled',
      adjustmentNote: null,
      revisedStart: null,
    });
  });

  scheduleItems.push({
    id: 'sched-showcase-draw',
    kind: 'activity',
    stage: 'showcase',
    date: DAY1,
    plannedStart: at(DAY1, '12:20'),
    // 原文未给出结束时间。
    plannedEnd: null,
    afterSeriesId: null,
    venueId: VENUE_MAIN,
    referenceId: null,
    title: '展示组抽签（主席台前，决定决赛上台次序）',
    executionStatus: 'scheduled',
    adjustmentNote: null,
    revisedStart: null,
  });

  /* ---------- 排位赛两轮（10/3） ---------- */
  const ranking: { rank: number; number: number; name: string }[] = COMPETITIVE_ROSTER.map((entry, index) => ({
    rank: index + 1,
    number: entry.number,
    name: entry.name,
  }));

  const runs: EventFile['qualification']['runs'] = [];

  (['round1', 'round2'] as const).forEach((which) => {
    const round: 1 | 2 = which === 'round1' ? 1 : 2;
    const startBase = round === 1 ? QUAL_ROUND1_START : QUAL_ROUND2_START;
    for (let b = 0; b < QUAL_BATCH_COUNT; b += 1) {
      for (let slot = 0; slot < 2; slot += 1) {
        const rank = 2 * b + slot + 1;
        const entry = ranking[rank - 1];
        if (!entry) continue;
        // 首轮：奇数名到 A、偶数名到 B；次轮互换。
        const odd = slot === 0;
        const venueId = round === 1 ? (odd ? VENUE_A : VENUE_B) : odd ? VENUE_B : VENUE_A;
        const scheduleId = qualificationScheduleId(round, rank);
        const start = at(DAY1, startBase, b * QUAL_BATCH_MINUTES);
        scheduleItems.push({
          id: scheduleId,
          kind: 'run',
          stage: 'qualification',
          date: DAY1,
          plannedStart: start,
          plannedEnd: at(DAY1, startBase, (b + 1) * QUAL_BATCH_MINUTES),
          afterSeriesId: null,
          venueId,
          referenceId: qualificationRunId(round, rank),
          title: `排位赛第 ${round} 轮 · 三审第 ${rank} 名 ${entry.name}`,
          executionStatus: 'scheduled',
          adjustmentNote: null,
          revisedStart: null,
        });
        runs.push({
          id: qualificationRunId(round, rank),
          teamId: competitiveTeamId(entry.number),
          round,
          scheduleItemId: scheduleId,
          venueId,
          executionStatus: 'scheduled',
          rawResult: null,
          score: null,
          elapsedSeconds: null,
          resultStatus: 'none',
          judgeNote: null,
          confirmedAt: null,
        });
      }
    }
  });

  // 核分（15:20–15:40）：正式公布排名与十六强对阵（赛程手册赛段一）。
  // 15:40–16:00 手册未安排项目（留给检录与准备），不要在这里补成占位活动。
  scheduleItems.push({
    id: 'sched-qual-review',
    kind: 'activity',
    stage: 'qualification',
    date: DAY1,
    plannedStart: at(DAY1, '15:20'),
    plannedEnd: at(DAY1, '15:40'),
    afterSeriesId: null,
    venueId: VENUE_MAIN,
    referenceId: null,
    title: '排位赛核分及准备（公布最终排名与十六强对阵）',
    executionStatus: 'scheduled',
    adjustmentNote: null,
    revisedStart: null,
  });

  /* ---------- 瑞士轮时间槽（33 场） ---------- */
  const rounds: SwissRound[] = [];
  const matches: SwissMatch[] = [];

  /**
   * 每一轮在等什么 —— 用于 pending 槽位的说明。
   * R1 等排位赛名次；之后各轮等上一轮结果确认。
   */
  const waitingReasonOf = (roundIndex: number, groupRecord: string): string => {
    if (roundIndex === 1) return '等待排位赛排名公布';
    const basedOn = roundIndex - 1;
    const groupHint = groupRecord === '0-0' ? '' : `${groupRecord} 组`;
    return `等待第 ${basedOn} 轮结果确认后公布${groupHint}`;
  };

  for (const indexKey of Object.keys(SWISS_SLOT_PLAN)) {
    const index = Number(indexKey);
    const plan = SWISS_SLOT_PLAN[index];
    if (!plan) continue;

    const matchIds: string[] = [];

    for (const groupRecord of plan.groupOrder) {
      const count = plan.counts[groupRecord] ?? 0;
      for (let order = 1; order <= count; order += 1) {
        const scheduleId = swissScheduleId(index, groupRecord, order);
        const matchId = swissMatchId(index, groupRecord, order);
        const waitingReason = waitingReasonOf(index, groupRecord);
        matchIds.push(matchId);

        // 时间：R3 使用显式时间槽表；其余轮次在组顺序内连续排布。
        let date = plan.date;
        let start = plan.start;
        if (index === 3) {
          const slot = R3_SLOT_TIMES.find((s) => s.groupRecord === groupRecord && s.orderInGroup === order);
          if (slot) {
            date = slot.date;
            start = slot.start;
          }
        } else {
          // 计算本轮此前已排的场次数，用于顺延 10 分钟。
          let offset = 0;
          for (const g of plan.groupOrder) {
            if (g === groupRecord) break;
            offset += plan.counts[g] ?? 0;
          }
          offset += order - 1;
          start = at(plan.date, plan.start, offset * 10).slice(11, 16);
        }

        scheduleItems.push({
          id: scheduleId,
          kind: 'match',
          stage: 'swiss',
          date,
          plannedStart: at(date, start),
          plannedEnd: at(date, start, 10),
          afterSeriesId: null,
          venueId: VENUE_MAIN,
          referenceId: matchId,
          title: `瑞士轮 R${index} · ${groupRecord} 组第 ${order} 场`,
          executionStatus: 'scheduled',
          adjustmentNote: null,
          revisedStart: null,
        });

        matches.push({
          id: matchId,
          roundId: swissRoundId(index),
          roundIndex: index,
          groupRecord,
          orderInGroup: order,
          // 轮次尚未公布：对阵位标记为 pending，说明在等什么。
          // 绝不填具体的排位赛名次 —— 那会让 33 个时间槽全部显示成
          // "排位赛第 1 名 vs 第 2 名"，看似真实却完全错误。
          slots: [
            { kind: 'pending', reason: waitingReason },
            { kind: 'pending', reason: waitingReason },
          ],
          participantSnapshot: null,
          attempts: [],
          effectiveAttemptId: null,
          executionStatus: 'scheduled',
          scheduleItemId: scheduleId,
          note: index === 3 ? '第三轮全部 8 场在第二轮结束后一次性公布，于首日晚间完成' : null,
        });
      }
    }

    rounds.push({
      id: swissRoundId(index),
      index,
      matchIds,
      pairingVersion: 0,
      basedOnRound: index - 1,
      basedOnRevision: null,
      publicationStatus: 'draft',
      publishedAt: null,
      closedAt: null,
      rankingSnapshot: null,
      revisionNote: null,
    });
  }

  // 瑞士轮核分节点
  scheduleItems.push({ id: 'sched-swiss-review-2', kind: 'activity', stage: 'swiss', date: DAY1,
    plannedStart: at(DAY1, '17:20'), plannedEnd: at(DAY1, '17:40'), afterSeriesId: null, venueId: VENUE_MAIN,
    referenceId: null, title: '第一轮核分并公布第二轮对阵', executionStatus: 'scheduled', adjustmentNote: null, revisedStart: null });
  scheduleItems.push({
    id: 'sched-swiss-review-3',
    kind: 'activity',
    stage: 'swiss',
    date: DAY1,
    plannedStart: at(DAY1, '19:20'),
    plannedEnd: at(DAY1, '19:40'),
    afterSeriesId: null,
    venueId: VENUE_MAIN,
    referenceId: null,
    title: '核分并一次性公布第三轮全部 8 场对阵',
    executionStatus: 'scheduled',
    adjustmentNote: null,
    revisedStart: null,
  });
  scheduleItems.push({
    id: 'sched-swiss-review-4',
    kind: 'activity',
    stage: 'swiss',
    date: DAY1,
    plannedStart: at(DAY1, '21:00'),
    plannedEnd: at(DAY1, '21:20'),
    afterSeriesId: null,
    venueId: VENUE_MAIN,
    referenceId: null,
    title: '第三轮核分并公布第四轮对阵',
    executionStatus: 'scheduled',
    adjustmentNote: null,
    revisedStart: null,
  });
  scheduleItems.push({
    id: 'sched-swiss-review-5',
    kind: 'activity',
    stage: 'swiss',
    date: DAY2,
    plannedStart: at(DAY2, '10:00'),
    plannedEnd: at(DAY2, '10:20'),
    afterSeriesId: null,
    venueId: VENUE_MAIN,
    referenceId: null,
    title: '第四轮核分并公布第五轮对阵',
    executionStatus: 'scheduled',
    adjustmentNote: null,
    revisedStart: null,
  });
  scheduleItems.push({
    id: 'sched-swiss-final-review',
    kind: 'activity',
    stage: 'swiss',
    date: DAY2,
    plannedStart: at(DAY2, '10:50'),
    plannedEnd: at(DAY2, '11:10'),
    afterSeriesId: null,
    venueId: VENUE_MAIN,
    referenceId: null,
    title: '瑞士轮总核分并公布八强第1至8名及双败首轮对阵',
    executionStatus: 'scheduled',
    adjustmentNote: null,
    revisedStart: null,
  });

  /* ---------- 决赛：14 个竞技系列赛 + 3 个展示演出 + 表演赛 ---------- */
  const series: Series[] = [];
  const seriesSchedule = new Map(FINALS_SCHEDULE.map((s) => [s.id, s]));

  for (const node of FINALS_NODES_LOCAL) {
    const slot = seriesSchedule.get(node.id);
    if (!slot) continue;
    const scheduleId = finalsScheduleId(node.id);
    scheduleItems.push({
      id: scheduleId,
      kind: node.kind,
      stage: node.stage,
      date: slot.date,
      plannedStart: at(slot.date, slot.start),
      plannedEnd: slot.end === null ? null : at(slot.date, slot.end),
      afterSeriesId: slot.afterSeriesId,
      venueId: VENUE_MAIN,
      referenceId: node.id,
      title: node.title,
      executionStatus: 'scheduled',
      adjustmentNote: null,
      revisedStart: null,
    });

    if (node.kind === 'activity') continue;

    series.push(
      buildEmptySeries(
        node.id,
        node.format,
        node.stage,
        node.countsForStandings,
        node.slots,
        scheduleId,
        node.showcaseTeamId,
      ),
    );
  }

  return {
    schemaVersion: 1,
    event: {
      id: EVENT_ID,
      name: 'RoboGame2026 赛事',
      timezone: 'Asia/Shanghai',
      dates: [DAY1, DAY2],
      sourceDocumentSha256: SOURCE_DOC_SHA256,
      officialScheduleUrl: null,
      scheduleNotice: '以下时间仅供参考，具体情况以赛程组共享文档当天安排为准。',
      contentUpdatedAt: now,
      openItems: [
        '赛程组共享文档地址（原文声明以其当天安排为准）',
        '是否公开原始 DOCX',
        '展示组决赛抽签顺序（10 月 3 日 12:20 抽签后录入）',
      ],
    },
    rules: {
      version: RULES_VERSION,
      qualificationRankingMode: 'official-manual',
      // 赛程手册口径：R1 前后两半对位，R2 起组内首尾配对。
      swissPairingPolicy: 'manual-head-to-tail',
    },
    teams,
    venues,
    scheduleItems,
    qualification: {
      runs,
      ranking: {
        orderedTeamIds: [],
        bestResultLabels: null,
        status: 'none',
        confirmedAt: null,
        sourceNote: null,
        publicationStatus: 'draft',
        publishedAt: null,
        missingTeamIds: null,
        partialTeamIds: null,
        tiedTeamIds: null,
        reviewNote: null,
        overrideReason: null,
      },
    },
    swiss: { rounds, matches },
    finals: { seeding: null, series },
    showcase: { drawOrder: null, confirmedAt: null, note: null },
    notices: [
      {
        id: 'notice-times-are-reference',
        at: now,
        title: '时间仅供参考',
        body: '本页时间来自赛前计划表。当天以赛程组共享文档的安排为准，现场调整会在此处公告。',
        severity: 'info',
      },
    ],
    corrections: [],
  };
}

/* ------------------------------------------------------------------ *
 * 决赛节点：复用领域依赖图，仅补充开幕式日程
 * ------------------------------------------------------------------ */

type LocalNode = {
  id: string;
  kind: 'match' | 'activity';
  format: 'BO1' | 'BO2' | 'BO3';
  stage: 'finals' | 'showcase';
  countsForStandings: boolean;
  /** 展示演出与表演赛没有两两对抗，为 null。 */
  slots: [SlotRef, SlotRef] | null;
  title: string;
  showcaseTeamId: string | null;
};

const FINALS_NODES_LOCAL: readonly LocalNode[] = [
  { id: 'opening', kind: 'activity', format: 'BO1', stage: 'finals', countsForStandings: false, slots: null, title: '决赛开幕式', showcaseTeamId: null },
  ...FINALS_NODES.map((node): LocalNode => ({
    id: node.id, kind: 'match', format: node.format, stage: node.stage,
    countsForStandings: node.countsForStandings, slots: node.slots, title: node.label, showcaseTeamId: null,
  })),
];
