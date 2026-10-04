import type { Awards } from '../domain/finals';
import type { Team } from '../domain/schema';

export type AwardKind = keyof Awards;

export const AWARD_LABELS: Record<AwardKind, string> = {
  champion: '冠军',
  runnerUp: '亚军',
  third: '季军',
  topFour: '四强',
  topEight: '八强',
  topSixteen: '十六强',
  honorableMention: '优秀奖',
};

export const AWARD_ORDER: readonly AwardKind[] = [
  'champion', 'runnerUp', 'third', 'topFour', 'topEight', 'topSixteen', 'honorableMention',
];

/** 只标注已经结算的竞技奖项；晋级资格、种子和展示组不构成获奖。 */
export function awardForTeam(awards: Awards, team: Pick<Team, 'id' | 'division'>): AwardKind | null {
  if (team.division !== 'competitive') return null;
  return AWARD_ORDER.find((kind) => {
    const members = awards[kind];
    return Array.isArray(members) ? members.includes(team.id) : members === team.id;
  }) ?? null;
}
