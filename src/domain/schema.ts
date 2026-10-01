/**
 * 数据契约：严格 schema（docs/IMPLEMENTATION_PLAN.md 第 9 节）。
 *
 * 约定：
 * - 所有对象 .strict()，拒绝未知字段，避免拼写错误被静默吞掉。
 * - `schemaVersion` 用于数据结构迁移；`rules.version` 用于赛制变化。两者不同。
 * - 计划时间一律带偏移的 ISO 8601（例如 2026-10-03T09:00:00+08:00）。
 * - 无真实赛果时结果为空数组或 null，绝不用演示比分冒充事实。
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * 基础标量
 * ------------------------------------------------------------------ */

/** 带时区偏移的 ISO 8601 时刻。不接受裸日期或缺少偏移的本地时间。 */
export const isoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/,
    '必须是带时区偏移的 ISO 8601 时刻，例如 2026-10-03T09:00:00+08:00',
  );

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '必须是 YYYY-MM-DD 日期');

/**
 * 规范化非负十进制字符串，保留实际精度。
 * 拒绝负数、非数字、指数记号、Infinity/NaN。
 * 注意：原始积分没有 16 分上限——16 只在 A 的每场贡献里封顶。
 */
export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^(?:\d+(?:\.\d*)?|\.\d+)$/, '必须是非负十进制数值字符串');

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, '必须是 64 位小写十六进制 SHA256');

/* ------------------------------------------------------------------ *
 * 枚举
 * ------------------------------------------------------------------ */

export const divisionSchema = z.enum(['competitive', 'showcase']);

/** 现场进程。注意这里的值不代表任何自动推断——只能由维护者显式设置。 */
export const executionStatusSchema = z.enum([
  'scheduled',
  'ready',
  'running',
  'finished',
  'delayed',
  'cancelled',
  'not-needed',
]);

/** 结果的三态。provisional 可以展示，但不能参与正式配对或晋级。 */
export const resultStatusSchema = z.enum(['none', 'provisional', 'confirmed']);

/** 轮次或种子的公布状态。 */
export const publicationStatusSchema = z.enum(['draft', 'published', 'superseded']);

/**
 * 结果类型。是否计入 A/B/P/T 由类型推导，避免手工勾选组合产生互相矛盾的结果。
 * - normal               有效正常比赛
 * - early-end            按规则提前结束的有效比赛
 * - walkover-before-start 未开赛弃权
 * - administrative-stop  行政判负中止
 */
export const resultKindSchema = z.enum([
  'normal',
  'early-end',
  'walkover-before-start',
  'administrative-stop',
]);

export const stageSchema = z.enum(['qualification', 'swiss', 'finals', 'showcase']);

export const swissGroupRecordSchema = z
  .string()
  .regex(/^\d+-\d+$/, '战绩组必须形如 2-0');

export const finalsSeedSchema = z.enum(['W1', 'W2', 'W3', 'W4', 'L1', 'L2', 'L3', 'L4']);

/* ------------------------------------------------------------------ *
 * 队伍与场地
 * ------------------------------------------------------------------ */

export const teamSchema = z
  .object({
    id: z.string().regex(/^(competitive|showcase)-\d+$/, '队伍 ID 必须带组别前缀，例如 competitive-18'),
    division: divisionSchema,
    /** 队伍编号。竞技组与展示组编号会重复，因此必须配合 division 使用。 */
    number: z.number().int().nonnegative(),
    name: z.string().min(1),
    /** 是否已逐项对照官方名单图片核对过。未核对时 UI 要显式标注。 */
    nameVerified: z.boolean(),
    /** 待核对说明，例如“首字核对”。已核对时为 null。 */
    nameNote: z.string().min(1).nullable(),
    /** 三审排名 1–22，仅竞技组有。与排位赛名次、队伍编号是三个不同字段。 */
    thirdReviewRank: z.number().int().min(1).max(22).nullable(),
  })
  .strict()
  .refine((t) => (t.division === 'competitive' ? t.thirdReviewRank !== null : t.thirdReviewRank === null), {
    message: '竞技组必须有 thirdReviewRank，展示组必须为 null',
    path: ['thirdReviewRank'],
  })
  .refine((t) => (t.nameVerified ? t.nameNote === null : true), {
    message: '已核对的队伍不应保留 nameNote',
    path: ['nameNote'],
  });

