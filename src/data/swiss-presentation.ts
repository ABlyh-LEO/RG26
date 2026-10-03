/** 瑞士轮的实际赛况。规则图的示意箭头不参与这里的队伍去向与晋级判定。 */
import type { ResultKind } from '../domain/schema';
import { collectSettledMatches } from '../domain/scores';
import { calculateSwissStandings, qualificationState, type StandingsEntry } from '../domain/standings';
import {
  deriveRounds,
  qualifiedTeamIds,
  type DerivedEvent,
  type MatchView,
  type RoundGroupView,
  type RoundView,
} from './view-model';

export interface SwissSidePresentation {
  teamId: string;
  preRecord: string;
  postRecord: string | null;
  outcome: 'win' | 'loss' | null;
  /** 已确认时说明赛后的晋级条件，否则说明赛前条件。 */
  condition: string;
}

export interface SwissMatchPresentation {
  view: MatchView;
  sides: [SwissSidePresentation, SwissSidePresentation] | null;
  crossGroup: boolean;
  resultKind: ResultKind | null;
  confirmed: boolean;
}

export interface SwissGroupPresentation extends RoundGroupView {
  details: SwissMatchPresentation[];
  confirmedCount: number;
}

export interface SwissRoundPresentation extends Omit<RoundView, 'groups'> {
  groups: SwissGroupPresentation[];
  state: 'unpublished' | 'ready' | 'running' | 'complete';
  matchCount: number;
  confirmedCount: number;
  pairingVersion: number;
}

export interface SwissJourneyStep {
  roundIndex: number;
  groupRecord: string;
  match: SwissMatchPresentation;
  side: SwissSidePresentation;
}

export interface SwissPresentation {
  rounds: SwissRoundPresentation[];
  summary: {
    advanced: StandingsEntry[];
    active: StandingsEntry[];
    eliminated: StandingsEntry[];
  };
  journeys: Map<string, SwissJourneyStep[]>;
  qualifiedTeamIds: string[];
  currentRoundIndex: number;
}

function progressionCondition(wins: number, losses: number): string {
  if (wins >= 3) return '已晋级八强';
  if (losses >= 3) return '已淘汰';
  return `再胜 ${3 - wins} 场晋级；再负 ${3 - losses} 场淘汰`;
}

export function buildSwissPresentation(derived: DerivedEvent): SwissPresentation {
  const { event } = derived;
  const teamIds = qualifiedTeamIds(event);
  const publishedRounds = new Set(event.swiss.rounds
    .filter((round) => round.publicationStatus === 'published')
    .map((round) => round.index));
  const publishedMatches = event.swiss.matches.filter((match) => publishedRounds.has(match.roundIndex));
  const settledIds = new Set(collectSettledMatches(publishedMatches).matches.map((match) => match.matchId));
  const standings = calculateSwissStandings(teamIds, publishedMatches, event.qualification.ranking);
  const summary: SwissPresentation['summary'] = { advanced: [], active: [], eliminated: [] };
  for (const group of standings.groups) {
    for (const entry of group.entries) summary[qualificationState(entry)].push(entry);
  }
  const journeys = new Map<string, SwissJourneyStep[]>(teamIds.map((teamId) => [teamId, []]));
  const sourceById = new Map(event.swiss.matches.map((match) => [match.id, match]));
  const rounds = deriveRounds(derived).map((round): SwissRoundPresentation => {
    const published = round.publicationStatus === 'published';
    const before = calculateSwissStandings(teamIds,
      publishedMatches.filter((match) => match.roundIndex < round.index), event.qualification.ranking);
    const groups = round.groups.map((group): SwissGroupPresentation => {
      const details = group.matches.map((view): SwissMatchPresentation => {
        const source = sourceById.get(view.id)!;
        const attempt = published ? source.attempts.find((candidate) => candidate.id === source.effectiveAttemptId) : undefined;
        const confirmed = published && settledIds.has(source.id);
        const participants = published ? source.participantSnapshot : null;
        let sides: SwissMatchPresentation['sides'] = null;
        if (participants && participants.every((teamId) => before.byTeam.has(teamId))) {
          const makeSide = (teamId: string): SwissSidePresentation => {
            const entry = before.byTeam.get(teamId)!;
            const outcome = confirmed ? attempt?.winnerId === teamId ? 'win' : 'loss' : null;
            const wins = entry.wins + (outcome === 'win' ? 1 : 0);
            const losses = entry.losses + (outcome === 'loss' ? 1 : 0);
            return {
              teamId,
              preRecord: entry.record,
              postRecord: confirmed ? `${wins}-${losses}` : null,
              outcome,
              condition: progressionCondition(wins, losses),
            };
          };
          sides = [makeSide(participants[0]), makeSide(participants[1])];
        }
        const crossGroup = sides?.some((side) => side.preRecord !== group.record) ?? false;
        const detail: SwissMatchPresentation = {
          view: crossGroup ? { ...view, stakes: '跨组调整：晋级条件按双方实际战绩分别计算' } : view,
          sides,
          crossGroup,
          resultKind: attempt?.resultKind ?? null,
          confirmed,
        };
        for (const side of sides ?? []) {
          journeys.get(side.teamId)?.push({ roundIndex: round.index, groupRecord: group.record, match: detail, side });
        }
        return detail;
      });
      return { ...group, matches: details.map((detail) => detail.view), details, confirmedCount: details.filter((detail) => detail.confirmed).length };
    });
    const details = groups.flatMap((group) => group.details);
    const confirmedCount = details.filter((detail) => detail.confirmed).length;
    const complete = published && details.length > 0 && confirmedCount === details.length;
    const state = !published ? 'unpublished' : complete ? 'complete'
      : confirmedCount > 0 || details.some((detail) => detail.view.executionStatus === 'running' || detail.view.resultStatus !== 'none')
        ? 'running' : 'ready';
    return {
      ...round,
      groups,
      complete,
      state,
      matchCount: details.length,
      confirmedCount,
      pairingVersion: published ? event.swiss.rounds.find((source) => source.index === round.index)!.pairingVersion : 0,
    };
  });
  const current = rounds.find((round) => round.state !== 'unpublished' && !round.complete)
    ?? rounds.findLast((round) => round.state !== 'unpublished')
    ?? rounds[0];
  return { rounds, summary, journeys, qualifiedTeamIds: teamIds, currentRoundIndex: current?.index ?? 1 };
}

/** 保留合法链接指定的轮次，缺失或无效时落到实际当前轮次。 */
export function selectSwissRound(
  presentation: SwissPresentation,
  requestedRound: number | null | undefined,
): SwissRoundPresentation | null {
  return presentation.rounds.find((round) => round.index === requestedRound)
    ?? presentation.rounds.find((round) => round.index === presentation.currentRoundIndex)
    ?? null;
}
