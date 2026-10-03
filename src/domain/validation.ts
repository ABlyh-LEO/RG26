/**
 * 数据与业务校验（docs/IMPLEMENTATION_PLAN.md 第 5、6、9 节）。
 *
 * 输出结构化错误：每条都带对象类型、对象 ID、字段与可读信息，
 * 便于维护工具定位，而不是笼统地“数据无效”。
 */
import type { EventFile, SwissMatch } from './schema';
import { EXPECTED_MATCH_COUNTS, ROUND_GROUP_ORDER } from './swiss';
import { assessQualificationCompleteness } from './qualification-completeness';
import { computeQualificationRanking } from './qualification-ranking';
import { FINALS_NODES, validateFinalsGraph } from './finals';
import { toApproxNumber } from './rational';

export interface ValidationIssue {
  /** error 阻止发布；warning 只提示。 */
  severity: 'error' | 'warning';
  /** 对象类型，例如 'team'、'swiss-match'。 */
  objectType: string;
  /** 对象 ID；全局问题时为 null。 */
  objectId: string | null;
  /** 字段路径；不适用时为 null。 */
  field: string | null;
  code: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  ok: boolean;
}

function err(
  objectType: string,
  objectId: string | null,
  field: string | null,
  code: string,
  message: string,
): ValidationIssue {
  return { severity: 'error', objectType, objectId, field, code, message };
}

function warn(
  objectType: string,
  objectId: string | null,
  field: string | null,
  code: string,
  message: string,
): ValidationIssue {
  return { severity: 'warning', objectType, objectId, field, code, message };
}

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

/**
 * 全量校验。这是唯一允许被导入器、构建脚本和维护工具共同调用的入口。
 */
