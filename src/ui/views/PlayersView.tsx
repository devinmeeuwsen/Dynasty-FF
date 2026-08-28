import { useMemo, useState } from 'react';
import type { Position } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { blendedValue } from '../../engine/values';
import { useStore } from '../../state/store';
import { useTeamName } from '../useTeamName';
import { ContentionSlider } from '../components/ContentionSlider';
import { PlayerTable } from '../components/PlayerTable';
import { PositionalCurveChart, PositionTabs, ValueScatter } from '../components/charts';
import { Callout, EmptyState, Panel, PanelHeader, Toggle } from '../components/primitives';
import { value } from '../format';

type Tab = 'table' | 'scatter' | 'curves' | 'free';

export function PlayersView() {
  const [tab, setTab] = useState<Tab>('table');
  const pipeline = useStore((s) => s.pipeline);
  const weight = useStore((s) => s.settings.contentionWeight);
  const userRosterId = useStore((s) => s.userRosterId);
  const mode = useStore((s) => s.mode);
  const teamName = useTeamName();

  if (!pipeline) {
    return <EmptyState title="No values yet">Connect a league or pick a preset to begin.</EmptyState>;
  }

  const players = pipeline.players;

  return (
    <div className="space-y-4">
      <ContentionSlider />

      <div className="flex items-center justify-between gap-3">
        <Toggle
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'table', label: 'Board' },
            { value: 'scatter', label: 'Quadrants' },
            { value: 'free', label: 'Free agents' },
            { value: 'curves', label: 'Curves' },
          ]}
        />
        <span className="num hidden text-[0.75rem] text-ink-500 sm:block">
          {players.length} players · {mode === 'synced' ? 'observed' : 'simulated'} replacement
        </span>
      </div>

      {tab === 'table' ? (
        <Panel className="overflow-hidden animate-rise">
          <PanelHeader
            title="Player board"
            subtitle="Rating is standalone market value on a 0-100 scale; VAR is that rating measured against the best unrostered player at the position. Both follow the timeline slider. The gap column is a direction, never a value."
          />
          <PlayerTable
            players={players}
            weight={weight}
            teamName={teamName}
            userRosterId={userRosterId}
            showOwner={mode === 'synced'}
          />
        </Panel>
      ) : null}

      {tab === 'scatter' ? <ScatterPanel /> : null}
      {tab === 'free' ? <FreeAgentPanel /> : null}
      {tab === 'curves' ? <CurvesPanel /> : null}
    </div>
  );
}

