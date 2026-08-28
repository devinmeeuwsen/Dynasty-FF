import { useState } from 'react';
import { useStore, type ManualLeague } from '../../state/store';
import { Button, Callout, Field, NumberInput, Panel, PanelHeader, Select, TextInput } from '../components/primitives';

const PRESETS: { id: string; label: string; hint: string; config: ManualLeague }[] = [
  {
    id: 'standard12',
    label: '12-team, 1QB',
    hint: 'QB RB RB WR WR WR TE FLEX, 6 bench',
    config: {
      teams: 12,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'],
      benchSlots: 6,
      superflex: false,
    },
  },
  {
    id: 'sf12',
    label: '12-team superflex',
    hint: 'Adds a SUPER_FLEX slot',
    config: {
      teams: 12,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'],
      benchSlots: 6,
      superflex: true,
    },
  },
  {
    id: 'sf10',
    label: '10-team superflex',
    hint: 'Shallower league, higher replacement level',
    config: {
      teams: 10,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'],
      benchSlots: 5,
      superflex: true,
    },
  },
];

/**
 * League connection is the first-run experience, not a settings page.
 * Username, pick a league, done.
 */
export function ConnectView() {
  const username = useStore((s) => s.username);
  const setUsername = useStore((s) => s.setUsername);
  const lookupUser = useStore((s) => s.lookupUser);
  const leagues = useStore((s) => s.leagues);
  const user = useStore((s) => s.user);
  const selectLeague = useStore((s) => s.selectLeague);
  const connecting = useStore((s) => s.connecting);
  const connectError = useStore((s) => s.connectError);
  const league = useStore((s) => s.league);
  const startSimulatedMode = useStore((s) => s.startSimulatedMode);
  const refreshLeague = useStore((s) => s.refreshLeague);
  const reset = useStore((s) => s.reset);
  const playersAsOf = useStore((s) => s.playersAsOf);

  const [manual, setManual] = useState<ManualLeague>(PRESETS[0].config);
  const [showManual, setShowManual] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-4 animate-rise">
      <div className="px-1 py-2 sm:py-6">
        <h1 className="text-balance text-2xl font-bold tracking-tight text-ink-100 sm:text-3xl">
          Values for <span className="text-blend-400">your</span> league, not a league like yours.
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-[0.9375rem] leading-relaxed text-ink-300">
          Connect a Sleeper league and every number below becomes specific to its settings, its
          actual waiver wire, your roster and your pick holdings. Only two outcomes have value
          here: winning a championship, and accumulating assets that improve future championship
          odds.
        </p>
      </div>

      <Panel>
        <PanelHeader
          title="Connect a Sleeper league"
          subtitle="Free, read-only, no password. Enter your username and pick a league."
          right={
            league ? (
              <Button size="sm" onClick={refreshLeague}>
                Refresh
              </Button>
            ) : null
          }
        />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <Field label="Sleeper username">
                <TextInput
                  value={username}
                  onChange={setUsername}
                  placeholder="your sleeper handle"
                  onEnter={lookupUser}
                  autoFocus
                />
              </Field>
            </div>
            <Button variant="primary" onClick={lookupUser} disabled={connecting || !username.trim()}>
              {connecting ? 'Looking…' : 'Find my leagues'}
            </Button>
          </div>

          {connectError ? <Callout tone="warn">{connectError}</Callout> : null}

          {leagues.length > 0 ? (
            <div>
              <div className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400">
                {user ? `${user.display_name}'s leagues` : 'Leagues'}
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {leagues.map((entry) => {
                  const active = league?.leagueId === entry.league_id;
                  const superflex =
                    entry.roster_positions?.includes('SUPER_FLEX') ||
                    (entry.roster_positions ?? []).filter((p) => p === 'QB').length > 1;
                  return (
                    <li key={entry.league_id}>
                      <button
                        onClick={() => selectLeague(entry.league_id)}
                        className={`focus-ring w-full rounded-xl border p-3 text-left transition ${
                          active
                            ? 'border-blend-500/50 bg-blend-500/10'
                            : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="truncate text-[0.875rem] font-semibold text-ink-100">
                          {entry.name}
                        </div>
                        <div className="num mt-1 flex flex-wrap gap-x-2 text-[0.6875rem] text-ink-400">
                          <span>{entry.total_rosters} teams</span>
                          <span>·</span>
                          <span>{superflex ? 'Superflex' : '1QB'}</span>
                          <span>·</span>
                          <span>{entry.status.replace(/_/g, ' ')}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {league ? (
            <Callout tone="good" title={`${league.name} connected`}>
              <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                <li>
                  {league.shape.teams} teams ·{' '}
                  {league.shape.starters.filter((s) => s !== 'UNSUPPORTED').length} valued starting
                  slots · {league.shape.benchSlots} bench
                </li>
                <li>
                  {league.shape.superflex ? 'Superflex' : 'One quarterback'} ·{' '}
                  {league.playoffTeams} playoff teams
                </li>
                <li>
                  Schedule: {league.scheduleSource === 'sleeper' ? 'from Sleeper' : 'generated round robin'} ·{' '}
                  {league.remainingSchedule.length} weeks remaining
                </li>
                <li>
                  Player data {playersAsOf?.live ? 'pulled live' : 'shipped with this build'} ·{' '}
                  {playersAsOf?.asOf ?? '—'}
                </li>
              </ul>
              {league.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-white/10 pt-2 text-ink-300">
                  {league.warnings.map((warning) => (
                    <li key={warning}>· {warning}</li>
                  ))}
                </ul>
              ) : null}
            </Callout>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="No league? Use simulated mode"
          subtitle="Replacement level is inferred from a roster absorption model instead of an observed waiver wire. Everything that needs real rosters — the finish matrix, pick valuation, the trade calculator — stays off."
          right={
            <Button size="sm" onClick={() => setShowManual((v) => !v)}>
              {showManual ? 'Hide' : 'Configure'}
            </Button>
          }
        />
        <div className="p-4 sm:p-5">
          <div className="grid gap-2 sm:grid-cols-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  setManual(preset.config);
                  startSimulatedMode(preset.config);
                }}
                className="focus-ring rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-left transition hover:border-white/15 hover:bg-white/[0.05]"
              >
                <div className="text-[0.875rem] font-semibold text-ink-100">{preset.label}</div>
                <div className="mt-1 text-[0.6875rem] leading-snug text-ink-400">{preset.hint}</div>
              </button>
            ))}
          </div>

          {showManual ? (
            <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-3">
              <Field label="Teams">
                <NumberInput
                  value={manual.teams}
                  min={4}
                  max={20}
                  onChange={(teams) => setManual({ ...manual, teams })}
                />
              </Field>
              <Field label="Bench spots">
                <NumberInput
                  value={manual.benchSlots}
                  min={0}
                  max={30}
                  onChange={(benchSlots) => setManual({ ...manual, benchSlots })}
                />
              </Field>
              <Field label="Format">
                <Select
                  value={manual.superflex ? 'sf' : 'one'}
                  onChange={(v) =>
                    setManual(v === 'sf' ? PRESETS[1].config : PRESETS[0].config)
                  }
                  options={[
                    { value: 'one', label: 'One quarterback' },
                    { value: 'sf', label: 'Superflex' },
                  ]}
                />
              </Field>
              <div className="sm:col-span-3">
                <Field
                  label="Starting slots"
                  hint="Space separated. QB RB WR TE FLEX SUPER_FLEX REC_FLEX are understood; anything else is carried but not valued."
                >
                  <TextInput
                    value={manual.starters.join(' ')}
                    onChange={(text) =>
                      setManual({ ...manual, starters: text.trim().split(/\s+/).filter(Boolean) })
                    }
                  />
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Button variant="primary" onClick={() => startSimulatedMode(manual)}>
                  Use this configuration
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <div className="flex justify-end px-1">
        <Button size="sm" variant="subtle" onClick={reset}>
          Clear saved configuration
        </Button>
      </div>
    </div>
  );
}
