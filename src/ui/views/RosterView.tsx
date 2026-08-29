import { useMemo, useState } from 'react';
import { rosterEfficiency } from '../../engine/scenario';
import { startingSlots } from '../../engine/lineup';
import { blendedVar } from '../../engine/values';
import { useStore } from '../../state/store';
import { useTeamName } from '../useTeamName';
import { ContentionSlider } from '../components/ContentionSlider';
import {
  Bar,
  Callout,
  EmptyState,
  Panel,
  PanelHeader,
  PositionChip,
  Select,
  Stat,
} from '../components/primitives';
import { TIMELINE_LABEL, deltaClass, ordinal, percent, signed, value, timelineClass, timelineOf } from '../format';

/**
 * Roster efficiency: the marginal value of every player you own.
 *
 * Marginal value is what the optimal starting total loses if the player is
 * removed. A player who cannot crack the lineup has a marginal value of exactly
 * zero, which is how buried surplus surfaces: high blended value, zero marginal
 * contribution, therefore a trade asset rather than a contributor.
 */
export function RosterView() {
  const rosters = useStore((s) => s.rosters);
  const values = useStore((s) => s.values);
  const shape = useStore((s) => s.shape);
  const userRosterId = useStore((s) => s.userRosterId);
  const weight = useStore((s) => s.settings.contentionWeight);
  const scenario = useStore((s) => s.scenario);
  const teamName = useTeamName();

  const [selected, setSelected] = useState<number | null>(null);
  const rosterId = selected ?? userRosterId ?? rosters[0]?.rosterId ?? null;
  const roster = rosters.find((r) => r.rosterId === rosterId) ?? null;

  const entries = useMemo(() => {
    if (!roster) return [];
    return rosterEfficiency(roster, values, shape);
  }, [roster, values, shape]);

  if (!roster) {
    return (
      <Panel>
        <EmptyState title="Roster efficiency needs a synced league">
          The marginal value of a player is defined against a specific starting lineup, so it needs
          a real roster to be defined at all.
        </EmptyState>
      </Panel>
    );
  }

  const starters = entries.filter((e) => e.starting);
  const bench = entries.filter((e) => !e.starting);
  const lineupTotal = starters.reduce((sum, e) => sum + e.player.lineupValue, 0);
  const maxMarginal = Math.max(1, ...entries.map((e) => e.marginalWinNow));

  // Buried surplus: real long term value sitting on a bench, contributing
  // nothing to this season.
  const buried = bench
    .filter((e) => e.player.assetValue > 0 && e.marginalWinNow === 0)
    .sort((a, b) => b.player.assetValue - a.player.assetValue)
    .slice(0, 5);

  const finishRow = scenario?.result.finish;
  const rowIndex = finishRow ? finishRow.rosterIds.indexOf(roster.rosterId) : -1;
  const expectedFinish =
    finishRow && rowIndex >= 0
      ? finishRow.rows[rowIndex].reduce((acc, p, j) => acc + p * (j + 1), 0)
      : null;

  const slotCount = startingSlots(shape.starters).length;

  return (
    <div className="space-y-4">
      <ContentionSlider compact />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="p-4">
          <Stat label="Lineup strength" tone="now" hint={`Optimal across ${slotCount} valued slots`}>
            {value(lineupTotal, 0)}
          </Stat>
        </Panel>
        <Panel className="p-4">
          <Stat label="Long term on roster" tone="later" hint={`${entries.length} valued players`}>
            {value(entries.reduce((s, e) => s + e.player.assetValue, 0), 0)}
          </Stat>
        </Panel>
        <Panel className="p-4">
          <Stat
            label="Title odds"
            tone="blend"
            hint={expectedFinish ? `Projected ${ordinal(expectedFinish)}` : 'Run the simulation'}
          >
            {scenario ? percent(scenario.championship.get(roster.rosterId) ?? 0) : '—'}
          </Stat>
        </Panel>
        <Panel className="p-4">
          <Stat label="Buried surplus" hint="Bench players with long term value and zero marginal win now">
            {buried.length}
          </Stat>
        </Panel>
      </div>

      {rosters.length > 1 ? (
        <div className="max-w-xs">
          <Select
            value={String(roster.rosterId)}
            onChange={(v) => setSelected(Number(v))}
            options={rosters.map((r) => ({
              value: String(r.rosterId),
              label: teamName(r.rosterId) + (r.rosterId === userRosterId ? ' (you)' : ''),
            }))}
          />
        </div>
      ) : null}

      {buried.length > 0 ? (
        <Callout tone="info" title="Buried surplus">
          These players hold real long term value while contributing exactly nothing to this
          season's lineup:{' '}
          {buried.map((e) => e.player.name).join(', ')}. That is not a criticism of the roster — it
          is the shape of a trade asset.
        </Callout>
      ) : null}

      <Panel className="overflow-hidden animate-rise">
        <PanelHeader
          title="Marginal value of every player you own"
          subtitle="How much the optimal starting total drops if this player disappears — zero means he cannot crack the lineup, which is correct rather than a rounding artefact. Sort by VAR to find the roster spots free agency would improve: anything negative is worse than a player nobody in the league has claimed."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-[0.8125rem]">
            <thead className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-400">
              <tr className="border-b border-white/[0.06]">
                <th className="py-2.5 pl-4 text-left font-medium sm:pl-5">Player</th>
                <th className="px-3 py-2.5 text-left font-medium">Role</th>
                <th className="px-3 py-2.5 text-right font-medium">Marginal now</th>
                <th className="px-3 py-2.5 text-right font-medium text-blend-400">Rating</th>
                <th className="px-3 py-2.5 text-right font-medium text-now-400">Redraft</th>
                <th
                  className="px-3 py-2.5 text-right font-medium text-later-400"
                  title="Rating minus redraft. Positive is a better asset than starter, negative the reverse, within three points either way is balanced."
                >
                  Long term
                </th>
                <th
                  className="py-2.5 pr-4 text-right font-medium sm:pr-5"
                  title="Rating minus the best player at this position nobody in the league has rostered. Negative means the waiver wire already offers better."
                >
                  VAR
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.player.id} className="border-b border-white/[0.035]">
                  <td className="py-2.5 pl-4 sm:pl-5">
                    <div className="flex items-center gap-2">
                      <PositionChip position={entry.player.position} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink-100">
                          {entry.player.name}
                        </div>
                        <div className="num text-[0.6875rem] text-ink-500">
                          {entry.player.team ?? 'FA'}
                          {entry.player.age != null ? ` · ${entry.player.age}yo` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[0.625rem] uppercase tracking-wide ${
                        entry.starting
                          ? 'bg-now-500/15 text-now-400'
                          : 'bg-white/[0.06] text-ink-400'
                      }`}
                    >
                      {entry.starting ? 'starter' : 'bench'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="num font-semibold text-ink-100">
                      {value(entry.marginalWinNow, 1)}
                    </div>
                    <Bar
                      fraction={entry.marginalWinNow / maxMarginal}
                      color="var(--color-now-500)"
                      className="mt-1 ml-auto w-14"
                    />
                  </td>
                  <td className="num px-3 py-2.5 text-right text-blend-400">
                    {value(entry.player.rating)}
                  </td>
                  <td className="num px-3 py-2.5 text-right text-now-400">
                    {value(entry.player.redraft)}
                  </td>
                  <td
                    className={`num px-3 py-2.5 text-right ${timelineClass(entry.player.longTerm)}`}
                    title={TIMELINE_LABEL[timelineOf(entry.player.longTerm)]}
                  >
                    {signed(entry.player.longTerm)}
                  </td>
                  {/* Signed, and the reason this column exists: a negative
                      number is a roster spot the waiver wire would improve. */}
                  <td
                    className={`num py-2.5 pr-4 text-right font-medium sm:pr-5 ${deltaClass(
                      blendedVar(entry.player, weight),
                      0.05,
                    )}`}
                  >
                    {signed(blendedVar(entry.player, weight))}
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Optimal starting lineup"
          subtitle="Assigned to maximise total win now value, with flex and superflex resolved together rather than greedily."
        />
        <ul className="grid gap-px bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-3">
          {starters
            .sort((a, b) => b.player.lineupValue - a.player.lineupValue)
            .map((entry) => (
              <li key={entry.player.id} className="flex items-center gap-3 bg-ink-900/60 p-3">
                <PositionChip position={entry.player.position} />
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-100">
                  {entry.player.name}
                </span>
                <span className="num text-[0.8125rem] text-now-400">
                  {value(entry.player.lineupValue)}
                </span>
                <span className={`num w-12 text-right text-[0.75rem] ${deltaClass(entry.marginalWinNow, 0.05)}`}>
                  {signed(entry.marginalWinNow)}
                </span>
              </li>
            ))}
        </ul>
      </Panel>
    </div>
  );
}