export function validateEvent(event: EventFile): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const teamIds = new Set(event.teams.map((t) => t.id));
  const venueIds = new Set(event.venues.map((v) => v.id));
  const scheduleIds = new Set(event.scheduleItems.map((s) => s.id));

  /* ---------- 队伍 ---------- */
  for (const id of findDuplicates(event.teams.map((t) => t.id))) {
    errors.push(err('team', id, 'id', 'duplicate-id', `队伍 ID 重复：${id}`));
  }

  const competitive = event.teams.filter((t) => t.division === 'competitive');
  const showcase = event.teams.filter((t) => t.division === 'showcase');

  if (competitive.length !== 22) {
    errors.push(
      err('event', null, 'teams', 'competitive-count', `竞技组应有 22 支队伍，实际 ${competitive.length} 支`),
    );
  }
  if (showcase.length !== 3) {
    errors.push(err('event', null, 'teams', 'showcase-count', `展示组应有 3 支队伍，实际 ${showcase.length} 支`));
  }

  for (const id of findDuplicates(competitive.map((t) => String(t.thirdReviewRank)))) {
    errors.push(err('team', null, 'thirdReviewRank', 'duplicate-review-rank', `三审排名重复：${id}`));
  }
  for (const id of findDuplicates(competitive.map((t) => String(t.number)))) {
    warnings.push(warn('team', null, 'number', 'duplicate-team-number', `竞技组队伍编号重复：${id}`));
  }

  const reviewRanks = competitive
    .map((t) => t.thirdReviewRank)
    .filter((r): r is number => r !== null)
    .sort((a, b) => a - b);
  reviewRanks.forEach((rank, index) => {
    if (rank !== index + 1) {
      errors.push(
        err('event', null, 'teams', 'review-rank-gap', `三审排名必须连续覆盖 1–22，第 ${rank} 名处出现缺口`),
      );
    }
  });

  for (const team of event.teams) {
    if (!team.nameVerified) {
      warnings.push(
        warn('team', team.id, 'nameVerified', 'name-unverified', `队名尚未逐项核对：${team.name}（${team.nameNote ?? '无说明'}）`),
      );
    }
  }

  /* ---------- 场地 ---------- */
  for (const id of findDuplicates(event.venues.map((v) => v.id))) {
    errors.push(err('venue', id, 'id', 'duplicate-id', `场地 ID 重复：${id}`));
  }
  for (const venue of event.venues) {
    if (venue.provisionalName) {
      warnings.push(
        warn(
          'venue',
          venue.id,
          'provisionalName',
          'provisional-venue',
          `场地名称沿用当前命名：${venue.label}（若组委会给出正式名称需更新）`,
        ),
      );
    }
  }

  /* ---------- 日程 ---------- */
  for (const id of findDuplicates(event.scheduleItems.map((s) => s.id))) {
    errors.push(err('schedule-item', id, 'id', 'duplicate-id', `日程项 ID 重复：${id}`));
  }
  for (const item of event.scheduleItems) {
    if (item.venueId !== null && !venueIds.has(item.venueId)) {
      errors.push(err('schedule-item', item.id, 'venueId', 'unknown-venue', `引用了不存在的场地：${item.venueId}`));
    }
    if (item.plannedEnd !== null && Date.parse(item.plannedEnd) < Date.parse(item.plannedStart)) {
      errors.push(err('schedule-item', item.id, 'plannedEnd', 'end-before-start', '结束时间早于开始时间'));
    }
    if (!event.event.dates.includes(item.date)) {
      errors.push(
        err('schedule-item', item.id, 'date', 'date-outside-event', `日期 ${item.date} 不在赛事日期 ${event.event.dates.join('、')} 内`),
      );
    }
    /*
     * 前序依赖必须真实存在，而且不能排在它前面。
     *
     * BO3 与表演赛的时间块起点相同（手册只给了「16:35 起」），如果只照抄
     * 时间块起点，就会出现三场"同时开始"——曾经的实际缺陷。这里的规则保证
     * 这类数据要么给出错开的固定时间，要么被挡在发布之前。
     */
    if (item.afterSeriesId !== null) {
      const series = event.finals.series.find((s) => s.id === item.afterSeriesId);
      const sourceItem = event.scheduleItems.find((candidate) => candidate.referenceId === item.afterSeriesId);
      if (!series) {
        errors.push(
          err('schedule-item', item.id, 'afterSeriesId', 'unknown-after-series', `前序依赖指向不存在的系列赛：${item.afterSeriesId}`),
        );
      } else if (!sourceItem) {
        errors.push(
          err('schedule-item', item.id, 'afterSeriesId', 'missing-after-schedule', `${item.afterSeriesId} 没有对应的日程项，无法判断先后顺序`),
        );
      } else {
        /*
         * 前序安排结束时间已知时，本项**不得早于**它结束（背靠背可以相等）；
         * 结束时间未知时（手册对 BO3 只给了时间块起点），本项必须**严格晚于**
         * 前一项开始——否则就会出现"名额争夺战与总决赛同时开始"这种重合。
         */
        const boundary = sourceItem.plannedEnd ?? sourceItem.plannedStart;
        const startsEarly = sourceItem.plannedEnd !== null
          ? Date.parse(item.plannedStart) < Date.parse(boundary)
          : Date.parse(item.plannedStart) <= Date.parse(boundary);
        if (startsEarly) {
          errors.push(
            err(
              'schedule-item',
              item.id,
              'plannedStart',
              'sequence-overlap',
              `开始时间不晚于前序安排《${sourceItem.title}》的${sourceItem.plannedEnd ? '结束' : '开始'}时间（${boundary.slice(11, 16)}）：` +
                '前序安排结束时间未知时必须给出更晚的固定时间，不能照抄同一时间块起点',
            ),
          );
        }
      }
    }
  }

  /*
   * 同一场地同一时间只能有一项安排。
   *
   * 两场比赛不可能同时占用主舞台；这正是"最后两场比赛时间重合"要防的问题。
   * 只比较**同一天、同一场地、结束时间已知**的项目（跨场地并行的排位赛跑图
   * 因此不会被误报；结束时间未定的项目另行由前序依赖规则约束）。
   */
  const byVenue = new Map<string, { id: string; title: string; start: number; end: number }[]>();
  for (const item of event.scheduleItems) {
    if (item.venueId === null || item.plannedEnd === null) continue;
    const key = `${item.date}|${item.venueId}`;
    const list = byVenue.get(key) ?? [];
    list.push({
      id: item.id,
      title: item.title,
      start: Date.parse(item.revisedStart ?? item.plannedStart),
      end: Date.parse(item.plannedEnd),
    });
    byVenue.set(key, list);
  }
  for (const list of byVenue.values()) {
    const ordered = [...list].sort((a, b) => a.start - b.start);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      if (current.start < previous.end) {
        errors.push(
          err(
            'schedule-item',
            current.id,
            'plannedStart',
            'venue-time-overlap',
            `与《${previous.title}》在同一场地的安排重叠（${previous.id} 到 ${new Date(previous.end).toISOString().slice(11, 16)}）`,
          ),
        );
      }
    }
  }

  // 同一场地、同一时间开始且**都没有结束时间**的项目同样是冲突：一个舞台不可能
  // 同时开始两件事（结束时间未知时，前一条规则无法发现这种重合）。
  const openEnded = new Map<string, { id: string; title: string; start: number }>();
  for (const item of event.scheduleItems) {
    if (item.venueId === null || item.plannedEnd !== null) continue;
    const key = `${item.date}|${item.venueId}|${Date.parse(item.revisedStart ?? item.plannedStart)}`;
    const existing = openEnded.get(key);
    if (existing) {
      errors.push(
        err(
          'schedule-item',
          item.id,
          'plannedStart',
          'venue-time-collision',
          `与《${existing.title}》在同一场地、同一时间开始，且两者都没有结束时间`,
        ),
      );
    } else {
      openEnded.set(key, { id: item.id, title: item.title, start: Date.parse(item.revisedStart ?? item.plannedStart) });
    }
  }

  /* ---------- 排位赛 ---------- */
  const runIds = event.qualification.runs.map((r) => r.id);
  for (const id of findDuplicates(runIds)) {
    errors.push(err('qualification-run', id, 'id', 'duplicate-id', `排位赛跑图 ID 重复：${id}`));
  }
  if (event.qualification.runs.length !== 0 && event.qualification.runs.length !== 44) {
    warnings.push(
      warn(
        'qualification',
        null,
        'runs',
        'unexpected-run-count',
        `排位赛跑图应为 44 次，实际 ${event.qualification.runs.length} 次`,
      ),
    );
  }
  for (const run of event.qualification.runs) {
    if (!teamIds.has(run.teamId)) {
      errors.push(err('qualification-run', run.id, 'teamId', 'unknown-team', `引用了不存在的队伍：${run.teamId}`));
    }
    if (!scheduleIds.has(run.scheduleItemId)) {
      errors.push(
        err('qualification-run', run.id, 'scheduleItemId', 'unknown-schedule-item', `引用了不存在的日程项：${run.scheduleItemId}`),
      );
    }
    if (run.resultStatus === 'confirmed' && run.score === null && run.rawResult === null) {
      warnings.push(warn('qualification-run', run.id, 'score', 'confirmed-without-result', '已确认但没有记录任何成绩'));
    }
  }

  const ranking = event.qualification.ranking;
  if (ranking.status === 'confirmed') {
    const ordered = ranking.orderedTeamIds;
    if (ordered.length !== competitive.length) {
      errors.push(
        err(
          'qualification-ranking',
          null,
          'orderedTeamIds',
          'ranking-incomplete',
          `已确认的排位赛排名必须包含全部 ${competitive.length} 支竞技组队伍，实际 ${ordered.length} 支`,
        ),
      );
    }
    for (const id of findDuplicates(ordered)) {
      errors.push(err('qualification-ranking', id, 'orderedTeamIds', 'duplicate-team', `排位赛排名中队伍重复出现：${id}`));
    }
    for (const teamId of ordered) {
      if (!teamIds.has(teamId)) {
        errors.push(
          err('qualification-ranking', teamId, 'orderedTeamIds', 'unknown-team', `排名中出现不存在的队伍：${teamId}`),
        );
      } else if (!competitive.some((t) => t.id === teamId)) {
        errors.push(
          err('qualification-ranking', teamId, 'orderedTeamIds', 'non-competitive-team', `排名中出现了非竞技组队伍：${teamId}`),
        );
      }
    }
    if (ranking.bestResultLabels && ranking.bestResultLabels.length !== ordered.length) {
      errors.push(
        err(
          'qualification-ranking',
          null,
          'bestResultLabels',
          'label-length-mismatch',
          `最优成绩标签数量 ${ranking.bestResultLabels.length} 与排名队数 ${ordered.length} 不一致`,
        ),
      );
    }
    /*
     * 标签与名次必须**逐位对应**。
     *
     * 只查长度是不够的：人工调整名次时若沿用上一份标签，长度不变但内容错位，
     * 观众会看到"别人的成绩文字"。这里按队伍重新算一遍最优成绩标签做比对。
     * 观众端已改为按队伍 id 取标签（不会再错位），因此这里只是**提示**，
     * 用于发现历史数据或人工编辑留下的残留。
     */
    if (ranking.bestResultLabels && ranking.bestResultLabels.length === ordered.length) {
      const expected = new Map(computeQualificationRanking(event).standings.map((s) => [s.teamId, s.best?.label ?? '—']));
      const mismatched = ordered.filter((teamId, index) => (expected.get(teamId) ?? '—') !== ranking.bestResultLabels![index]);
      if (mismatched.length > 0) {
        warnings.push(
          warn(
            'qualification-ranking',
            null,
            'bestResultLabels',
            'stale-best-result-labels',
            `最优成绩标签与当前成绩不一致（${mismatched.length} 条）：多为人工作废名次后留下的旧标签。` +
              '观众端按队伍重新取标签，不受影响；如需一致，请重新定榜。',
          ),
        );
      }
    }
    // 名次只有在成绩完整时才谈得上"确定"。不完整却已确认的排名，
    // 必须有人为来源说明（裁判组核分表 / 组委会决定）才能发布——
    // 否则就是"用部分数据断言了完整结论"。
    const completeness = assessQualificationCompleteness(event);
    if (!completeness.ok && (ranking.sourceNote ?? '').trim() === '') {
      errors.push(
        err(
          'qualification-ranking',
          null,
          'orderedTeamIds',
          'ranking-confirmed-incomplete',
          `已确认的排位赛名次缺少完整成绩：${
            completeness.reason ?? '仍有队伍没有已确认的积分成绩'
          }。请先补齐成绩，或改由人工名次录入并填写来源说明。`,
        ),
      );
    }
  }

  /* ---------- 瑞士轮 ---------- */
  errors.push(...validateSwiss(event, teamIds, errors.length));

  /* ---------- 决赛 ---------- */
  const seriesIds = event.finals.series.map((s) => s.id);
  for (const id of findDuplicates(seriesIds)) {
    errors.push(err('series', id, 'id', 'duplicate-id', `系列赛 ID 重复：${id}`));
  }
  for (const message of validateFinalsGraph(event.finals.series)) {
    errors.push(err('series', null, 'slots', 'graph-invalid', message));
  }
  for (const node of FINALS_NODES) {
    if (!seriesIds.includes(node.id)) {
      errors.push(err('finals', node.id, 'series', 'missing-node', `缺少决赛节点：${node.id}（${node.label}）`));
    }
  }
  for (const series of event.finals.series) {
    if (!scheduleIds.has(series.scheduleItemId)) {
      errors.push(
        err('series', series.id, 'scheduleItemId', 'unknown-schedule-item', `引用了不存在的日程项：${series.scheduleItemId}`),
      );
    }
    /*
     * 展示组是**单独演出**：没有双方，也没有"胜者"。
     * 因此不套用对阵类校验（自我对阵、必须指定胜者、胜者须为参赛方），
     * 但仍然校验它引用的队伍与日程项是否真实存在。
     */
    const performance = series.stage === 'showcase';
    for (const game of series.games) {
      if (game.homeTeamId !== null && !teamIds.has(game.homeTeamId)) {
        errors.push(err('series', series.id, `games[${game.index}].homeTeamId`, 'unknown-team', `引用了不存在的队伍：${game.homeTeamId}`));
      }
      if (game.awayTeamId !== null && !teamIds.has(game.awayTeamId)) {
        errors.push(err('series', series.id, `games[${game.index}].awayTeamId`, 'unknown-team', `引用了不存在的队伍：${game.awayTeamId}`));
      }
      if (performance) {
        // 演出没有胜负；记了胜者就是把演出当成了比赛。
        if (game.winnerId !== null) {
          errors.push(
            err('series', series.id, `games[${game.index}].winnerId`, 'showcase-winner', '展示组是单独演出，不存在胜者，不应记录胜者'),
          );
        }
        continue;
      }
      if (game.homeTeamId !== null && game.homeTeamId === game.awayTeamId) {
        errors.push(err('series', series.id, `games[${game.index}]`, 'self-match', '一局比赛不能自己对自己'));
      }
      if (game.resultStatus === 'confirmed' && game.winnerId === null) {
        errors.push(
          err('series', series.id, `games[${game.index}].winnerId`, 'missing-winner', '已确认的小局必须有明确胜者'),
        );
      }
      if (game.winnerId !== null && game.winnerId !== game.homeTeamId && game.winnerId !== game.awayTeamId) {
        errors.push(
          err('series', series.id, `games[${game.index}].winnerId`, 'winner-not-participant', '胜者必须是该局参赛双方之一'),
        );
      }
    }
    if (series.executionStatus === 'not-needed' && series.games.some((g) => g.resultStatus === 'confirmed')) {
      errors.push(
        err('series', series.id, 'executionStatus', 'not-needed-with-results', '标记为“不需要进行”的系列赛不应有已确认小局'),
      );
    }
  }

  if (event.finals.seeding) {
    const seeds = event.finals.seeding.seeds;
    const values = Object.values(seeds);
    for (const id of findDuplicates(values)) {
      errors.push(err('finals-seeding', id, 'seeds', 'duplicate-seed-team', `同一队伍被分配到多个决赛种子：${id}`));
    }
    for (const [seed, teamId] of Object.entries(seeds)) {
      if (!teamIds.has(teamId)) {
        errors.push(err('finals-seeding', seed, 'seeds', 'unknown-team', `种子 ${seed} 指向不存在的队伍：${teamId}`));
      }
    }
  }

  /* ---------- 展示组 ---------- */
  if (event.showcase.drawOrder) {
    if (event.showcase.drawOrder.length !== 3) {
      errors.push(
        err('showcase', null, 'drawOrder', 'draw-order-length', `抽签顺序应有 3 支队伍，实际 ${event.showcase.drawOrder.length} 支`),
      );
    }
    for (const teamId of event.showcase.drawOrder) {
      if (!showcase.some((t) => t.id === teamId)) {
        errors.push(err('showcase', teamId, 'drawOrder', 'unknown-showcase-team', `抽签顺序中出现非展示组队伍：${teamId}`));
      }
    }
    for (const id of findDuplicates(event.showcase.drawOrder)) {
      errors.push(err('showcase', id, 'drawOrder', 'duplicate-team', `抽签顺序中队伍重复：${id}`));
    }
    if (event.showcase.confirmedAt === null) {
      warnings.push(warn('showcase', null, 'confirmedAt', 'draw-without-time', '已登记抽签顺序但没有记录确认时间'));
    }
  }

  /* ---------- 更正 ---------- */
  for (const correction of event.corrections) {
    if (correction.disposition === 'pending') {
      errors.push(
        err(
          'correction',
          correction.id,
          'disposition',
          'correction-unhandled',
          `更正 ${correction.id} 尚未处置，阻止导出正式版本：${correction.reason}`,
        ),
      );
    }
    if (!correction.allowsProgress && correction.disposition !== 'pending') {
      warnings.push(
        warn('correction', correction.id, 'allowsProgress', 'progress-blocked', `更正 ${correction.id} 标记为不允许继续推进`),
      );
    }
  }

  /* ---------- 顶层 ---------- */
  if (event.event.sourceDocumentSha256 !== '89c9fb3fd29f13c4daaacba8bd921744df7f5da264b86c3683cc8ca7484e7bf2') {
    warnings.push(
      warn(
        'event',
        null,
        'sourceDocumentSha256',
        'source-document-changed',
        '原始文档哈希与已知版本不同；必须重新比对规则后才能继续声称与旧版一致',
      ),
    );
  }

  return { errors, warnings, ok: errors.length === 0 };
}

