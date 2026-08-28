import { useMemo, useState } from 'react';
import type { DraftPick, ValuedPlayer } from '../../engine/types';
import { pickKey, pickLabel } from '../../engine/picks';
import type { TradeSideResult } from '../../engine/trade';
import { useStore } from '../../state/store';
import { useTeamName } from '../useTeamName';
import { ContentionSlider } from '../components/ContentionSlider';
import { FinishMatrixHeatmap } from '../components/FinishMatrix';
import { PlayerTable } from '../components/PlayerTable';
import { blendedVar } from '../../engine/values';
import {
  Button,
  Callout,
  EmptyState,
  Panel,
  PanelHeader,
  PositionChip,
  Select,
  Toggle,
} from '../components/primitives';
import { deltaClass, ordinal, percent, signed, signedPercentPoints, value } from '../format';

interface SideState {
  rosterId: number;
  players: string[];
  picks: string[];
}

/**
 * The calculator shows three changes per side and never declares a winner. A
 * trade that is win now positive and long term negative is exactly right for a
 * contender and exactly wrong for a rebuilder.
 */
export function TradeView() {
  const rosters = useStore((s) => s.rosters);
  const values = useStore((s) => s.values);
  const picks = useStore((s) => s.picks);
  const userRosterId = useStore((s) => s.userRosterId);
  const scenario = useStore((s) => s.scenario);
  const setProposal = useStore((s) => s.setProposal);
  const evaluateProposal = useStore((s) => s.evaluateProposal);
  const tradeResult = useStore((s) => s.tradeResult);
  const tradeRunning = useStore((s) => s.tradeRunning);
  const teamName = useTeamName();
  const settings = useStore((s) => s.settings);

  const [a, setA] = useState<SideState>({
    rosterId: userRosterId ?? rosters[0]?.rosterId ?? 1,
    players: [],
    picks: [],
  });
  const [b, setB] = useState<SideState>({
    rosterId: rosters.find((r) => r.rosterId !== (userRosterId ?? rosters[0]?.rosterId))?.rosterId ?? 2,
    players: [],
    picks: [],
  });

  if (rosters.length === 0 || !scenario) {
    return (
      <Panel>
        <EmptyState title="The trade calculator needs a synced league">
          It re-runs the whole season simulation on the modified rosters and re-values every pick in
          the league from the new matrix. That needs real rosters and real pick ownership.
        </EmptyState>
      </Panel>
    );
  }

  const empty = a.players.length + a.picks.length + b.players.length + b.picks.length === 0;

  const submit = () => {
    setProposal({
      a: { rosterId: a.rosterId, players: a.players, picks: a.picks },
      b: { rosterId: b.rosterId, players: b.players, picks: b.picks },
    });
    void evaluateProposal();
  };

  const clear = () => {
    setA({ ...a, players: [], picks: [] });
    setB({ ...b, players: [], picks: [] });
    setProposal(null);
  };

  return (
    <div className="space-y-4">
      <ContentionSlider compact />

      <div className="grid gap-4 lg:grid-cols-2">
        <SideBuilder
          title="Your side gives"
          side={a}
          onChange={setA}
          otherRosterId={b.rosterId}
          highlight="blend"
        />
        <SideBuilder
          title="Their side gives"
          side={b}
          onChange={setB}
          otherRosterId={a.rosterId}
          highlight="now"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={submit} disabled={empty || tradeRunning}>
          {tradeRunning ? 'Re-running the season…' : 'Evaluate trade'}
        </Button>
        <Button onClick={clear} disabled={empty}>
          Clear
        </Button>
        <span className="text-[0.75rem] text-ink-500">
          Both scenarios run under the same seed, so the difference is the trade, not noise.
        </span>
      </div>

      {tradeResult ? (
        <TradeResultPanels
          result={tradeResult}
          teamName={teamName}
          picks={picks}
          values={values}
          deadZoneThreshold={settings.deadZoneThreshold}
          payoutIsWinnerTakeAll={
            settings.payoutWeights.length === 1 && settings.payoutWeights[0] === 1
          }
        />
      ) : null}
    </div>
  );
}

