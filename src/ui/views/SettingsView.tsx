import { useState } from 'react';
import type { CurveKind, DraftOrderRule } from '../../engine/types';
import { DEFAULT_SETTINGS } from '../../engine/types';
import { listFromText } from '../../data/rankings/parse';
import { bundledRankingSet } from '../../data/rankings/bundled';
import { remoteSource } from '../../data/rankings/remote';
import type { RankingList } from '../../data/rankings/types';
import { shareUrl } from '../../state/persist';
import { useStore } from '../../state/store';
import { rankingFormatFor } from '../../data/rankings/types';
import {
  Button,
  Callout,
  Field,
  NumberInput,
  Panel,
  PanelHeader,
  Select,
  Toggle,
} from '../components/primitives';
import { percent, value } from '../format';

const PAYOUT_PRESETS: { id: string; label: string; weights: number[]; blurb: string }[] = [
  {
    id: 'wta',
    label: 'Winner take all',
    weights: [1],
    blurb:
      'The default, and a deliberate philosophy: only two outcomes have value, winning a championship and accumulating assets that improve future championship odds. Finishing second is worth nothing.',
  },
  {
    id: '60-30-10',
    label: '60 / 30 / 10',
    weights: [0.6, 0.3, 0.1],
    blurb: 'Pays first, second and third. Legitimately shifts what the win now metric optimises.',
  },
  {
    id: '70-20-10',
    label: '70 / 20 / 10',
    weights: [0.7, 0.2, 0.1],
    blurb: 'Top heavy but not winner take all.',
  },
  {
    id: '50-25-15-10',
    label: '50 / 25 / 15 / 10',
    weights: [0.5, 0.25, 0.15, 0.1],
    blurb: 'Four places paid. Climbing the standings starts to be worth something on its own.',
  },
];

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const assembled = useStore((s) => s.assembled);
  const rankingSet = useStore((s) => s.rankingSet);
  const setRankingSet = useStore((s) => s.setRankingSet);
  const league = useStore((s) => s.league);
  const username = useStore((s) => s.username);
  const shape = useStore((s) => s.shape);
  const playersAsOf = useStore((s) => s.playersAsOf);
  const refreshingPlayers = useStore((s) => s.refreshingPlayers);
  const refreshPlayerData = useStore((s) => s.refreshPlayerData);
  const [copied, setCopied] = useState(false);

  const activePayout =
    PAYOUT_PRESETS.find(
      (p) =>
        p.weights.length === settings.payoutWeights.length &&
        p.weights.every((w, i) => Math.abs(w - settings.payoutWeights[i]) < 1e-9),
    )?.id ?? 'custom';

  const share = () => {
    const url = shareUrl({
      username,
      leagueId: league?.leagueId ?? null,
      settings,
      nameOverrides: {},
    });
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
    try {
      window.history.replaceState(null, '', url);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Payout structure"
          subtitle="Every win now number in this product traces back to championship probability rather than to placement. Under winner take all the win now metric reduces exactly to the change in championship probability."
        />
        <div className="space-y-3 p-4 sm:p-5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setSettings({ payoutWeights: preset.weights })}
                className={`focus-ring rounded-xl border p-3 text-left transition ${
                  activePayout === preset.id
                    ? 'border-blend-500/50 bg-blend-500/10'
                    : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15'
                }`}
              >
                <div className="text-[0.875rem] font-semibold text-ink-100">{preset.label}</div>
                <div className="num mt-1 text-[0.6875rem] text-ink-400">
                  {preset.weights.map((w) => percent(w, 0)).join(' · ')}
                </div>
              </button>
            ))}
          </div>
          <p className="text-[0.8125rem] leading-relaxed text-ink-400">
            {PAYOUT_PRESETS.find((p) => p.id === activePayout)?.blurb ??
              'Custom weights. The philosophy is a configuration here, not a hard-coded assumption, and the math does not change.'}
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Ranking source"
          subtitle="KeepTradeCut publishes crowdsourced market values, not just an ordering, and one cross-positional scale per format. Ratings are used as published; the rank curve is only needed for imported lists that carry ranks alone."
        />
        <div className="space-y-4 p-4 sm:p-5">
          <Callout tone="good" title={rankingSet.label}>
            {rankingSet.provenance}
            {rankingSet.id === 'bundled' ? (
              <>
                {' '}
                Values belong to{' '}
                <a
                  href="https://keeptradecut.com"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-2 hover:text-ink-100"
                >
                  keeptradecut.com
                </a>
                , captured once per deploy.
              </>
            ) : null}
          </Callout>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.07] p-3">
              <div className="text-[0.8125rem] font-semibold text-ink-100">Coverage</div>
              <ul className="num mt-1.5 space-y-0.5 text-[0.75rem] text-ink-400">
                <li>Dynasty overall: {assembled?.coverage.dynastyOverall ?? 0} matched</li>
                <li>Redraft overall: {assembled?.coverage.redraftOverall ?? 0} matched</li>
                <li>
                  Board in use: {rankingFormatFor(shape)}
                </li>
                <li>
                  {shape.superflex ? 'Superflex' : 'One quarterback'}
                  {shape.tightEndPremium > 0
                    ? ` · +${shape.tightEndPremium} per TE reception`
                    : ' · no tight end premium'}
                </li>
                <li>Unmatched names: {assembled?.unmatched.length ?? 0}</li>
              </ul>
            </div>
            <div className="rounded-xl border border-white/[0.07] p-3 opacity-60">
              <div className="text-[0.8125rem] font-semibold text-ink-100">
                {remoteSource.label}
              </div>
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-400">
                {remoteSource.description}
              </p>
            </div>
          </div>

          {assembled && assembled.unmatched.length > 0 ? (
            <div className="rounded-xl border border-now-500/25 bg-now-500/[0.06] p-3">
              <div className="text-[0.8125rem] font-semibold text-ink-100">
                {assembled.unmatched.length} ranked names did not match a player
              </div>
              <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-[0.75rem] text-ink-300">
                {assembled.unmatched.slice(0, 40).map((entry) => (
                  <li key={`${entry.name}-${entry.position}`}>
                    {entry.name} · {entry.position} · {entry.team ?? 'FA'} ({entry.lists.join(', ')})
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.75rem] text-ink-400">
                They are surfaced rather than silently dropped. Fixing a spelling in the import
                usually resolves it.
              </p>
            </div>
          ) : null}

          <RankingImport onReplace={setRankingSet} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Player data"
          subtitle="A trimmed player pool ships with the build, so the app loads without waiting on a 14MB download. Pull live only if you need players added since the last release."
        />
        <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
          <Button
            size="sm"
            onClick={refreshPlayerData}
            disabled={refreshingPlayers}
          >
            {refreshingPlayers ? 'Refreshing…' : 'Refresh from Sleeper'}
          </Button>
          <span className="text-[0.75rem] text-ink-400">
            Currently using{' '}
            <span className="text-ink-200">
              {playersAsOf?.live ? 'live data' : 'the shipped pool'}
            </span>{' '}
            from {playersAsOf?.asOf ?? '—'}. Sleeper asks that this file be fetched no more
            than once a day; it is cached for 24 hours.
          </span>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Value curve"
          subtitle="How a rank becomes a value. Swappable so a power law or a logistic can replace the exponential without touching anything downstream."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field
            label={`Decay lambda · ${settings.lambda.toFixed(3)}`}
            hint={`Rank 100 sits at ${percent(Math.exp(-settings.lambda * 99), 1)} of rank 1.`}
          >
            <input
              type="range"
              min={0.008}
              max={0.05}
              step={0.001}
              value={settings.lambda}
              onChange={(e) => setSettings({ lambda: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
          <Field label="Curve family">
            <Select
              value={settings.curve}
              onChange={(curve) => setSettings({ curve: curve as CurveKind })}
              options={[
                { value: 'exponential', label: 'Exponential (default)' },
                { value: 'power', label: 'Power law' },
                { value: 'logistic', label: 'Logistic' },
              ]}
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Season simulation"
          subtitle="Weekly scoring variance is the parameter that governs everything downstream. Set it too low and the best roster wins nearly every time; too high and rosters stop mattering."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
          <Field
            label="Simulated seasons"
            hint="More seasons means less jitter in pick values, at a linear cost in time."
          >
            <Select
              value={String(settings.simSeasons)}
              onChange={(v) => setSettings({ simSeasons: Number(v) })}
              options={[
                { value: '2000', label: '2,000 · fastest' },
                { value: '4000', label: '4,000' },
                { value: '8000', label: '8,000 · default' },
                { value: '16000', label: '16,000' },
                { value: '30000', label: '30,000 · slowest' },
              ]}
            />
          </Field>
          <Field
            label={`Weekly σ · ${settings.weeklySigma} points`}
            hint="Real fantasy teams swing about 25 to 30 points a week around their own mean."
          >
            <input
              type="range"
              min={12}
              max={45}
              step={1}
              value={settings.weeklySigma}
              onChange={(e) => setSettings({ weeklySigma: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
          <Field label="League mean points per week">
            <NumberInput
              value={settings.leagueMeanPoints}
              min={60}
              max={200}
              onChange={(leagueMeanPoints) => setSettings({ leagueMeanPoints })}
            />
          </Field>
          <Field
            label="Replacement points per starter"
            hint="Sets the intercept: a lineup of pure replacement players scores this times the number of starting slots."
          >
            <NumberInput
              value={settings.replacementPointsPerStarter}
              min={0}
              max={20}
              step={0.5}
              onChange={(replacementPointsPerStarter) =>
                setSettings({ replacementPointsPerStarter })
              }
            />
          </Field>
          <Field label="Random seed" hint="Baseline and trade scenarios share it, so deltas are signal.">
            <NumberInput value={settings.seed} onChange={(seed) => setSettings({ seed })} />
          </Field>
          <Field
            label="Draft order rule"
            hint="Final standings and draft order are not always the same ordering."
          >
            <Select
              value={settings.draftOrderRule}
              onChange={(v) => setSettings({ draftOrderRule: v as DraftOrderRule })}
              options={[
                { value: 'reverse_final_standings', label: 'Reverse final standings' },
                { value: 'reverse_regular_season', label: 'Reverse regular season record' },
                { value: 'consolation_then_playoffs', label: 'Non-playoff teams pick first' },
              ]}
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Pick valuation"
          subtitle="A pick returns, in expectation, the player at effectiveRank = base × slot^exponent on the dynasty board. Deliberately concave: 1.01 to 1.04 is a far bigger gap than 2.04 to 2.07."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <Field
            label={`Base rank · ${settings.pickBaseRank}`}
            hint="What pick 1.01 returns in expectation."
          >
            <input
              type="range"
              min={5}
              max={40}
              step={1}
              value={settings.pickBaseRank}
              onChange={(e) => setSettings({ pickBaseRank: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
          <Field label={`Exponent · ${settings.pickExponent.toFixed(2)}`} hint="How fast picks fade.">
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.01}
              value={settings.pickExponent}
              onChange={(e) => setSettings({ pickExponent: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
          <Field
            label={`Future discount · ${settings.futureDiscountPerYear.toFixed(2)}/yr`}
            hint="Applied to picks beyond the next draft."
          >
            <input
              type="range"
              min={0.7}
              max={1}
              step={0.01}
              value={settings.futureDiscountPerYear}
              onChange={(e) => setSettings({ futureDiscountPerYear: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
          <Field
            label={`Future uncertainty · ${percent(settings.futureUncertaintyPerYear, 0)}/yr`}
            hint="How far a distant season's slot distribution is widened toward uniform. Too narrow makes pick values falsely precise; too wide makes every pick look the same."
          >
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={settings.futureUncertaintyPerYear}
              onChange={(e) => setSettings({ futureUncertaintyPerYear: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
          <Field
            label={`Dead zone threshold · ${percent(settings.deadZoneThreshold, 1)}`}
            hint="How little championship probability gain counts as almost none."
          >
            <input
              type="range"
              min={0.002}
              max={0.06}
              step={0.002}
              value={settings.deadZoneThreshold}
              onChange={(e) => setSettings({ deadZoneThreshold: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
          <Field
            label={`Usage horizon · ${settings.usageHorizonYears} seasons`}
            hint="How long a player's value to his own roster is measured over. One season reads every young player as useless; three is far enough to see a breakout arrive and near enough that the projection still means something."
          >
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={settings.usageHorizonYears}
              onChange={(e) => setSettings({ usageHorizonYears: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
          <Field
            label={`Open roster spot · ${value(settings.rosterSpotOptionValue, 1)}`}
            hint="What an empty seat is worth. Not the free agent who fills it — he is worth zero above replacement by definition — but the option the seat carries: keep whoever climbs, drop whoever does not, draw again. This one is an estimate rather than a measurement, which is why it is here. Roughly three puts a speculative seat next to a mediocre backup."
          >
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={settings.rosterSpotOptionValue}
              onChange={(e) => setSettings({ rosterSpotOptionValue: Number(e.target.value) })}
              className="range-slim"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-3 sm:px-5">
          <Button size="sm" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>
            Reset every tunable to defaults
          </Button>
          <Button size="sm" variant="primary" onClick={share}>
            {copied ? 'Link copied' : 'Copy shareable link'}
          </Button>
          <span className="text-[0.75rem] text-ink-500">
            The link carries the league and every setting that differs from default.
          </span>
        </div>
      </Panel>
    </div>
  );
}

function RankingImport({ onReplace }: { onReplace: (set: ReturnType<typeof bundledRankingSet>) => void }) {
  const [horizon, setHorizon] = useState<'dynasty' | 'redraft'>('dynasty');
  const [scope, setScope] = useState<'overall' | 'QB' | 'TE'>('overall');
  const [format, setFormat] = useState<'standard' | 'superflex'>('standard');
  const [text, setText] = useState('');
  const [report, setReport] = useState<{ count: number; skipped: string[] } | null>(null);
  const rankingSet = useStore((s) => s.rankingSet);

  const apply = (raw: string) => {
    const { list, skipped } = listFromText(raw, horizon, scope, format);
    if (list.entries.length === 0) {
      setReport({ count: 0, skipped });
      return;
    }
    const lists: RankingList[] = rankingSet.lists.filter(
      (l) => !(l.horizon === horizon && l.scope === scope && l.format === format),
    );
    onReplace({
      ...rankingSet,
      id: 'imported',
      label: 'Imported rankings',
      asOf: new Date().toISOString().slice(0, 10),
      provenance:
        'Imported by you. Lists you have not replaced still come from the bundled snapshot.',
      lists: [...lists, list],
    });
    setReport({ count: list.entries.length, skipped });
    setText('');
  };

  return (
    <div className="rounded-xl border border-white/[0.07] p-3">
      <div className="text-[0.8125rem] font-semibold text-ink-100">
        Import a ranking list
      </div>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-400">
        Paste a FantasyPros CSV export, a spreadsheet copy, or a plain numbered list. Import each
        list separately so overall and positional stay distinct.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Toggle
          size="sm"
          value={horizon}
          onChange={(v) => setHorizon(v as 'dynasty' | 'redraft')}
          options={[
            { value: 'dynasty', label: 'Dynasty' },
            { value: 'redraft', label: 'Redraft' },
          ]}
        />
        <Toggle
          size="sm"
          value={scope}
          onChange={(v) => setScope(v as 'overall' | 'QB' | 'TE')}
          options={[
            { value: 'overall', label: 'Overall' },
            { value: 'QB', label: 'QB' },
            { value: 'TE', label: 'TE' },
          ]}
        />
        <Toggle
          size="sm"
          value={format}
          onChange={(v) => setFormat(v as 'standard' | 'superflex')}
          options={[
            { value: 'standard', label: '1QB' },
            { value: 'superflex', label: 'SF' },
          ]}
        />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={'1,"Ja\'Marr Chase","CIN","WR1"\n2,"Bijan Robinson","ATL","RB1"'}
        className="focus-ring num mt-3 w-full rounded-lg border border-white/10 bg-ink-950/60 p-3 text-[0.75rem] text-ink-100 placeholder:text-ink-500"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => apply(text)} disabled={!text.trim()}>
          Import {scope === 'overall' ? 'overall' : scope} {horizon}
        </Button>
        <label className="focus-ring inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[0.8125rem] text-ink-200 transition hover:bg-white/[0.07]">
          Choose a file
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) apply(await file.text());
              e.target.value = '';
            }}
          />
        </label>
        <Button size="sm" onClick={() => onReplace(bundledRankingSet())}>
          Restore bundled
        </Button>
      </div>

      {report ? (
        <p className="mt-2 text-[0.75rem] text-ink-400">
          {report.count > 0
            ? `Imported ${report.count} players.`
            : 'Nothing usable found in that paste.'}
          {report.skipped.length > 0
            ? ` ${report.skipped.length} lines skipped: ${report.skipped.slice(0, 3).join(' · ')}${
                report.skipped.length > 3 ? ' …' : ''
              }`
            : ''}
        </p>
      ) : null}
    </div>
  );
}

/** Re-exported for the tests that assert the payout default. */
export const winnerTakeAllWeights = [1];
export const defaultLambdaLabel = value(DEFAULT_SETTINGS.lambda, 3);