/**
 * 瑞士轮专项校验。
 * 分拆出来以便维护工具在“生成下一轮候选”前单独检查。
 */
export function validateSwiss(event: EventFile, teamIds: Set<string>, _offset: number): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const matchesById = new Map<string, SwissMatch>();

  for (const match of event.swiss.matches) {
    if (matchesById.has(match.id)) {
      errors.push(err('swiss-match', match.id, 'id', 'duplicate-id', `比赛 ID 重复：${match.id}`));
    }
    matchesById.set(match.id, match);
  }

  // 每个比赛必须恰好被一个轮次引用，且引用必须存在
  const referenceCount = new Map<string, number>();
  for (const round of event.swiss.rounds) {
    for (const matchId of round.matchIds) {
      referenceCount.set(matchId, (referenceCount.get(matchId) ?? 0) + 1);
      const match = matchesById.get(matchId);
      if (!match) {
        errors.push(
          err('swiss-round', round.id, 'matchIds', 'unknown-match', `第 ${round.index} 轮引用了不存在的比赛：${matchId}`),
        );
        continue;
      }
      if (match.roundId !== round.id) {
        errors.push(
          err(
            'swiss-match',
            match.id,
            'roundId',
            'round-id-mismatch',
            `比赛的 roundId=${match.roundId} 与被引用的轮次 ${round.id} 不一致`,
          ),
        );
      }
      if (match.roundIndex !== round.index) {
        errors.push(
          err(
            'swiss-match',
            match.id,
            'roundIndex',
            'round-index-mismatch',
            `比赛的 roundIndex=${match.roundIndex} 与轮次序号 ${round.index} 不一致`,
          ),
        );
      }
    }
  }
  for (const match of event.swiss.matches) {
    if (!referenceCount.has(match.id)) {
      errors.push(
        err('swiss-match', match.id, 'roundId', 'orphan-match', `比赛未被任何轮次的 matchIds 引用（roundId=${match.roundId}）`),
      );
    }
  }
  for (const [matchId, count] of referenceCount) {
    if (count > 1) {
      errors.push(err('swiss-match', matchId, 'roundId', 'multi-round-reference', `比赛被 ${count} 个轮次引用`));
    }
  }

  /* ---------- 单场比赛 ---------- */
  for (const match of event.swiss.matches) {
    for (const [index, ref] of match.slots.entries()) {
      if (ref.kind === 'team' && !teamIds.has(ref.teamId)) {
        errors.push(err('swiss-match', match.id, `slots[${index}]`, 'unknown-team', `引用了不存在的队伍：${ref.teamId}`));
      }
    }
    if (match.slots[0].kind === 'team' && match.slots[1].kind === 'team' && match.slots[0].teamId === match.slots[1].teamId) {
      errors.push(err('swiss-match', match.id, 'slots', 'self-match', '不能自己对自己'));
    }
    if (match.participantSnapshot && match.participantSnapshot[0] === match.participantSnapshot[1]) {
      errors.push(err('swiss-match', match.id, 'participantSnapshot', 'self-match', '参赛快照中出现自我对阵'));
    }
    if (match.participantSnapshot) {
      for (const [index, teamId] of match.participantSnapshot.entries()) {
        if (!teamIds.has(teamId)) {
          errors.push(
            err('swiss-match', match.id, `participantSnapshot[${index}]`, 'unknown-team', `参赛快照引用了不存在的队伍：${teamId}`),
          );
        }
      }
    }

    for (const [index, attempt] of match.attempts.entries()) {
      if (attempt.homeTeamId === attempt.awayTeamId) {
        errors.push(err('swiss-match', match.id, `attempts[${index}]`, 'self-match', '一次尝试不能自己对自己'));
      }
      if (!teamIds.has(attempt.homeTeamId)) {
        errors.push(
          err('swiss-match', match.id, `attempts[${index}].homeTeamId`, 'unknown-team', `引用了不存在的队伍：${attempt.homeTeamId}`),
        );
      }
      if (!teamIds.has(attempt.awayTeamId)) {
        errors.push(
          err('swiss-match', match.id, `attempts[${index}].awayTeamId`, 'unknown-team', `引用了不存在的队伍：${attempt.awayTeamId}`),
        );
      }
      if (attempt.resultStatus === 'confirmed' && attempt.winnerId === null) {
        errors.push(
          err('swiss-match', match.id, `attempts[${index}].winnerId`, 'missing-winner', '已确认的结果必须由裁判确认胜者'),
        );
      }
      if (
        attempt.resultStatus === 'confirmed' &&
        attempt.winnerId !== null &&
        attempt.winnerId !== attempt.homeTeamId &&
        attempt.winnerId !== attempt.awayTeamId
      ) {
        errors.push(
          err('swiss-match', match.id, `attempts[${index}].winnerId`, 'winner-not-participant', '胜者必须是参赛双方之一'),
        );
      }
      if (attempt.supersedesId !== null && !match.attempts.some((a) => a.id === attempt.supersedesId)) {
        errors.push(
          err(
            'swiss-match',
            match.id,
            `attempts[${index}].supersedesId`,
            'unknown-superseded-attempt',
            `supersedesId=${attempt.supersedesId} 在本场比赛中不存在`,
          ),
        );
      }
      // 缺积分检查：有效比赛必须给出双方积分（弃权/行政中止不需要）
      if (
        attempt.resultStatus === 'confirmed' &&
        (attempt.resultKind === 'normal' || attempt.resultKind === 'early-end') &&
        (attempt.homeScore === null || attempt.awayScore === null)
      ) {
        errors.push(
          err(
            'swiss-match',
            match.id,
            `attempts[${index}].homeScore`,
            'missing-score',
            '有效比赛缺少积分；缺分不等于 0，不得用假 0 分填补',
          ),
        );
      }
    }

    if (match.effectiveAttemptId !== null && !match.attempts.some((a) => a.id === match.effectiveAttemptId)) {
      errors.push(
        err(
          'swiss-match',
          match.id,
          'effectiveAttemptId',
          'unknown-effective-attempt',
          `effectiveAttemptId=${match.effectiveAttemptId} 不存在`,
        ),
      );
    }

    if (hasAttemptCycle(match)) {
      errors.push(err('swiss-match', match.id, 'attempts', 'attempt-cycle', '重赛的 supersedes 链存在循环'));
    }

    if (match.participantSnapshot && match.executionStatus === 'scheduled') {
      errors.push(
        err(
          'swiss-match',
          match.id,
          'executionStatus',
          'snapshot-without-progress',
          '存在参赛快照但执行状态仍为 scheduled，无法判断是否已公布',
        ),
      );
    }
  }

  /* ---------- 轮次结构 ---------- */
  const roundsSeen = new Set<number>();
  for (const round of event.swiss.rounds) {
    if (roundsSeen.has(round.index)) {
      errors.push(err('swiss-round', round.id, 'index', 'duplicate-round-index', `轮次序号重复：${round.index}`));
    }
    roundsSeen.add(round.index);

    const matches = round.matchIds
      .map((id) => matchesById.get(id))
      .filter((m): m is SwissMatch => m !== undefined);
    const expected = EXPECTED_MATCH_COUNTS[round.index];
    if (expected !== undefined && matches.length > 0 && matches.length !== expected) {
      errors.push(
        err(
          'swiss-round',
          round.id,
          'matchIds',
          'unexpected-match-count',
          `第 ${round.index} 轮应有 ${expected} 场，实际 ${matches.length} 场`,
        ),
      );
    }

    const groupOrder = ROUND_GROUP_ORDER[round.index];
    if (groupOrder) {
      const sorted = [...matches].sort((a, b) => a.orderInGroup - b.orderInGroup);
      const actualOrder: string[] = [];
      for (const m of sorted) {
        if (actualOrder[actualOrder.length - 1] !== m.groupRecord) actualOrder.push(m.groupRecord);
      }
      for (const record of actualOrder) {
        if (!groupOrder.includes(record)) {
          errors.push(
            err(
              'swiss-round',
              round.id,
              'matchIds',
              'unexpected-group',
              `第 ${round.index} 轮出现未定义的战绩组 ${record}（允许：${groupOrder.join('、')}）`,
            ),
          );
        }
      }
      for (const record of groupOrder) {
        const inGroup = sorted.filter((m) => m.groupRecord === record);
        inGroup.forEach((m, i) => {
          if (m.orderInGroup !== i + 1) {
            errors.push(
              err(
                'swiss-match',
                m.id,
                'orderInGroup',
                'order-not-contiguous',
                `${record} 组内序号必须从 1 连续，${m.id} 为 ${m.orderInGroup}`,
              ),
            );
          }
        });
      }
    }

    if (round.publicationStatus === 'published' && round.publishedAt === null) {
      errors.push(err('swiss-round', round.id, 'publishedAt', 'published-without-time', '已发布的轮次必须记录公布时间'));
    }
    if (round.publicationStatus === 'published' && round.matchIds.length === 0) {
      errors.push(err('swiss-round', round.id, 'matchIds', 'published-empty', '已发布的轮次不能没有比赛'));
    }
    if (round.publicationStatus === 'published') {
      // 已发布轮次的每场比赛都必须有明确参赛队伍（不能仍是待定引用）。
      for (const m of matches) {
        if (!m.participantSnapshot) {
          errors.push(
            err('swiss-match', m.id, 'participantSnapshot', 'published-without-participants', '已发布轮次的比赛必须有实际参赛队伍快照'),
          );
        }
        for (const [i, ref] of m.slots.entries()) {
          if (ref.kind === 'pending') {
            errors.push(
              err(
                'swiss-match',
                m.id,
                `slots[${i}]`,
                'published-with-pending-slot',
                `已发布轮次的对阵位不能仍是「${ref.reason}」`,
              ),
            );
          }
        }
      }
    } else {
      // 未发布轮次：对阵位应为 pending，而不是具体的排位赛名次/种子 ——
      // 后者会显示成"排位赛第 1 名 vs 第 2 名"这种看似真实却错误的配对。
      for (const m of matches) {
        for (const [i, ref] of m.slots.entries()) {
          if (ref.kind === 'qualification-rank' || ref.kind === 'finals-seed') {
            errors.push(
              warn(
                'swiss-match',
                m.id,
                `slots[${i}]`,
                'unpublished-with-specific-slot',
                `第 ${round.index} 轮尚未公布，槽位却是具体的「${ref.kind === 'qualification-rank' ? `排位赛第 ${ref.rank} 名` : ref.seed}」；建议改用 pending 说明在等什么`,
              ),
            );
          }
        }
      }
    }
  }

  /* ---------- 轮次顺序与跨日冻结 ---------- */
  const sortedRounds = [...event.swiss.rounds].sort((a, b) => a.index - b.index);
  for (const round of sortedRounds) {
    if (round.index > 1) {
      const previous = sortedRounds.find((r) => r.index === round.index - 1);
      if (!previous) {
        errors.push(err('swiss-round', round.id, 'index', 'missing-previous-round', `缺少第 ${round.index - 1} 轮，轮次必须连续`));
      } else if (round.publicationStatus !== 'draft' && previous.publicationStatus === 'draft') {
        errors.push(
          err(
            'swiss-round',
            round.id,
            'publicationStatus',
            'published-before-previous',
            `第 ${round.index} 轮已发布，但第 ${round.index - 1} 轮仍是草稿`,
          ),
        );
      }
    }
  }

  return errors;
}

