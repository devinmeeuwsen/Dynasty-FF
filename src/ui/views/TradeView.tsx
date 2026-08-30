import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftPick, ValuedPlayer } from '../../engine/types';
import { pickKey, pickLabel } from '../../engine/picks';
import { IDLE_SHARE, sideGain, type SideGain, type TradeSideResult } from '../../engine/trade';
import type { UsageReading } from '../../engine/usage';
import { assessPosture, POSTURE_COPY } from '../../engine/posture';
import type { Scenario } from '../../engine/scenario';
import { useStore } from '../../state/store';
import { useTeamName } from '../useTeamName';
import { ContentionSlider } from '../components/ContentionSlider';
import { FinishMatrixHeatmap } from '../components/FinishMatrix';
import { PlayerTable } from '../components/PlayerTable';
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
import {
  TIMELINE_LABEL,
  deltaClass,
  ordinal,
  percent,
  signed,
  signedPercentPoints,
  timelineClass,
  timelineOf,
  value,
} from '../format';

interface SideState {
  rosterId: number;
  players: string[];
  picks: string[];
}

/** Long enough that adding three players fires one run, short enough to feel live. */
const AUTO_EVALUATE_MS = 300;

/**
 * The calculator never declares a winner. A trade that is win now positive and
 * long term negative is exactly right for a contender and exactly wrong for a
 * rebuilder, so the output is two readings — one per side, each in that side's
 * own currency — and the reader decides.
 */