export const venueSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /**
     * 名称是否仍可能变动。
     * 为 true 时界面标注「暂定名称」，校验输出提示（非错误）。
     * 用于"沿用当前命名但组委会可能给出正式名称"的情形。
     */
    provisionalName: z.boolean(),
    note: z.string().nullable().default(null),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 对阵引用（第 9.3 节）
 * ------------------------------------------------------------------ */

export const slotRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('team'), teamId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('qualification-rank'), rank: z.number().int().min(1).max(22) }).strict(),
  z.object({ kind: z.literal('finals-seed'), seed: finalsSeedSchema }).strict(),
  z.object({ kind: z.literal('winner'), seriesId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('loser'), seriesId: z.string().min(1) }).strict(),
]);

/* ------------------------------------------------------------------ *
 * 日程
 * ------------------------------------------------------------------ */

export const scheduleItemKindSchema = z.enum([
  'match', // 一场可录入结果的对阵/系列赛
  'run', // 排位赛单队跑图
  'activity', // 核分、抽签、开幕式、资料对接、表演赛等活动
]);

export const scheduleItemSchema = z
  .object({
    id: z.string().min(1),
    kind: scheduleItemKindSchema,
    stage: stageSchema,
    date: isoDateSchema,
    plannedStart: isoDateTimeSchema,
    /** 结束时间未知时为 null，绝不编造占位时刻。 */
    plannedEnd: isoDateTimeSchema.nullable(),
    /** 依赖时间：本项在某系列赛结束后开始（用于 BO3 之后的项目）。 */
    afterSeriesId: z.string().min(1).nullable().default(null),
    venueId: z.string().min(1).nullable().default(null),
    /** 指向 qualificationRun / swissMatch / series 的 ID。 */
    referenceId: z.string().min(1).nullable().default(null),
    title: z.string().min(1),
    executionStatus: executionStatusSchema,
    /** 日程调整说明（计划时间与实际不符时填写）。 */
    adjustmentNote: z.string().nullable().default(null),
    /** 修订后的计划时间（与原始 plannedStart 分开保存，不破坏结果身份）。 */
    revisedStart: isoDateTimeSchema.nullable().default(null),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 排位赛
 * ------------------------------------------------------------------ */

export const qualificationRunSchema = z
  .object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    /** 1 或 2。上午、下午各一轮。 */
    round: z.union([z.literal(1), z.literal(2)]),
    scheduleItemId: z.string().min(1),
    venueId: z.string().min(1),
    executionStatus: executionStatusSchema,
    /** 原始结果文字（规则未规定结构，因此允许自由文本）。 */
    rawResult: z.string().nullable().default(null),
    /** 可选积分；不参与自动确定排位名次。 */
    score: decimalStringSchema.nullable().default(null),
    /** 可选用时（秒）。 */
    elapsedSeconds: decimalStringSchema.nullable().default(null),
    resultStatus: resultStatusSchema,
    /** 裁判备注。 */
    judgeNote: z.string().nullable().default(null),
    confirmedAt: isoDateTimeSchema.nullable().default(null),
  })
  .strict();

export const qualificationRankingSchema = z
  .object({
    /** 裁判确认的 1–22 名完整排序。 */
    orderedTeamIds: z.array(z.string().min(1)),
    /** 每队的“正式最优成绩”展示文字，与 orderedTeamIds 等长。 */
    bestResultLabels: z.array(z.string()).nullable().default(null),
    status: resultStatusSchema,
    confirmedAt: isoDateTimeSchema.nullable().default(null),
    /** 来源说明，例如“裁判组核分表”。 */
    sourceNote: z.string().nullable().default(null),
    publicationStatus: publicationStatusSchema,
    publishedAt: isoDateTimeSchema.nullable().default(null),
  })
  .strict();

