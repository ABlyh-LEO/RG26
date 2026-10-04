import { describe, expect, it } from 'vitest';
import { AWARD_LABELS, awardForTeam } from '../../src/data/award-labels';
import { deriveEvent } from '../../src/data/view-model';
import { audienceEvent } from '../fixtures/audience-scenarios';

describe('已结算奖项标签', () => {
  it('完整赛果按真实归属映射七种奖项及中文名称', () => {
    const derived = deriveEvent(audienceEvent('after'));
    const expected = [
      ['champion', '冠军', 1], ['runnerUp', '亚军', 1], ['third', '季军', 1],
      ['topFour', '四强', 1], ['topEight', '八强', 4], ['topSixteen', '十六强', 8],
      ['honorableMention', '优秀奖', 6],
    ] as const;
    for (const [kind, label, count] of expected) {
      expect(AWARD_LABELS[kind]).toBe(label);
      const members = derived.awards[kind];
      const ids = Array.isArray(members) ? members : members ? [members] : [];
      expect(ids).toHaveLength(count);
      for (const id of ids) expect(awardForTeam(derived.awards, derived.teamMap.get(id)!.team)).toBe(kind);
    }
  });

  it('三胜只是八强资格，不提前标成最终八强奖项', () => {
    const derived = deriveEvent(audienceEvent('swiss-r4'));
    const qualified = [...derived.standings.byTeam.values()].filter(entry => entry.wins === 3);
    expect(qualified).toHaveLength(2);
    for (const entry of qualified) expect(awardForTeam(derived.awards, derived.teamMap.get(entry.teamId)!.team)).toBeNull();
    const eliminated = derived.awards.topSixteen[0]!;
    expect(awardForTeam(derived.awards, derived.teamMap.get(eliminated)!.team)).toBe('topSixteen');
  });

  it('尚未有赛果和没有获奖记录的队伍不产生奖项标签', () => {
    const before = deriveEvent(audienceEvent('before'));
    for (const team of before.event.teams) expect(awardForTeam(before.awards, team)).toBeNull();
    expect(awardForTeam(deriveEvent(audienceEvent('after')).awards, { id: 'unknown', division: 'competitive' })).toBeNull();
  });

  it('展示组不产生竞技奖项，即使传入的奖项记录误含该队', () => {
    const derived = deriveEvent(audienceEvent('after'));
    for (const team of derived.event.teams.filter(team => team.division === 'showcase')) {
      expect(awardForTeam(derived.awards, team)).toBeNull();
      expect(awardForTeam({ ...derived.awards, champion: team.id }, team)).toBeNull();
    }
  });
});
