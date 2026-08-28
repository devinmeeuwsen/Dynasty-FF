import type { DraftPick, FinishMatrix } from './types';

/**
 * The trade partner view.
 *
 * When you acquire a win now player from team X, team X gets worse. If you
 * already own a pick originating with team X, you collect twice: once on the
 * player, once on the pick improving. That is the single best trade shape in
 * dynasty and no existing tool identifies it.
 *
 * The inverse matters just as much: selling win now help to a team whose pick
 * you own improves that team and devalues the pick you are holding.
 */

export interface PartnerInsight {
  rosterId: number;
  teamName: string;
  /** Picks you hold that originated with this team. */
  picks: DraftPick[];
  pickValue: number;
  /** Their expected finish, so the interface can say whether you will pass them. */
  expectedFinish: number;
  /** Your expected finish, for the same reason. */
  yourExpectedFinish: number;
  /** Positive when they finish below you already, so passing them is not available. */
  finishGap: number;
  recommendation: 'buy_win_now_from' | 'do_not_sell_win_now_to' | 'neutral';
  reason: string;
}

function expectedFinish(matrix: FinishMatrix, rosterId: number): number {
  const i = matrix.rosterIds.indexOf(rosterId);
  if (i < 0) return matrix.rosterIds.length / 2;
  return matrix.rows[i].reduce((acc, p, j) => acc + p * (j + 1), 0);
}

export function partnerInsights(
  userRosterId: number,
  picks: DraftPick[],
  pickValues: Map<string, { value: number }>,
  finish: FinishMatrix,
  teamNames: Map<number, string>,
  pickKeyOf: (p: DraftPick) => string,
): PartnerInsight[] {
  const yours = expectedFinish(finish, userRosterId);
  const held = picks.filter(
    (p) => p.ownerRosterId === userRosterId && p.originalRosterId !== userRosterId,
  );

  const grouped = new Map<number, DraftPick[]>();
  for (const pick of held) {
    const list = grouped.get(pick.originalRosterId) ?? [];
    list.push(pick);
    grouped.set(pick.originalRosterId, list);
  }

  const insights: PartnerInsight[] = [];
  for (const [rosterId, list] of grouped) {
    const theirs = expectedFinish(finish, rosterId);
    const value = list.reduce((a, p) => a + (pickValues.get(pickKeyOf(p))?.value ?? 0), 0);
    const gap = theirs - yours;

    // "Adjacent" means close enough in projected finish that the two teams can
    // realistically swap places, which is the only way pick values move much.
    const adjacent = Math.abs(gap) <= Math.max(2, finish.rosterIds.length * 0.3);

    let recommendation: PartnerInsight['recommendation'] = 'neutral';
    let reason = '';
    if (adjacent) {
      recommendation = 'buy_win_now_from';
      reason =
        'You hold their pick and they sit close to you in projected finish. Buying win now help from them ' +
        'pays twice: your lineup improves and their pick, which you own, moves earlier.';
    } else if (gap > 0) {
      recommendation = 'do_not_sell_win_now_to';
      reason =
        'You hold their pick and they project below you. Selling them win now help lifts them past teams ' +
        'and pushes the pick you own later.';
    } else {
      recommendation = 'neutral';
      reason =
        'You hold their pick but they project well ahead of you. Their pick lands late whatever you do, ' +
        'so this holding is not a lever on your own moves.';
    }

    insights.push({
      rosterId,
      teamName: teamNames.get(rosterId) ?? `Roster ${rosterId}`,
      picks: list.sort((a, b) => a.season - b.season || a.round - b.round),
      pickValue: value,
      expectedFinish: theirs,
      yourExpectedFinish: yours,
      finishGap: gap,
      recommendation,
      reason,
    });
  }

  return insights.sort((a, b) => b.pickValue - a.pickValue);
}
