import { useMemo } from 'react';
import { pickKey } from '../../engine/picks';
import { partnerInsights } from '../../engine/partners';
import { useStore } from '../../state/store';
import { useTeamName } from '../useTeamName';
import { SlotDistribution, TeamBars } from '../components/charts';
import { Callout, EmptyState, Panel, PanelHeader, Stat } from '../components/primitives';
import { ordinal, percent, value } from '../format';

/**
 * Draft capital, and the trade partner view that falls out of it.
 *
 * Which team's pick you hold matters as much as how many you hold, so every
 * pick here is shown with the team it originated from, that team's projected
 * finish distribution, and the value range that distribution implies.
 */
export function CapitalView() {
  const scenario = useStore((s) => s.scenario);
  const picks = useStore((s) => s.picks);
  const audit = useStore((s) => s.pickAudit);
  const userRosterId = useStore((s) => s.userRosterId);
  const rosters = useStore((s) => s.rosters);
  const teamName = useTeamName();
  const league = useStore((s) => s.league);

  const partners = useMemo(() => {
    if (!scenario || userRosterId == null) return [];
    return partnerInsights(
      userRosterId,
      picks,
      scenario.pickValues,
      scenario.result.finish,
      new Map(rosters.map((r) => [r.rosterId, teamName(r.rosterId)])),
      pickKey,
    );
  }, [scenario, picks, userRosterId, rosters, teamName]);

  if (!scenario || picks.length === 0) {
    return (
      <Panel>
        <EmptyState title="Pick valuation needs a synced league">
          Ownership comes from Sleeper's traded picks list and value comes from the draft slot
          matrix, which only exists once the season simulation has run.
        </EmptyState>
      </Panel>
    );
  }

  const viewRosterId = userRosterId ?? rosters[0].rosterId;
  const held = picks
    .filter((p) => p.ownerRosterId === viewRosterId)
    .sort((a, b) => a.season - b.season || a.round - b.round);

  const total = held.reduce((sum, p) => sum + (scenario.pickValues.get(pickKey(p))?.value ?? 0), 0);
  const fromOthers = held.filter((p) => p.originalRosterId !== viewRosterId);
  const teams = scenario.result.draftSlots.rosterIds.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="p-4">
          <Stat label="Your draft capital" tone="later" hint={`${held.length} picks across ${league ? 2 : 0} classes`}>
            {value(total, 1)}
          </Stat>
        </Panel>
        <Panel className="p-4">
          <Stat
            label="From other teams"
            hint="These move in the opposite direction from your own picks when you improve"
          >
            {fromOthers.length}
          </Stat>
        </Panel>
        <Panel className="p-4">
          <Stat
            label="Ownership audit"
            tone={audit?.ok ? 'later' : 'now'}
            hint={
              audit
                ? `${audit.totalPicks} of ${audit.expectedPicks} expected, ${audit.duplicated.length} duplicated`
                : undefined
            }
          >
            {audit?.ok ? 'Reconciled' : 'Check'}
          </Stat>
        </Panel>
      </div>

      <Panel className="overflow-hidden animate-rise">
        <PanelHeader
          title={`${teamName(viewRosterId)} · picks held`}
          subtitle="A pick lands where its ORIGINAL owner finishes, not where the team holding it finishes. That distinction drives every number in this table."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-[0.8125rem]">
            <thead className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-400">
              <tr className="border-b border-white/[0.06]">
                <th className="py-2.5 pl-4 text-left font-medium sm:pl-5">Pick</th>
                <th className="px-3 py-2.5 text-left font-medium">Origin</th>
                <th className="px-3 py-2.5 text-left font-medium">Their slot distribution</th>
                <th className="px-3 py-2.5 text-right font-medium">Likely range</th>
                <th className="py-2.5 pr-4 text-right font-medium sm:pr-5">Value</th>
              </tr>
            </thead>
            <tbody>
              {held.map((pick) => {
                const valuation = scenario.pickValues.get(pickKey(pick));
                if (!valuation) return null;
                const own = pick.originalRosterId === viewRosterId;
                return (
                  <tr key={pickKey(pick)} className="border-b border-white/[0.035]">
                    <td className="py-2.5 pl-4 sm:pl-5">
                      <div className="num font-medium text-ink-100">
                        {pick.season} · round {pick.round}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={own ? 'text-ink-400' : 'text-blend-400'}>
                        {own ? 'your own' : teamName(pick.originalRosterId)}
                      </span>
                    </td>
                    <td className="w-40 px-3 py-2.5">
                      <SlotDistribution
                        distribution={valuation.slotDistribution}
                        round={pick.round}
                        teams={teams}
                      />
                    </td>
                    <td className="num px-3 py-2.5 text-right text-ink-300">
                      {formatSlot(valuation.slotRange[0], teams)} –{' '}
                      {formatSlot(valuation.slotRange[1], teams)}
                    </td>
                    <td className="num py-2.5 pr-4 text-right font-semibold text-later-400 sm:pr-5">
                      {value(valuation.value, 1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-white/[0.06] px-4 py-3 text-[0.75rem] leading-relaxed text-ink-400 sm:px-5">
          Values are probability weighted across the whole slot distribution, never off a point
          estimate of finish. A team projected tenth still finishes fourth sometimes, and the value
          of its pick has to reflect that spread.
        </p>
      </Panel>

      {userRosterId != null ? (
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Trade partners"
            subtitle="When you acquire win now help from a team whose pick you own, you collect twice: your lineup improves and their pick moves earlier. The inverse is a trap worth naming."
          />
          {partners.length === 0 ? (
            <p className="px-4 py-8 text-center text-[0.8125rem] text-ink-400 sm:px-5">
              You do not hold any picks originating with other teams, so this lever is not
              available. Acquiring one from a team near you in the standings is how you open it.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {partners.map((insight) => (
                <li key={insight.rosterId} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          insight.recommendation === 'buy_win_now_from'
                            ? 'bg-good-500'
                            : insight.recommendation === 'do_not_sell_win_now_to'
                              ? 'bg-bad-500'
                              : 'bg-ink-500'
                        }`}
                      />
                      <span className="text-[0.9375rem] font-semibold text-ink-100">
                        {insight.teamName}
                      </span>
                      <span className="rounded-md bg-white/[0.07] px-2 py-0.5 text-[0.625rem] uppercase tracking-wide text-ink-300">
                        {insight.recommendation === 'buy_win_now_from'
                          ? 'preferred source of win now help'
                          : insight.recommendation === 'do_not_sell_win_now_to'
                            ? 'do not sell win now help here'
                            : 'no leverage'}
                      </span>
                    </div>
                    <span className="num text-[0.75rem] text-ink-400">
                      {insight.picks.length} pick{insight.picks.length === 1 ? '' : 's'} ·{' '}
                      {value(insight.pickValue, 1)} value
                    </span>
                  </div>
                  <p className="mt-1.5 max-w-3xl text-[0.8125rem] leading-relaxed text-ink-400">
                    {insight.reason}
                  </p>
                  <div className="num mt-1.5 text-[0.6875rem] text-ink-500">
                    They project {ordinal(insight.expectedFinish)}, you project{' '}
                    {ordinal(insight.yourExpectedFinish)}
                    {' · '}
                    {insight.picks.map((p) => `${p.season} rd ${p.round}`).join(', ')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="Draft capital across the league"
          subtitle="The system is zero sum. What a trade does is redistribute this, not add to it."
        />
        <div className="p-4 sm:p-5">
          <TeamBars
            entries={[...scenario.capitalByTeam.entries()]
              .map(([rosterId, v]) => ({ rosterId, name: teamName(rosterId), value: v }))
              .sort((a, b) => b.value - a.value)}
            format={(n) => value(n, 1)}
            color="var(--color-later-500)"
            highlight={userRosterId}
          />
        </div>
      </Panel>

      {audit && !audit.ok ? (
        <Callout tone="warn" title="Pick ownership did not reconcile">
          Expected {audit.expectedPicks} picks and found {audit.totalPicks}.
          {audit.duplicated.length > 0 ? ` Duplicated: ${audit.duplicated.join(', ')}.` : ''}
          {audit.unowned.length > 0 ? ` Unowned: ${audit.unowned.join(', ')}.` : ''}
        </Callout>
      ) : (
        <Callout tone="info">
          Every pick in every covered season has exactly one owner, and the total equals teams ×
          rounds × seasons. Ownership starts from every team owning all of its own picks, then
          Sleeper's traded picks list is applied on top: {percent(1, 0)} reconciled.
        </Callout>
      )}
    </div>
  );
}

function formatSlot(overall: number, teams: number): string {
  const round = Math.floor((overall - 1) / teams) + 1;
  const slot = ((overall - 1) % teams) + 1;
  return `${round}.${String(slot).padStart(2, '0')}`;
}