function SideBuilder({
  title,
  side,
  onChange,
  otherRosterId,
  highlight,
}: {
  title: string;
  side: SideState;
  onChange: (side: SideState) => void;
  otherRosterId: number;
  highlight: 'blend' | 'now';
}) {
  const rosters = useStore((s) => s.rosters);
  const values = useStore((s) => s.values);
  const allPicks = useStore((s) => s.picks);
  const weight = useStore((s) => s.settings.contentionWeight);
  const teamName = useTeamName();
  const [tab, setTab] = useState<'players' | 'picks'>('players');

  const roster = rosters.find((r) => r.rosterId === side.rosterId);
  const rosterPlayers = useMemo(
    () =>
      (roster?.playerIds ?? [])
        .map((id) => values.get(id))
        .filter(Boolean) as ValuedPlayer[],
    [roster, values],
  );
  const rosterPicks = useMemo(
    () => allPicks.filter((p) => p.ownerRosterId === side.rosterId),
    [allPicks, side.rosterId],
  );

  const selectedPlayers = side.players
    .map((id) => values.get(id))
    .filter(Boolean) as ValuedPlayer[];
  const selectedPicks = side.picks
    .map((key) => allPicks.find((p) => pickKey(p) === key))
    .filter(Boolean) as DraftPick[];

  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const accent = highlight === 'blend' ? 'text-blend-400' : 'text-now-400';

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title={<span className={accent}>{title}</span>}
        right={
          <Select
            value={String(side.rosterId)}
            onChange={(v) => onChange({ rosterId: Number(v), players: [], picks: [] })}
            options={rosters
              .filter((r) => r.rosterId !== otherRosterId)
              .map((r) => ({ value: String(r.rosterId), label: teamName(r.rosterId) }))}
          />
        }
      />

      {selectedPlayers.length + selectedPicks.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 border-b border-white/[0.06] px-4 py-3 sm:px-5">
          {selectedPlayers.map((p) => {
            const vor = blendedVar(p, weight);
            return (
              <li key={p.id}>
                <button
                  onClick={() => onChange({ ...side, players: toggle(side.players, p.id) })}
                  title={`Value over replacement at this timeline: ${signed(vor)}`}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] py-1 pl-1.5 pr-2 text-[0.75rem] text-ink-100 transition hover:border-bad-500/40"
                >
                  <PositionChip position={p.position} />
                  {p.name}
                  {/* The column the table gave up, returned where it matters:
                      what this specific player is worth over the wire. */}
                  <span className={`num ${deltaClass(vor, 0.05)}`}>{signed(vor)}</span>
                  <span className="text-ink-500">×</span>
                </button>
              </li>
            );
          })}
          {selectedPicks.map((pick) => (
            <li key={pickKey(pick)}>
              <button
                onClick={() => onChange({ ...side, picks: toggle(side.picks, pickKey(pick)) })}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[0.75rem] text-ink-100 transition hover:border-bad-500/40"
              >
                {pickLabel(pick, teamName(pick.originalRosterId))}
                <span className="text-ink-500">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5 sm:px-5">
        <Toggle
          size="sm"
          value={tab}
          onChange={(v) => setTab(v as 'players' | 'picks')}
          options={[
            { value: 'players', label: `Players (${rosterPlayers.length})` },
            { value: 'picks', label: `Picks (${rosterPicks.length})` },
          ]}
        />
      </div>

      {tab === 'players' ? (
        <div className="max-h-[26rem] overflow-y-auto">
          <PlayerTable
            players={rosterPlayers}
            weight={weight}
            teamName={teamName}
            showOwner={false}
            pageSize={40}
            // Half-width panel: five metric columns pushed the Add button past
            // the right edge. Rating and the two horizons are what a trade is
            // built on; value over replacement comes back per player below,
            // once one is actually selected.
            metrics={['rating', 'winNow', 'longTerm']}
            rowAction={(player) => (
              <Button
                size="sm"
                variant={side.players.includes(player.id) ? 'primary' : 'ghost'}
                onClick={() => onChange({ ...side, players: toggle(side.players, player.id) })}
              >
                {side.players.includes(player.id) ? 'In' : 'Add'}
              </Button>
            )}
          />
        </div>
      ) : (
        <ul className="max-h-[26rem] divide-y divide-white/[0.04] overflow-y-auto">
          {rosterPicks.length === 0 ? (
            <li className="px-4 py-8 text-center text-[0.8125rem] text-ink-400 sm:px-5">
              This team holds no picks in the covered seasons.
            </li>
          ) : null}
          {rosterPicks
            .sort((x, y) => x.season - y.season || x.round - y.round)
            .map((pick) => {
              const key = pickKey(pick);
              const own = pick.originalRosterId === pick.ownerRosterId;
              return (
                <li key={key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.8125rem] font-medium text-ink-100">
                      {pick.season} round {pick.round}
                    </div>
                    <div className="text-[0.6875rem] text-ink-400">
                      {own ? 'own pick' : `via ${teamName(pick.originalRosterId)}`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={side.picks.includes(key) ? 'primary' : 'ghost'}
                    onClick={() => onChange({ ...side, picks: toggle(side.picks, key) })}
                  >
                    {side.picks.includes(key) ? 'In' : 'Add'}
                  </Button>
                </li>
              );
            })}
        </ul>
      )}
    </Panel>
  );
}

function TradeResultPanels({
  result,
  teamName,
  values,
  deadZoneThreshold,
  payoutIsWinnerTakeAll,
}: {
  result: import('../../engine/trade').TradeResult;
  teamName: (rosterId: number) => string;
  picks: DraftPick[];
  values: Map<string, ValuedPlayer>;
  deadZoneThreshold: number;
  payoutIsWinnerTakeAll: boolean;
}) {
  const [sideA, sideB] = result.sides;

  return (
    <div className="space-y-4 animate-rise">
      {result.positiveForBoth ? (
        <Callout tone="good" title="Positive for both teams on every metric">
          Championship equity, long term value and draft capital all move the right way for both
          sides. Trades shaped like this are the ones that actually get accepted.
        </Callout>
      ) : null}

      {result.deadZone
        .filter((verdict) => verdict.triggered || verdict.message)
        .map((verdict) => (
          <Callout
            key={verdict.rosterId}
            tone={verdict.kind === 'dead_zone' ? 'bad' : verdict.kind === 'justified_push' ? 'good' : 'info'}
            title={`${teamName(verdict.rosterId)} · ${
              verdict.kind === 'dead_zone'
                ? 'dead zone warning'
                : verdict.kind === 'justified_push'
                  ? 'justified push'
                  : 'coupling note'
            }`}
          >
            {verdict.message}
            {verdict.offsettingPicks.length > 0 ? (
              <ul className="mt-2 space-y-0.5">
                {verdict.offsettingPicks.slice(0, 4).map((p) => (
                  <li key={p.key} className="num text-[0.75rem]">
                    {p.pick.season} rd {p.pick.round} via {teamName(p.originalRosterId)}:{' '}
                    <span className={deltaClass(p.delta)}>{signed(p.delta, 2)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Callout>
        ))}

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Three changes per side"
          subtitle="No verdict. Read these against the timeline slider and your own situation."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[0.8125rem]">
            <thead className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-400">
              <tr className="border-b border-white/[0.06]">
                <th className="py-2.5 pl-4 text-left font-medium sm:pl-5">Change</th>
                <th className="px-3 py-2.5 text-right font-medium text-blend-400">
                  {teamName(sideA.rosterId)}
                </th>
                <th className="py-2.5 pr-4 text-right font-medium text-now-400 sm:pr-5">
                  {teamName(sideB.rosterId)}
                </th>
              </tr>
            </thead>
            <tbody>
              <MetricRow
                label={payoutIsWinnerTakeAll ? 'Championship probability' : 'Expected payout'}
                hint="From the finish matrix, re-simulated on the modified rosters"
                a={signedPercentPoints(sideA.payoutDelta)}
                b={signedPercentPoints(sideB.payoutDelta)}
                aValue={sideA.payoutDelta}
                bValue={sideB.payoutDelta}
              />
              <MetricRow
                label="Long term value"
                hint="Sum of long term values gained minus lost. An independent measurement, never derived by subtraction."
                a={signed(sideA.longTermDelta)}
                b={signed(sideB.longTermDelta)}
                aValue={sideA.longTermDelta}
                bValue={sideB.longTermDelta}
              />
              <MetricRow
                label="Draft capital"
                hint="Every pick this side owns, re-valued against the new finish distributions"
                a={signed(sideA.draftCapitalDelta)}
                b={signed(sideB.draftCapitalDelta)}
                aValue={sideA.draftCapitalDelta}
                bValue={sideB.draftCapitalDelta}
              />
              <tr className="border-b border-white/[0.035]">
                <td className="py-2.5 pl-4 text-ink-300 sm:pl-5">Projected finish</td>
                <td className="num px-3 py-2.5 text-right text-ink-300">
                  {ordinal(sideA.expectedFinishBefore)} → {ordinal(sideA.expectedFinishAfter)}
                </td>
                <td className="num py-2.5 pr-4 text-right text-ink-300 sm:pr-5">
                  {ordinal(sideB.expectedFinishBefore)} → {ordinal(sideB.expectedFinishAfter)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-white/[0.06] px-4 py-3 text-[0.75rem] leading-relaxed text-ink-400 sm:px-5">
          Evaluated from both sides using each team's own roster, lineup and pick holdings, so you
          can see whether the offer has any chance of being accepted. Dead zone threshold:{' '}
          {percent(deadZoneThreshold, 1)} of championship equity.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <PickBreakdown side={sideA} teamName={teamName} />
        <PickBreakdown side={sideB} teamName={teamName} />
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Matrix delta"
          subtitle="Where probability moved, cell by cell, for every team in the league. This is where a trade stops being three numbers and becomes legible."
        />
        <FinishMatrixHeatmap
          matrix={result.matrixDelta}
          teamName={teamName}
          mode="delta"
          highlightRosterId={sideA.rosterId}
          caption="Green gained probability, rose lost it. Every row and every column sums to zero: probability is redistributed, never created."
        />
      </Panel>

      <Panel>
        <PanelHeader
          title="Assets exchanged"
          subtitle="What each side gives up and receives, at current values."
        />
        <div className="grid gap-px bg-white/[0.05] sm:grid-cols-2">
          {[sideA, sideB].map((side) => (
            <div key={side.rosterId} className="bg-ink-900/60 p-4 sm:p-5">
              <div className="text-[0.8125rem] font-semibold text-ink-100">
                {teamName(side.rosterId)}
              </div>
              <AssetList label="Out" players={side.playersOut} picks={side.picksOut} teamName={teamName} values={values} />
              <AssetList label="In" players={side.playersIn} picks={side.picksIn} teamName={teamName} values={values} />
            </div>
          ))}
        </div>
      </Panel>

      <Callout tone="info" title="Draft capital is redistributed, not created">
        Across the whole league, draft capital before this trade totalled{' '}
        <span className="num">{value(result.leagueCapitalBefore, 1)}</span> and after it totals{' '}
        <span className="num">{value(result.leagueCapitalAfter, 1)}</span> — a drift of{' '}
        <span className="num">{signed(result.leagueCapitalDrift, 2)}</span>, which is Monte Carlo
        sampling error rather than value appearing from nowhere. Anything larger would be a bug.
      </Callout>
    </div>
  );
}

function MetricRow({
  label,
  hint,
  a,
  b,
  aValue,
  bValue,
}: {
  label: string;
  hint: string;
  a: string;
  b: string;
  aValue: number;
  bValue: number;
}) {
  return (
    <tr className="border-b border-white/[0.035]">
      <td className="py-2.5 pl-4 sm:pl-5">
        <div className="font-medium text-ink-100">{label}</div>
        <div className="mt-0.5 max-w-xs text-[0.6875rem] leading-snug text-ink-400">{hint}</div>
      </td>
      <td className={`num px-3 py-2.5 text-right text-base font-semibold ${deltaClass(aValue)}`}>
        {a}
      </td>
      <td className={`num py-2.5 pr-4 text-right text-base font-semibold sm:pr-5 ${deltaClass(bValue)}`}>
        {b}
      </td>
    </tr>
  );
}

function PickBreakdown({
  side,
  teamName,
}: {
  side: TradeSideResult;
  teamName: (rosterId: number) => string;
}) {
  const moved = side.pickBreakdown.filter((p) => Math.abs(p.delta) > 1e-6 || p.moved);
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title={`${teamName(side.rosterId)} · draft capital, pick by pick`}
        subtitle="The composition is the insight. A near-zero total can hide a large loss on an own pick offset by a large gain on an acquired one."
      />
      {moved.length === 0 ? (
        <p className="px-4 py-6 text-center text-[0.8125rem] text-ink-400 sm:px-5">
          This side holds no picks in the covered seasons.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.04]">
          {moved.slice(0, 12).map((entry) => (
            <li key={entry.key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="text-[0.8125rem] text-ink-100">
                  {entry.pick.season} round {entry.pick.round}
                  {entry.originalRosterId === side.rosterId ? (
                    <span className="ml-1.5 text-[0.6875rem] text-ink-500">own</span>
                  ) : (
                    <span className="ml-1.5 text-[0.6875rem] text-ink-500">
                      via {teamName(entry.originalRosterId)}
                    </span>
                  )}
                  {entry.moved ? (
                    <span className="ml-1.5 rounded bg-white/[0.08] px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-ink-300">
                      traded
                    </span>
                  ) : null}
                </div>
                <div className="num mt-0.5 text-[0.6875rem] text-ink-400">
                  {value(entry.before, 2)} → {value(entry.after, 2)}
                </div>
              </div>
              <span className={`num text-[0.875rem] font-semibold ${deltaClass(entry.delta, 1e-4)}`}>
                {signed(entry.delta, 2)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2.5 text-[0.8125rem] sm:px-5">
        <span className="text-ink-400">Net draft capital</span>
        <span className={`num font-semibold ${deltaClass(side.draftCapitalDelta)}`}>
          {signed(side.draftCapitalDelta, 2)}
        </span>
      </div>
    </Panel>
  );
}

function AssetList({
  label,
  players,
  picks,
  teamName,
}: {
  label: string;
  players: ValuedPlayer[];
  picks: DraftPick[];
  teamName: (rosterId: number) => string;
  values: Map<string, ValuedPlayer>;
}) {
  if (players.length + picks.length === 0) {
    return (
      <div className="mt-3">
        <div className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-500">
          {label}
        </div>
        <div className="mt-1 text-[0.75rem] text-ink-500">nothing</div>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-500">
        {label}
      </div>
      <ul className="mt-1 space-y-1">
        {players.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-[0.8125rem]">
            <PositionChip position={p.position} />
            <span className="min-w-0 flex-1 truncate text-ink-200">{p.name}</span>
            <span className="num text-now-400">{value(p.winNow)}</span>
            <span className="num text-later-400">{value(p.longTerm)}</span>
          </li>
        ))}
        {picks.map((pick) => (
          <li key={pickKey(pick)} className="text-[0.8125rem] text-ink-200">
            {pickLabel(pick, teamName(pick.originalRosterId))}
          </li>
        ))}
      </ul>
    </div>
  );
}
