/**
 * 红蓝方归属（纯函数）。
 *
 * 口径由组委会确认：
 *
 * 1. **默认**：赛程里**第一个**席位是**蓝方**，**第二个**席位是**红方**。
 * 2. **瑞士轮偶数轮（R2、R4）反过来** —— 第一个是红方、第二个是蓝方。
 *    这样每支队伍在整个瑞士轮里红蓝大致均衡，避免固定一侧带来的
 *    场地/视角优势（原文未规定，此为组委会确认的操作口径）。
 * 3. **八强双败（决赛全部场次）不反向** —— 一律第一个蓝、第二个红。
 *    2026-10-02 最新约定：BO3 全系列赛保持此归属，各小局不换边。
 *
 * 关键性质：红蓝方**完全由赛程结构推出**，不需要人工维护。
 * 只要参赛双方与轮次确定，红蓝方就是确定的；因此不存在
 * "忘记改红蓝方" 或 "两队都选了红方" 这类错误状态。
 *
 * 本模块不读时钟、不碰 DOM、不使用随机数，结果完全由输入决定。
 */
import type { SwissMatch } from './schema';

/** 一方在比赛中的颜色。 */
export type Side = 'red' | 'blue';

export interface Sides {
  /** 第一个席位（slots[0] / participantSnapshot[0]）的颜色。 */
  first: Side;
  /** 第二个席位（slots[1] / participantSnapshot[1]）的颜色。 */
  second: Side;
}

/** 默认：第一席位蓝、第二席位红。 */
export const DEFAULT_SIDES: Sides = { first: 'blue', second: 'red' };

/** 反向：第一席位红、第二席位蓝。 */
export const SWAPPED_SIDES: Sides = { first: 'red', second: 'blue' };

/**
 * 瑞士轮某一轮是否反向。
 *
 * **偶数轮反向**（R2、R4），奇数轮（R1、R3、R5）用默认。
 */
export function isSwissRoundSwapped(roundIndex: number): boolean {
  return roundIndex % 2 === 0;
}

/**
 * 瑞士轮某一场的红蓝方归属。
 *
 * @param roundIndex 轮次序号（1 起）
 */
export function sidesForSwiss(roundIndex: number): Sides {
  return isSwissRoundSwapped(roundIndex) ? SWAPPED_SIDES : DEFAULT_SIDES;
}

/**
 * 决赛（八强双败）的红蓝方归属：**一律不反向**。
 *
 * 保留成函数而不是直接暴露常量，是为了让调用方的意图清晰，
 * 也让"决赛不反向"这条规则有唯一的落点。
 *
 * BO1 与 BO3 全系列赛共用此归属，后续小局不改变颜色。
 */
export function sidesForFinals(): Sides {
  return DEFAULT_SIDES;
}

/**
 * 决赛 BO3 某一小局的红蓝方归属。
 *
 * 最新约定：第 1、2、3 局均为第一席位蓝、第二席位红。
 * 保留局号参数兼容小局查询接口；颜色只由系列赛席位决定。
 * 本函数也适用于 BO1 与展示赛，不改变瑞士轮偶数轮反向规则。
 */
export function sidesForSeriesGame(_gameIndex: number): Sides {
  return sidesForFinals();
}

/** 系列赛某一局里某队的颜色。 */
export function sideOfTeamInSeriesGame(
  teamId: string,
  firstTeamId: string,
  secondTeamId: string,
  gameIndex: number,
): Side | null {
  return sideOfTeam(teamId, firstTeamId, secondTeamId, sidesForSeriesGame(gameIndex));
}

/** 给定两个队伍与红蓝归属，返回「队伍 → 颜色」的映射。 */
export function assignSides(
  firstTeamId: string,
  secondTeamId: string,
  sides: Sides,
): { blue: string; red: string } {
  return sides.first === 'blue'
    ? { blue: firstTeamId, red: secondTeamId }
    : { blue: secondTeamId, red: firstTeamId };
}

/** 某支队伍在该场比赛里的颜色；不在参赛双方中时返回 null。 */
export function sideOfTeam(
  teamId: string,
  firstTeamId: string,
  secondTeamId: string,
  sides: Sides,
): Side | null {
  if (teamId === firstTeamId) return sides.first;
  if (teamId === secondTeamId) return sides.second;
  return null;
}

/** 颜色对应的中文标签。 */
export function sideLabel(side: Side): string {
  return side === 'red' ? '红方' : '蓝方';
}

/**
 * 从瑞士轮比赛推出红蓝方。
 *
 * 参赛双方优先取 `participantSnapshot`（已公布的正式对阵）；
 * 尚未公布时返回 null —— **不猜测**谁会是红蓝方。
 */
export function swissSidesOf(match: Pick<SwissMatch, 'roundIndex' | 'participantSnapshot'>): {
  sides: Sides;
  blue: string;
  red: string;
} | null {
  const snapshot = match.participantSnapshot;
  if (!snapshot || snapshot.length < 2) return null;
  const [first, second] = snapshot;
  if (!first || !second) return null;
  const sides = sidesForSwiss(match.roundIndex);
  return { sides, ...assignSides(first, second, sides) };
}

/**
 * 汇总：一场比赛里某队是红方还是蓝方。
 * 用于「队伍详情页」这类需要按队查询的场合。
 */
export function sideOfTeamInSwiss(
  match: Pick<SwissMatch, 'roundIndex' | 'participantSnapshot'>,
  teamId: string,
): Side | null {
  const snapshot = match.participantSnapshot;
  if (!snapshot || snapshot.length < 2) return null;
  const [first, second] = snapshot;
  if (!first || !second) return null;
  return sideOfTeam(teamId, first, second, sidesForSwiss(match.roundIndex));
}