function hasAttemptCycle(match: SwissMatch): boolean {
  const byId = new Map(match.attempts.map((a) => [a.id, a]));
  for (const start of match.attempts) {
    const seen = new Set<string>([start.id]);
    let cursor = start.supersedesId;
    while (cursor !== null) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = byId.get(cursor)?.supersedesId ?? null;
    }
  }
  return false;
}

/** 把校验结果格式化为可读的多行文本（CLI 使用）。 */
export function formatValidation(result: ValidationResult): string {
  const lines: string[] = [];
  if (result.errors.length === 0 && result.warnings.length === 0) return '校验通过，没有发现任何问题。';
  if (result.errors.length > 0) {
    lines.push(`错误 ${result.errors.length} 条：`);
    for (const e of result.errors) {
      lines.push(`  [${e.objectType}${e.objectId ? ` ${e.objectId}` : ''}${e.field ? `.${e.field}` : ''}] ${e.message}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push(`警告 ${result.warnings.length} 条：`);
    for (const w of result.warnings) {
      lines.push(`  [${w.objectType}${w.objectId ? ` ${w.objectId}` : ''}${w.field ? `.${w.field}` : ''}] ${w.message}`);
    }
  }
  return lines.join('\n');
}

/** 供 UI 展示：把有理数指标转成百分比区间检查（A/B/P/O/R 均应在 0–100）。 */
export function checkMetricRange(value: Parameters<typeof toApproxNumber>[0], label: string): ValidationIssue | null {
  const approx = toApproxNumber(value);
  if (approx < -1e-9 || approx > 100 + 1e-9) {
    return err('swiss-standings', null, label, 'metric-out-of-range', `${label} 应在 0–100 之间，实际约 ${approx}`);
  }
  return null;
}
