/**
 * 排位赛「定榜」的两道判定（纯函数）。
 *
 * 本模块只回答两个问题，不做任何写入：
 *
 * 1. `assessQualificationCompleteness` —— 现在的成绩够不够定榜？
 *    每支竞技组队伍都必须有**至少一条已确认且积分可比较**的成绩。
 *    少录一支队伍，任何名次都只能是"当前排行"，不能是正式名次。
 * 2. `officialQualificationRanking` —— 存储的名次算不算**正式**名次？
 *    只有「已确认」且（「完整」或「有人为来源说明」）才算。
 *
 * 历史缺陷的根因是「确认一条成绩就自动定榜并对外断言晋级」：
 * 判定散落在各处、只看 `status`、不看完成度。这里把它收拢成唯一入口，
 * 供工作台、发布校验、公开快照构建与观众端共用。
 *
 * 本模块不读时钟、不碰 DOM、不使用随机数，结果完全由输入决定。
 */
import type { EventFile } from './schema';
import { computeQualificationRanking } from './qualification-ranking';

/** 排位赛定榜前的完整性判定结果。 */
export interface QualificationCompleteness {
  /** 硬门禁：每支竞技组队伍都有可比成绩。 */
  ok: boolean;
  teamCount: number;
  /** 至少有一条已确认且积分可比较的成绩。 */
  scoredTeamIds: string[];
  /** 没有任何可比成绩（含只填了成绩文字、没有积分的情况）。 */
  missingTeamIds: string[];
  /** 只录到一轮可比成绩。 */
  partialTeamIds: string[];
  /** 积分与用时完全相同，名次无法由数据区分。 */
  tiedTeamIds: string[];
  /** 面向维护者的可读原因；`ok` 为真时为 null。 */
  reason: string | null;
}

/** 存储的排位赛名次是否可以作为"正式名次"对外使用。 */
export interface OfficialQualificationRanking {
  /** 存储的名次已被一次显式动作确认。 */
  confirmed: boolean;
  /** 成绩完整性成立。 */
  complete: boolean;
  /**
   * 成绩不完整，但有明确的人为来源说明（裁判组核分表 / 组委会决定）。
   * 不完整的名次只能由人负责，不能由自动计算产生。
   */
  overridden: boolean;
  /** 允许对外断言晋级/淘汰/奖项。 */
  official: boolean;
  /** 正式名次（仅在 `official` 为真时有意义）。 */
  orderedTeamIds: string[];
  bestResultLabels: string[] | null;
  sourceNote: string | null;
  completeness: QualificationCompleteness;
}

function nameOf(event: EventFile, teamId: string): string {
  return event.teams.find((team) => team.id === teamId)?.name ?? teamId;
}

function namesOf(event: EventFile, teamIds: readonly string[], limit = 5): string {
  const names = teamIds.slice(0, limit).map((id) => nameOf(event, id));
  return teamIds.length > names.length ? `${names.join('、')} 等 ${teamIds.length} 支` : names.join('、');
}

/**
 * 判定当前成绩是否足以定榜。
 *
 * 「只录到一轮」不算缺失（规则允许一轮为最优成绩），但会被列出，
 * 要求定榜前由人复核——它不属于硬门禁。
 */
export function assessQualificationCompleteness(event: EventFile): QualificationCompleteness {
  const result = computeQualificationRanking(event);
  const competitive = event.teams.filter((team) => team.division === 'competitive');
  const scoredTeamIds = result.standings
    .filter((standing) => standing.best !== null && !standing.best.incomplete)
    .map((standing) => standing.teamId);
  const missingTeamIds = result.incompleteTeamIds;

  return {
    ok: missingTeamIds.length === 0,
    teamCount: competitive.length,
    scoredTeamIds,
    missingTeamIds,
    partialTeamIds: result.partialTeamIds,
    tiedTeamIds: result.tiedTeamIds,
    reason:
      missingTeamIds.length === 0
        ? null
        : `${missingTeamIds.length} / ${competitive.length} 支队伍尚无已确认的积分成绩：${namesOf(event, missingTeamIds)}`,
  };
}

/**
 * 存储的名次算不算"正式名次"。
 *
 * - 未确认（`status !== 'confirmed'`）→ 不是正式名次，无条件；
 * - 已确认且完整 → 正式名次；
 * - 已确认但不完整、却有来源说明 → 正式名次，但由人负责（`overridden`）。
 *
 * 注意：**自动计算不允许走 `overridden` 通道**——只有显式的人工录入
 * （`applyQualificationRanking`）才带来源说明。
 */
export function officialQualificationRanking(event: EventFile): OfficialQualificationRanking {
  const stored = event.qualification.ranking;
  const completeness = assessQualificationCompleteness(event);
  const confirmed = stored.status === 'confirmed';
  const sourceNote = stored.sourceNote?.trim() ? stored.sourceNote : null;
  const overridden = confirmed && !completeness.ok && sourceNote !== null;

  return {
    confirmed,
    complete: completeness.ok,
    overridden,
    official: confirmed && (completeness.ok || overridden),
    orderedTeamIds: confirmed ? stored.orderedTeamIds : [],
    bestResultLabels: confirmed ? stored.bestResultLabels : null,
    sourceNote,
    completeness,
  };
}