function ScatterPanel() {
  const pipeline = useStore((s) => s.pipeline)!;
  const userRosterId = useStore((s) => s.userRosterId);
  const [onlyMine, setOnlyMine] = useState(false);

  const mine = useMemo(
    () =>
      new Set(
        pipeline.players.filter((p) => p.ownerRosterId === userRosterId).map((p) => p.id),
      ),
    [pipeline, userRosterId],
  );

  const shown = useMemo(() => {
    const withValue = pipeline.players.filter(
      (p) => p.winNowRating > 0 || p.longTermRating > 0,
    );
    return onlyMine ? withValue.filter((p) => mine.has(p.id)) : withValue;
  }, [pipeline, onlyMine, mine]);

  return (
    <Panel className="animate-rise">
      <PanelHeader
        title="Win now against long term"
        subtitle="Plotted on the 0-100 rating, so the waiver wire sits in the bottom left rather than collapsed onto the origin. The quadrants label themselves."
        right={
          userRosterId != null ? (
            <Toggle
              size="sm"
              value={onlyMine ? 'mine' : 'all'}
              onChange={(v) => setOnlyMine(v === 'mine')}
              options={[
                { value: 'all', label: 'League' },
                { value: 'mine', label: 'My roster' },
              ]}
            />
          ) : null
        }
      />
      <div className="p-4 sm:p-6">
        <ValueScatter players={shown} highlight={userRosterId != null ? mine : undefined} />
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.75rem] text-ink-400">
          {POSITIONS.map((position) => (
            <span key={position} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: `var(--color-${legendVar(position)})` }}
              />
              {position}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function legendVar(position: Position): string {
  return { QB: 'blend-400', RB: 'now-500', WR: 'later-400', TE: 'bad-500' }[position];
}

function FreeAgentPanel() {
  const pipeline = useStore((s) => s.pipeline)!;
  const mode = useStore((s) => s.mode);
  const weight = useStore((s) => s.settings.contentionWeight);
  const teamName = useTeamName();

  if (mode !== 'synced') {
    return (
      <Panel>
        <EmptyState title="Free agents need a synced league">
          Without real rosters there is no observed waiver wire — only a modelled one. Connect a
          Sleeper league and this becomes the actual list of unrostered players, ranked.
        </EmptyState>
      </Panel>
    );
  }

  const free = pipeline.players.filter((p) => p.ownerRosterId == null);
  const bestRaw = [...free].sort((a, b) => b.winNowRating - a.winNowRating).slice(0, 4);

  return (
    <div className="space-y-4 animate-rise">
      <Callout tone="info" title="These players have a rating; what they mostly lack is value above it">
        Every player carries a 0-100 market rating, waiver wire included, and that is what ranks
        this list. The VAR column is the other question: replacement level is defined as the best
        unrostered player at each position, so the four below sit at zero by construction and
        anyone worse than them goes negative.
      </Callout>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Replacement players"
          subtitle="These four set replacement level for the whole league. Every value in the app is measured against them."
        />
        <ul className="grid gap-px bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-4">
          {bestRaw.map((player) => (
            <li key={player.id} className="bg-ink-900/60 p-4">
              <div className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400">
                {player.position} replacement
              </div>
              <div className="mt-1 truncate text-[0.9375rem] font-semibold text-ink-100">
                {player.name}
              </div>
              <div className="num mt-1 text-[0.75rem] text-ink-400">
                rating {value(player.winNowRating, 2)} · VAR {value(player.winNowVar, 2)}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title="The waiver wire" subtitle="Every unrostered player this league knows about." />
        <PlayerTable
          players={free}
          weight={weight}
          teamName={teamName}
          initialOwnership="free"
          showOwner={false}
        />
      </Panel>
    </div>
  );
}

function CurvesPanel() {
  const pipeline = useStore((s) => s.pipeline)!;
  const [position, setPosition] = useState<Position>('RB');
  const [horizon, setHorizon] = useState<'winNow' | 'longTerm'>('winNow');

  const horizonResult = pipeline[horizon];
  const comparison = horizonResult.comparison;

  return (
    <div className="space-y-4 animate-rise">
      <Panel>
        <PanelHeader
          title="Positional value curve"
          subtitle="Both replacement levels are marked. Where they diverge, the league is rostering deeper or shallower than its settings imply — which is real information about this specific league."
          right={
            <div className="flex flex-wrap gap-2">
              <Toggle
                size="sm"
                value={horizon}
                onChange={(v) => setHorizon(v as 'winNow' | 'longTerm')}
                options={[
                  { value: 'winNow', label: 'Win now' },
                  { value: 'longTerm', label: 'Long term' },
                ]}
              />
              <PositionTabs value={position} onChange={setPosition} />
            </div>
          }
        />
        <div className="p-4 sm:p-6">
          <PositionalCurveChart
            curves={horizonResult.curves}
            comparison={comparison}
            position={position}
          />
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Observed against simulated replacement"
          subtitle={
            comparison
              ? 'Divergence is reported rather than hidden.'
              : 'Only the simulated model is available without a synced league.'
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-[0.8125rem]">
            <thead className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-400">
              <tr className="border-b border-white/[0.06]">
                <th className="py-2 pl-4 text-left font-medium sm:pl-5">Position</th>
                <th className="px-3 py-2 text-right font-medium">Observed</th>
                <th className="px-3 py-2 text-right font-medium">Simulated</th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
                <th className="py-2 pr-4 text-left font-medium sm:pr-5">Reading</th>
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((pos) => {
                const row = comparison?.find((c) => c.position === pos);
                const simulated = horizonResult.simulated?.levels[pos];
                return (
                  <tr key={pos} className="border-b border-white/[0.035]">
                    <td className="py-2.5 pl-4 font-medium text-ink-100 sm:pl-5">{pos}</td>
                    <td className="num px-3 py-2.5 text-right text-blend-400">
                      {row ? value(row.observed, 2) : '—'}
                    </td>
                    <td className="num px-3 py-2.5 text-right text-ink-300">
                      {simulated != null ? value(simulated, 2) : '—'}
                    </td>
                    <td className="num px-3 py-2.5 text-right text-ink-300">
                      {row ? value(row.delta, 2) : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-[0.75rem] text-ink-400 sm:pr-5">
                      {row
                        ? row.delta < -0.05
                          ? 'Rostering deeper than settings imply'
                          : row.delta > 0.05
                            ? 'Rostering shallower than settings imply'
                            : 'In line with settings'
                        : 'Synced mode only'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Absorption model" subtitle="How the simulated waiver wire is inferred." />
        <div className="grid gap-px bg-white/[0.05] sm:grid-cols-4">
          {POSITIONS.map((pos) => (
            <div key={pos} className="bg-ink-900/60 p-4">
              <div className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400">
                {pos} absorbed
              </div>
              <div className="num mt-1 text-2xl font-semibold text-ink-100">
                {horizonResult.simulated?.absorbed?.[pos] ?? '—'}
              </div>
              <div className="num mt-1 text-[0.75rem] text-ink-400">
                replacement {value(horizonResult.simulated?.levels[pos] ?? 0, 2)}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/** Exported so the roster view can reuse the same blended sort. */
export const blended = blendedValue;