export const qualificationSchema = z
  .object({
    runs: z.array(qualificationRunSchema),
    ranking: qualificationRankingSchema,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 瑞士轮
 * ------------------------------------------------------------------ */

export const resultAttemptSchema = z
  .object({
    id: z.string().min(1),
    /** 重赛时指向被本 attempt 取代的上一次尝试。 */
    supersedesId: z.string().min(1).nullable().default(null),
    homeTeamId: z.string().min(1),
    awayTeamId: z.string().min(1),
    /** 原始积分，不封顶（16 只在公式的 A 贡献里封顶）。 */
    homeScore: decimalStringSchema.nullable().default(null),
    awayScore: decimalStringSchema.nullable().default(null),
    /** 开赛后首次达到本局最终有效积分的时间（秒）。零分有效局记 360。 */
    homeReachedSeconds: decimalStringSchema.nullable().default(null),
    awayReachedSeconds: decimalStringSchema.nullable().default(null),
    /** 胜者由裁判确认，不自动从积分高低推断；未确认时为 null。 */
    winnerId: z.string().min(1).nullable().default(null),
    resultKind: resultKindSchema,
    resultStatus: resultStatusSchema,
    confirmedAt: isoDateTimeSchema.nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict()
  .refine((a) => a.homeTeamId !== a.awayTeamId, { message: '不能自己对自己', path: ['awayTeamId'] })
  .refine((a) => (a.winnerId === null ? true : a.winnerId === a.homeTeamId || a.winnerId === a.awayTeamId), {
    message: '胜者必须是参赛双方之一',
    path: ['winnerId'],
  })
  .refine((a) => (a.resultStatus === 'confirmed' ? a.winnerId !== null : true), {
    message: '已确认的结果必须有明确胜者（瑞士轮不允许平局）',
    path: ['winnerId'],
  });

export const swissMatchSchema = z
  .object({
    id: z.string().min(1),
    roundId: z.string().min(1),
    roundIndex: z.number().int().min(1).max(5),
    /** 该场所属战绩组，例如 "2-0"。 */
    groupRecord: swissGroupRecordSchema,
    /** 组内序号，从 1 开始。 */
    orderInGroup: z.number().int().min(1),
    /** 参赛双方来源。未公布时保留引用；公布或开赛后保存实际快照。 */
    slots: z.tuple([slotRefSchema, slotRefSchema]),
    /** 公布或开赛时冻结的实际参赛队伍。 */
    participantSnapshot: z.tuple([z.string().min(1), z.string().min(1)]).nullable().default(null),
    attempts: z.array(resultAttemptSchema),
    /** 计入统计的那一次尝试。 */
    effectiveAttemptId: z.string().min(1).nullable().default(null),
    executionStatus: executionStatusSchema,
    scheduleItemId: z.string().min(1),
    note: z.string().nullable().default(null),
  })
  .strict();

/** 某一轮公布时的评分快照：用于把“当前参考排名”和“已用于正式配对的排名”分开。 */
export const rankingSnapshotEntrySchema = z
  .object({
    teamId: z.string().min(1),
    record: swissGroupRecordSchema,
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    /** 原始精度序列化后的值，避免浮点回读损失。 */
    r: z.object({ n: z.string(), d: z.string() }).strict(),
    p: z.object({ n: z.string(), d: z.string() }).strict(),
    t: z.object({ n: z.string(), d: z.string() }).strict(),
    rankWithinGroup: z.number().int().min(1),
  })
  .strict();

export const swissRoundSchema = z
  .object({
    id: z.string().min(1),
    index: z.number().int().min(1).max(5),
    matchIds: z.array(z.string().min(1)),
    /** 配对版本，每次重新配对递增。 */
    pairingVersion: z.number().int().min(0),
    /** 本轮配对所依据的已完成轮次。 */
    basedOnRound: z.number().int().min(0).max(5),
    /** 本轮配对所依据的输入内容哈希。 */
    basedOnRevision: z.string().min(1).nullable().default(null),
    publicationStatus: publicationStatusSchema,
    publishedAt: isoDateTimeSchema.nullable().default(null),
    /** 本轮全部结果确认的时间。 */
    closedAt: isoDateTimeSchema.nullable().default(null),
    /** 配对所依据的评分快照。 */
    rankingSnapshot: z.array(rankingSnapshotEntrySchema).nullable().default(null),
    /** 组委会修订说明。 */
    revisionNote: z.string().nullable().default(null),
  })
  .strict();

/**
 * 瑞士轮容器。
 *
 * `matches` 是比赛事实的唯一存放处，`rounds[].matchIds` 只是引用与排序。
 * 这样比赛对象有明确归属，校验与配对都能直接索引，不必依赖隐式约定。
 */
export const swissSchema = z
  .object({
    rounds: z.array(swissRoundSchema),
    matches: z.array(swissMatchSchema),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 决赛
 * ------------------------------------------------------------------ */

export const finalsSeedingSchema = z
  .object({
    seeds: z.record(finalsSeedSchema, z.string().min(1)),
    /** 最终排名依据说明。 */
    basisNote: z.string().nullable().default(null),
    version: z.number().int().min(1),
    publicationStatus: publicationStatusSchema,
    publishedAt: isoDateTimeSchema.nullable().default(null),
  })
  .strict();

export const bo3GameSchema = z
  .object({
    id: z.string().min(1),
    index: z.number().int().min(1).max(3),
    homeTeamId: z.string().min(1).nullable().default(null),
    awayTeamId: z.string().min(1).nullable().default(null),
    homeScore: decimalStringSchema.nullable().default(null),
    awayScore: decimalStringSchema.nullable().default(null),
    winnerId: z.string().min(1).nullable().default(null),
    resultKind: resultKindSchema,
    resultStatus: resultStatusSchema,
    confirmedAt: isoDateTimeSchema.nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict();

export const seriesSchema = z
  .object({
    id: z.string().min(1),
    format: z.enum(['BO1', 'BO2', 'BO3']),
    stage: stageSchema,
    /** 是否计入正式排名（表演赛与展示演出为 false）。 */
    countsForStandings: z.boolean(),
    /**
     * 展示演出与表演赛不是两两对抗，没有“对阵双方”，因此 slots 可以为 null。
     * 计入正式排名的竞技组系列赛必须有 slots（由下方 refine 强制）。
     */
    slots: z.tuple([slotRefSchema, slotRefSchema]).nullable(),
    participantSnapshot: z.tuple([z.string().min(1), z.string().min(1)]).nullable().default(null),
    /** BO1/BO2 的结果直接记在 games[0]；BO3 逐局记录。 */
    games: z.array(bo3GameSchema),
    executionStatus: executionStatusSchema,
    scheduleItemId: z.string().min(1),
    /** 展示组演出对应的队伍（竞技组为 null）。 */
    showcaseTeamId: z.string().min(1).nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict()
  .refine((s) => (s.countsForStandings ? s.slots !== null : true), {
    message: '计入正式排名的系列赛必须有对阵双方',
    path: ['slots'],
  });

export const finalsSchema = z
  .object({
    seeding: finalsSeedingSchema.nullable().default(null),
    series: z.array(seriesSchema),
  })
  .strict();

export const showcaseSchema = z
  .object({
    /** 抽签决定的正式演出顺序。未抽签时为 null，绝不沿用编号顺序。 */
    drawOrder: z.array(z.string().min(1)).nullable().default(null),
    confirmedAt: isoDateTimeSchema.nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 公告与更正
 * ------------------------------------------------------------------ */

export const noticeSchema = z
  .object({
    id: z.string().min(1),
    at: isoDateTimeSchema,
    title: z.string().min(1),
    body: z.string().min(1),
    severity: z.enum(['info', 'warning', 'critical']),
  })
  .strict();

/** 更正处置方式（第 6.3 节）。 */
export const correctionDispositionSchema = z.enum([
  'pending', // 尚未处置——阻止导出正式版本
  'downstream-not-published', // 下游尚未发布：重算并重建候选
  'keep-published-with-note', // 保留已公布对阵并说明
  'republish', // 作废旧版本并重新公布
  'committee-revision-recorded', // 已开赛：记录组委会修订后恢复推进
]);

export const correctionSchema = z
  .object({
    id: z.string().min(1),
    reason: z.string().min(1),
    at: isoDateTimeSchema,
    /** 旧值与新值的简要描述。 */
    previousValue: z.string().nullable().default(null),
    newValue: z.string().nullable().default(null),
    /** 受影响的比赛 / 轮次 / 种子 ID。 */
    affectedIds: z.array(z.string().min(1)),
    disposition: correctionDispositionSchema,
    /** 是否允许继续自动推进。 */
    allowsProgress: z.boolean(),
    note: z.string().nullable().default(null),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 顶层
 * ------------------------------------------------------------------ */

export const SCHEMA_VERSION = 1;

export const eventMetaSchema = z
  .object({
    id: z.literal('robogame-2026'),
    name: z.string().min(1),
    timezone: z.literal('Asia/Shanghai'),
    dates: z.array(isoDateSchema).min(1),
    /** 原始文档哈希，用于在文档变化时提醒比对规则。 */
    sourceDocumentSha256: sha256Schema,
    /** 赛程组共享文档地址；尚未提供时为 null。 */
    officialScheduleUrl: z.string().url().nullable().default(null),
    /** 原文权威性声明。 */
    scheduleNotice: z.string().min(1),
    contentUpdatedAt: isoDateTimeSchema,
    /** 尚未补齐的资料清单，显式记录，避免被当成已确认。 */
    openItems: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const rulesMetaSchema = z
  .object({
    version: z.string().min(1),
    qualificationRankingMode: z.literal('official-manual'),
    swissPairingPolicy: z.literal('same-record-adjacent'),
  })
  .strict();

export const eventFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    event: eventMetaSchema,
    rules: rulesMetaSchema,
    teams: z.array(teamSchema),
    venues: z.array(venueSchema),
    scheduleItems: z.array(scheduleItemSchema),
    qualification: qualificationSchema,
    swiss: swissSchema,
    finals: finalsSchema,
    showcase: showcaseSchema,
    notices: z.array(noticeSchema),
    corrections: z.array(correctionSchema),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 公开快照（第 10.4 节）
 * ------------------------------------------------------------------ */

export const publicSnapshotSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** 输入内容哈希。同一数据版本绝不允许出现互相冲突的内容。 */
    revision: z.string().min(8),
    builtAt: isoDateTimeSchema,
    sourceCommit: z.string().nullable().default(null),
    /**
     * 事件结构本身。
     * 这里保留 schemaVersion 字段（与顶层一致），使公开快照可以直接当作
     * EventFile 使用，避免每个消费方都要手工补一个字段。
     */
    data: eventFileSchema,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 变更包（第 10.2 节）
 * ------------------------------------------------------------------ */

export const changePackageSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** 打开维护工具时的正式源版本。 */
    baseRevision: z.string().min(1),
    exportedAt: isoDateTimeSchema,
    /** 完整赛事版本，避免局部补丁丢失跨对象依赖。 */
    event: eventFileSchema,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 推导类型
 * ------------------------------------------------------------------ */

export type Division = z.infer<typeof divisionSchema>;
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type ResultStatus = z.infer<typeof resultStatusSchema>;
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;
export type ResultKind = z.infer<typeof resultKindSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type FinalsSeed = z.infer<typeof finalsSeedSchema>;
export type SlotRef = z.infer<typeof slotRefSchema>;
export type Team = z.infer<typeof teamSchema>;
export type Venue = z.infer<typeof venueSchema>;
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
export type QualificationRun = z.infer<typeof qualificationRunSchema>;
export type QualificationRanking = z.infer<typeof qualificationRankingSchema>;
export type Qualification = z.infer<typeof qualificationSchema>;
export type ResultAttempt = z.infer<typeof resultAttemptSchema>;
export type SwissMatch = z.infer<typeof swissMatchSchema>;
export type SwissRound = z.infer<typeof swissRoundSchema>;
export type Swiss = z.infer<typeof swissSchema>;
export type RankingSnapshotEntry = z.infer<typeof rankingSnapshotEntrySchema>;
export type FinalsSeeding = z.infer<typeof finalsSeedingSchema>;
export type Bo3Game = z.infer<typeof bo3GameSchema>;
export type Series = z.infer<typeof seriesSchema>;
export type Finals = z.infer<typeof finalsSchema>;
export type Showcase = z.infer<typeof showcaseSchema>;
export type Notice = z.infer<typeof noticeSchema>;
export type Correction = z.infer<typeof correctionSchema>;
export type CorrectionDisposition = z.infer<typeof correctionDispositionSchema>;
export type EventFile = z.infer<typeof eventFileSchema>;
export type EventMeta = z.infer<typeof eventMetaSchema>;
export type RulesMeta = z.infer<typeof rulesMetaSchema>;
export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>;
export type ChangePackage = z.infer<typeof changePackageSchema>;