export function TradeView() {
  const rosters = useStore((s) => s.rosters);
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

  const aFilled = a.players.length + a.picks.length > 0;
  const bFilled = b.players.length + b.picks.length > 0;
  const ready = aFilled && bFilled;
  const empty = !aFilled && !bFilled;

  /**
   * The trade evaluates itself. There is no Evaluate button because there is no
   * question it would answer: the proposal in front of you is the one you want
   * priced, and a button only ever lets the panel below disagree with the panel
   * above. Debounced, so building a three player side runs the season once
   * rather than three times, and the store drops any reply that arrives after a
   * newer edit.
   */
  const key = `${a.rosterId}:${[...a.players].sort().join(',')}:${[...a.picks].sort().join(',')}|` +
    `${b.rosterId}:${[...b.players].sort().join(',')}:${[...b.picks].sort().join(',')}`;
  const ranFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !scenario) return;
    if (ranFor.current === key) return;
    const timer = setTimeout(() => {
      ranFor.current = key;
      setProposal({
        a: { rosterId: a.rosterId, players: a.players, picks: a.picks },
        b: { rosterId: b.rosterId, players: b.players, picks: b.picks },
      });
      void evaluateProposal();
    }, AUTO_EVALUATE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, scenario]);

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

  const clear = () => {
    ranFor.current = null;
    setA({ ...a, players: [], picks: [] });
    setB({ ...b, players: [], picks: [] });
    setProposal(null);
  };

  const showResult = tradeResult && ready;

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
        <Button onClick={clear} disabled={empty}>
          Clear
        </Button>
        <span className="text-[0.75rem] text-ink-500">
          {tradeRunning
            ? 'Re-running the season on both rosters…'
            : ready
              ? 'Updates itself on every change. Both scenarios run under the same seed, so the difference is the trade, not noise.'
              : 'Put at least one asset on each side.'}
        </span>
      </div>

      {showResult ? (
        <TradeResultPanels
          result={tradeResult}
          teamName={teamName}
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
  const teamName = useTeamName();
  const teams = useStore((s) => s.shape.teams);
  // Baseline valuations, so a pick shows what it is worth before the trade is
  // evaluated rather than only after.
  const pickValuations = useStore((s) => s.scenario?.pickValues);
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

  /**
   * The originating team is named only when it is somebody else's pick. On your
   * own pick the name is the team you are already looking at, and repeating it
   * on every row buries the half of the label that carries information.
   */
  const labelFor = (pick: DraftPick) =>
    pickLabel(
      pick,
      pick.originalRosterId === side.rosterId ? undefined : teamName(pick.originalRosterId),
    );

  const rangeOf = (key: string) => {
    const valuation = pickValuations?.get(key);
    if (!valuation) return null;
    return `${formatSlot(valuation.slotRange[0], teams)}–${formatSlot(valuation.slotRange[1], teams)}`;
  };

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

      {/* Selected assets get the full attribute set rather than a chip.
          Once something is actually in the deal, every number the model has
          assigned it is the thing worth reading — that is the moment the
          question stops being "who is available" and becomes "what am I
          actually giving up". */}
      {selectedPlayers.length + selectedPicks.length > 0 ? (
        <ul className="divide-y divide-white/[0.05] border-b border-white/[0.06]">
          {selectedPlayers.map((p) => (
            <li key={p.id} className="px-4 py-3 sm:px-5">
              <div className="flex items-start gap-2.5">
                <PositionChip position={p.position} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.875rem] font-semibold text-ink-100">
                    {p.name}
                  </div>
                  <div className="num text-[0.6875rem] text-ink-500">
                    {p.team ?? 'FA'}
                    {p.age != null ? ` · ${p.age}yo` : ''}
                  </div>
                </div>
                <button
                  onClick={() => onChange({ ...side, players: toggle(side.players, p.id) })}
                  aria-label={`Remove ${p.name} from this side`}
                  className="focus-ring rounded-lg border border-white/10 px-2 py-0.5 text-[0.75rem] text-ink-400 transition hover:border-bad-500/40 hover:text-ink-200"
                >
                  ×
                </button>
              </div>
              <dl className="num mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[0.6875rem]">
                <Attr label="Rating" value={value(p.rating)} tone="text-blend-400" />
                <Attr label="Redraft" value={value(p.redraft)} tone="text-now-400" />
                <Attr
                  label={TIMELINE_LABEL[timelineOf(p.longTerm)]}
                  value={signed(p.longTerm)}
                  tone={timelineClass(p.longTerm)}
                />
                {/* Both value-over-replacement figures, each against its own
                    board, rather than one number mixing them by a slider. The
                    card used to carry a blended VAR and a blended rating, which
                    disagreed with the players table and moved when nothing
                    about the player had. */}
                <Attr
                  label="VAR"
                  value={signed(p.ratingVar)}
                  tone={deltaClass(p.ratingVar, 0.05)}
                />
                <Attr
                  label="Redraft VAR"
                  value={signed(p.redraftVar)}
                  tone={deltaClass(p.redraftVar, 0.05)}
                />
              </dl>
            </li>
          ))}
          {selectedPicks.map((pick) => {
            const valuation = pickValuations?.get(pickKey(pick));
            return (
              <li key={pickKey(pick)} className="px-4 py-3 sm:px-5">
                <div className="flex items-start gap-2.5">
                  <span className="rounded-md bg-later-500/15 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-later-400 ring-1 ring-later-500/30">
                    Pick
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.875rem] font-semibold text-ink-100">
                      {labelFor(pick)}
                    </div>
                    <div className="num text-[0.6875rem] text-ink-500">
                      {rangeOf(pickKey(pick)) ?? ''}
                    </div>
                  </div>
                  <button
                    onClick={() => onChange({ ...side, picks: toggle(side.picks, pickKey(pick)) })}
                    aria-label={`Remove ${pickLabel(pick)} from this side`}
                    className="focus-ring rounded-lg border border-white/10 px-2 py-0.5 text-[0.75rem] text-ink-400 transition hover:border-bad-500/40 hover:text-ink-200"
                  >
                    ×
                  </button>
                </div>
                {valuation ? (
                  <dl className="num mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[0.6875rem]">
                    <Attr label="Rating" value={value(valuation.rating)} tone="text-blend-400" />
                    <Attr
                      label="VAR"
                      value={signed(valuation.value)}
                      tone={deltaClass(valuation.value, 0.05)}
                    />
                    <Attr label="Redraft" value="0.0" tone="text-ink-500" />
                    <Attr
                      label="Likely slot"
                      value={formatSlot(Math.round(
                        (pick.round - 1) * teams + valuation.expectedSlot,
                      ), teams)}
                      tone="text-ink-300"
                    />
                    <Attr
                      label="Range"
                      value={`${formatSlot(valuation.slotRange[0], teams)}–${formatSlot(valuation.slotRange[1], teams)}`}
                      tone="text-ink-300"
                    />
                  </dl>
                ) : (
                  <p className="mt-2 text-[0.6875rem] text-ink-500">
                    Value appears once the baseline simulation has run.
                  </p>
                )}
              </li>
            );
          })}
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
              return (
                <li key={key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.8125rem] font-medium text-ink-100">
                      {labelFor(pick)}
                    </div>
                    <div className="num text-[0.6875rem] text-ink-400">{rangeOf(key) ?? ''}</div>
                  </div>
                  {pickValuations?.get(key) ? (
                    <div className="num text-right text-[0.8125rem] font-semibold text-later-400">
                      {value(pickValuations.get(key)!.rating)}
                    </div>
                  ) : null}
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

/**
 * The scale.
 *
 * KeepTradeCut's calculator puts one bar across the middle and tips it toward
 * whoever "won". That question does not survive contact with dynasty: a
 * contender buying this season and a rebuilder selling it are not competing for
 * the same thing, and a deal can be genuinely good for both. So there are two
 * bars, one per team, each measuring that team's gain against ITS OWN goals.
 *
 * The weight per side starts where the simulation puts that team and stays
 * draggable, because a manager can know something the model does not — that the
 * team across from you is about to tear it down. Dragging one side never moves
 * the other; the whole point is that the two can disagree.
 */
function TradeScale({
  sides,
  before,
  teamName,
}: {
  sides: [TradeSideResult, TradeSideResult];
  before: Scenario;
  teamName: (rosterId: number) => string;
}) {
  const derived = useMemo(() => {
    const out = new Map<number, { weight: number; label: string }>();
    for (const side of sides) {
      const posture = assessPosture(before, side.rosterId);
      out.set(side.rosterId, {
        weight: posture.weight,
        label: POSTURE_COPY[posture.posture].label,
      });
    }
    return out;
  }, [sides, before]);

  const [overrides, setOverrides] = useState<Record<number, number>>({});
  // A new pair of teams should not inherit the last pair's dragged weights.
  const pairKey = sides.map((s) => s.rosterId).join(':');
  const lastPair = useRef(pairKey);
  useEffect(() => {
    if (lastPair.current !== pairKey) {
      lastPair.current = pairKey;
      setOverrides({});
    }
  }, [pairKey]);

  const gains: SideGain[] = sides.map((side) =>
    sideGain(side, overrides[side.rosterId] ?? derived.get(side.rosterId)?.weight ?? 0.5),
  );

  const scale = Math.max(
    1,
    ...gains.flatMap((g) => [Math.abs(g.gained), Math.abs(g.winNow), Math.abs(g.future)]),
  );

  return (
    <Panel className="overflow-hidden animate-rise">
      <PanelHeader
        title="What each side gains"
        subtitle="Two teams with different goals can both come out ahead, so there is no combined bar and no winner. Each reading is that team's own blend of this season and everything after it."
      />
      <div className="divide-y divide-white/[0.05]">
        {gains.map((gain, i) => {
          const weight = gain.weight;
          const meta = derived.get(gain.rosterId);
          const overridden = overrides[gain.rosterId] != null;
          return (
            <div key={gain.rosterId} className="px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`text-[0.9375rem] font-semibold ${
                      i === 0 ? 'text-blend-400' : 'text-now-400'
                    }`}
                  >
                    {teamName(gain.rosterId)}
                  </span>
                  <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[0.625rem] uppercase tracking-wide text-ink-300">
                    {meta?.label ?? 'balanced'}
                  </span>
                  {overridden ? (
                    <button
                      onClick={() =>
                        setOverrides((prev) => {
                          const next = { ...prev };
                          delete next[gain.rosterId];
                          return next;
                        })
                      }
                      className="focus-ring rounded-full border border-white/15 px-2 py-0.5 text-[0.625rem] text-ink-400 transition hover:text-ink-200"
                    >
                      reset to their odds
                    </button>
                  ) : null}
                </div>
                <span className={`num text-lg font-semibold ${deltaClass(gain.gained, 0.05)}`}>
                  {signed(gain.gained, 1)}
                </span>
              </div>

              <GainBar gained={gain.gained} scale={scale} />

              <div className="num mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem]">
                <span className="text-ink-500">
                  This season{' '}
                  <span className={deltaClass(gain.winNow, 0.05)}>{signed(gain.winNow, 1)}</span>
                </span>
                <span className="text-ink-500">
                  Everything after{' '}
                  <span className={deltaClass(gain.future, 0.05)}>{signed(gain.future, 1)}</span>
                </span>
                <span className="text-ink-500">
                  Title odds{' '}
                  <span className={deltaClass(sides[i].payoutDelta, 1e-4)}>
                    {signedPercentPoints(sides[i].payoutDelta)}
                  </span>
                </span>
              </div>

              <div className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={weight}
                  aria-label={`${teamName(gain.rosterId)} goal: win now versus the future`}
                  onChange={(e) =>
                    setOverrides((prev) => ({
                      ...prev,
                      [gain.rosterId]: Number(e.target.value),
                    }))
                  }
                  className="timeline-slider flex-1"
                />
                <span className="num w-32 shrink-0 text-right text-[0.6875rem] text-ink-500">
                  {Math.round(weight * 100)}% win now
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t border-white/[0.06] px-4 py-3 text-[0.75rem] leading-relaxed text-ink-400 sm:px-5">
        Both readings are in value above replacement, the same units as every rating on the players
        screen. Drag either slider to ask what the deal looks like if that team's plan is different
        from the one the simulation infers.
      </p>
    </Panel>
  );
}

/** A diverging bar centred on zero, so a loss reads as a loss without a label. */
function GainBar({ gained, scale }: { gained: number; scale: number }) {
  const magnitude = Math.min(1, Math.abs(gained) / scale);
  const width = `${(magnitude * 50).toFixed(2)}%`;
  const positive = gained >= 0;
  return (
    <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
      <div
        className={`absolute inset-y-0 rounded-full ${positive ? 'bg-good-500/80' : 'bg-bad-500/80'}`}
        style={positive ? { left: '50%', width } : { right: '50%', width }}
      />
    </div>
  );
}

function TradeResultPanels({
  result,
  teamName,
  deadZoneThreshold,
  payoutIsWinnerTakeAll,
}: {
  result: import('../../engine/trade').TradeResult;
  teamName: (rosterId: number) => string;
  deadZoneThreshold: number;
  payoutIsWinnerTakeAll: boolean;
}) {
  const [sideA, sideB] = result.sides;

  return (
    <div className="space-y-4 animate-rise">
      <TradeScale sides={result.sides} before={result.before} teamName={teamName} />

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
          title="Every change, per side"
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
                label="This season — team strength"
                hint="Starting lineup plus the backup line, which is what the season simulation actually runs on."
                a={signed(sideA.strengthDelta)}
                b={signed(sideB.strengthDelta)}
                aValue={sideA.strengthDelta}
                bValue={sideB.strengthDelta}
              />
              <MetricRow
                label={payoutIsWinnerTakeAll ? 'Championship probability' : 'Expected payout'}
                hint="What that strength buys, from the finish matrix re-simulated on the modified rosters"
                a={signedPercentPoints(sideA.payoutDelta)}
                b={signedPercentPoints(sideB.payoutDelta)}
                aValue={sideA.payoutDelta}
                bValue={sideB.payoutDelta}
              />
              <MetricRow
                label="Long term — players"
                hint="Long term value of players gained minus lost. An independent measurement, never derived by subtraction."
                a={signed(sideA.longTermDelta)}
                b={signed(sideB.longTermDelta)}
                aValue={sideA.longTermDelta}
                bValue={sideB.longTermDelta}
              />
              <MetricRow
                label="Long term — picks"
                hint="Every pick this side owns, re-valued against the new finish distributions. A pick is a long term asset only: a future rookie plays no games this season."
                a={signed(sideA.draftCapitalDelta)}
                b={signed(sideB.draftCapitalDelta)}
                aValue={sideA.draftCapitalDelta}
                bValue={sideB.draftCapitalDelta}
              />
              {/* Split above because composition matters, totalled here
                  because the split otherwise leaves the reader adding two
                  numbers to answer the obvious question. */}
              <MetricRow
                label="Long term — combined"
                hint="Players plus picks. The whole change to this side's future, in one number."
                a={signed(sideA.longTermDelta + sideA.draftCapitalDelta)}
                b={signed(sideB.longTermDelta + sideB.draftCapitalDelta)}
                aValue={sideA.longTermDelta + sideA.draftCapitalDelta}
                bValue={sideB.longTermDelta + sideB.draftCapitalDelta}
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

      <RosterSpots sides={result.sides} teamName={teamName} />

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
          subtitle="What the market pays for each player, what he is worth to a team that starts him, and what this roster actually gets. The last two are measured over the same three seasons, so the gap between them is real: it is value the roster cannot extract, and it is why a trade can be good for both sides at once."
        />
        <div className="grid gap-px bg-white/[0.05] sm:grid-cols-2">
          {[sideA, sideB].map((side) => (
            <div key={side.rosterId} className="bg-ink-900/60 p-4 sm:p-5">
              <div className="text-[0.8125rem] font-semibold text-ink-100">
                {teamName(side.rosterId)}
              </div>
              <AssetList
                label="Out"
                players={side.playersOut}
                picks={side.picksOut}
                usage={side.outgoingUsage}
                teamName={teamName}
              />
              <AssetList
                label="In"
                players={side.playersIn}
                picks={side.picksIn}
                usage={side.incomingUsage}
                teamName={teamName}
              />
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

/**
 * Roster spots, priced from both directions.
 *
 * A freed seat is worth an option, not a player. The free agent who fills it is
 * worth exactly zero above replacement — replacement level IS the best free
 * agent — but you may keep him if he climbs and drop him for nothing if he does
 * not, then draw again. The average draw is worthless; the right to keep the
 * good ones is not, and that is what the seat earns.
 *
 * The cost of not having a seat is the other half. A team at its limit that
 * takes back more bodies than it sends has to release someone it chose over the
 * wire, and that release is charged here.
 */
function RosterSpots({
  sides,
  teamName,
}: {
  sides: [TradeSideResult, TradeSideResult];
  teamName: (rosterId: number) => string;
}) {
  const interesting = sides.some(
    (s) => s.rosterSpots.cuts.length > 0 || s.rosterSpots.freed > 0,
  );
  if (!interesting) return null;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Roster spots"
        subtitle="Bodies in and out, and what the roster limit does about it."
      />
      <div className="grid gap-px bg-white/[0.05] sm:grid-cols-2">
        {sides.map((side) => {
          const spots = side.rosterSpots;
          return (
            <div key={side.rosterId} className="bg-ink-900/60 p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[0.8125rem] font-semibold text-ink-100">
                  {teamName(side.rosterId)}
                </span>
                <span className="num text-[0.6875rem] text-ink-500">
                  {spots.before} → {spots.after} of {spots.capacity}
                </span>
              </div>

              {spots.cuts.length > 0 ? (
                <div className="mt-2">
                  <div className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-bad-500">
                    Must release {spots.cuts.length}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {spots.cuts.map((cut) => (
                      <li
                        key={cut.player.id}
                        className="flex items-center gap-2 text-[0.8125rem]"
                      >
                        <PositionChip position={cut.player.position} />
                        <span className="min-w-0 flex-1 truncate text-ink-200">
                          {cut.player.name}
                        </span>
                        <span className={`num ${deltaClass(cut.strengthDelta, 0.01)}`}>
                          {signed(cut.strengthDelta, 1)}
                        </span>
                        <span className={`num ${deltaClass(cut.assetDelta, 0.01)}`}>
                          {signed(cut.assetDelta, 1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-ink-500">
                    Cheapest legal cut, chosen by what it costs this lineup rather than by raw
                    rating. This season's loss first, long term loss second.
                  </p>
                </div>
              ) : null}

              {spots.freed > 0 ? (
                <div className="mt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-good-500">
                      {spots.freed} spot{spots.freed === 1 ? '' : 's'} freed
                    </div>
                    <span className="num text-[0.875rem] font-semibold text-good-500">
                      {signed(spots.optionValue, 1)}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-1">
                    {spots.adds.map((add) => (
                      <li key={add.player.id} className="flex items-center gap-2 text-[0.8125rem]">
                        <PositionChip position={add.player.position} />
                        <span className="min-w-0 flex-1 truncate text-ink-200">
                          {add.player.name}
                        </span>
                        <span className="num text-[0.6875rem] text-ink-600">
                          {value(add.player.rating)} rating · {signed(add.strengthDelta, 1)} over
                          replacement
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-ink-500">
                    Best available today, and worth nothing over replacement — by definition, since
                    replacement level IS the best free agent. The{' '}
                    <span className="num text-good-500">{signed(spots.optionValue, 1)}</span> is the
                    seat, not the signing: you may keep whoever climbs and drop whoever does not,
                    then draw again. It counts toward this season and toward the future both, at
                    the same size, because a wire breakout serves a contender as depth and a
                    rebuilder as an asset.
                  </p>
                </div>
              ) : null}

              {spots.cuts.length === 0 && spots.freed === 0 ? (
                <p className="mt-2 text-[0.75rem] text-ink-500">
                  Even bodies. No seat freed, nothing to release.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
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
                  {entry.originalRosterId === side.rosterId ? null : (
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

/**
 * Every player who moves, with the two numbers that decide whether the deal
 * makes sense: what the market pays for him, and what the roster he sits on is
 * actually getting.
 *
 * A receiver behind two starters and a backup can be worth ten points to
 * somebody and zero here. Reading only the market number makes converting him
 * into a pick look like a plain loss; reading both makes it obvious.
 */
function AssetList({
  label,
  players,
  picks,
  usage,
  teamName,
}: {
  label: string;
  players: ValuedPlayer[];
  picks: DraftPick[];
  usage: UsageReading[];
  teamName: (rosterId: number) => string;
}) {
  const byId = new Map(usage.map((u) => [u.playerId, u]));

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
      <div className="flex items-baseline justify-between">
        <div className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-500">
          {label}
        </div>
        <div className="num flex gap-3 text-[0.625rem] uppercase tracking-[0.06em] text-ink-600">
          <span>market</span>
          <span>if started</span>
          <span>your use</span>
        </div>
      </div>
      <ul className="mt-1 space-y-1">
        {players.map((p) => {
          const u = byId.get(p.id);
          // Surplus is the share of his usable value the roster never sees.
          const idle = u != null && u.horizon > 1 && u.idleShare >= IDLE_SHARE;
          return (
            <li key={p.id} className="flex items-center gap-2 text-[0.8125rem]">
              <PositionChip position={p.position} />
              <span className="min-w-0 flex-1 truncate text-ink-200">{p.name}</span>
              {idle ? (
                <span className="shrink-0 rounded bg-later-500/15 px-1.5 py-0.5 text-[0.5625rem] uppercase tracking-wide text-later-400">
                  surplus
                </span>
              ) : null}
              <span className="num w-10 text-right text-later-400">
                {value(u?.market ?? p.assetValue)}
              </span>
              <span className="num w-10 text-right text-ink-400">{value(u?.horizon ?? 0)}</span>
              <span
                className={`num w-10 text-right ${
                  idle ? 'text-later-400' : (u?.used ?? 0) > 0.05 ? 'text-now-400' : 'text-ink-600'
                }`}
              >
                {value(u?.used ?? 0)}
              </span>
            </li>
          );
        })}
        {picks.map((pick) => (
          <li key={pickKey(pick)} className="flex items-center gap-2 text-[0.8125rem]">
            <span className="min-w-0 flex-1 truncate text-ink-200">
              {pickLabel(pick, teamName(pick.originalRosterId))}
            </span>
            <span className="num w-10 text-right text-ink-600">—</span>
            <span className="num w-10 text-right text-ink-600">—</span>
            <span className="num w-10 text-right text-ink-600">0.0</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `1.04` from an overall slot, matching how picks are spoken about. */
function formatSlot(overall: number, teams: number): string {
  const round = Math.floor((overall - 1) / teams) + 1;
  const slot = ((overall - 1) % teams) + 1;
  return `${round}.${String(slot).padStart(2, '0')}`;
}

/** One labelled number inside a selected asset's attribute grid. */
function Attr({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.06em] text-ink-500">{label}</dt>
      <dd className={`font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}
