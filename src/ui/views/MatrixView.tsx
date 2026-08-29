import { useMemo } from 'react';
import { expectedPayout } from '../../engine/season';
import { useStore } from '../../state/store';
import { useTeamName } from '../useTeamName';
import { FinishMatrixHeatmap } from '../components/FinishMatrix';
import { TeamBars } from '../components/charts';
import { Button, Callout, EmptyState, Panel, PanelHeader, Skeleton, Stat } from '../components/primitives';
import { ordinal, percent, value } from '../format';

export function MatrixView() {
  const scenario = useStore((s) => s.scenario);
  const simulating = useStore((s) => s.simulating);
  const simError = useStore((s) => s.simError);
  const settings = useStore((s) => s.settings);
  const userRosterId = useStore((s) => s.userRosterId);
  const runBaseline = useStore((s) => s.runBaseline);
  const elapsed = useStore((s) => s.simElapsedMs);
  const teamName = useTeamName();
  const league = useStore((s) => s.league);

  const playoffTeams = league?.playoffTeams ?? 6;

  const derived = useMemo(() => {
    if (!scenario) return null;
    const finish = scenario.result.finish;
    const regular = scenario.result.regularSeason;
    return finish.rosterIds.map((rosterId, i) => {
      const regularRow = regular.rows[i] ?? [];
      // Seeding comes off the regular season matrix, everything after it off
      // the final one. Reading both from `finish` would quietly count a team
      // that finished third overall as having earned the third seed.
      const madePlayoffs = regularRow
        .slice(0, playoffTeams)
        .reduce((a, b) => a + b, 0);
      const byeSeeds = Math.max(0, (1 << Math.ceil(Math.log2(Math.max(2, playoffTeams)))) - playoffTeams);
      return {
        rosterId,
        name: teamName(rosterId),
        title: finish.rows[i][0],
        finalist: (finish.rows[i][0] ?? 0) + (finish.rows[i][1] ?? 0),
        madePlayoffs,
        bye: byeSeeds > 0 ? regularRow.slice(0, byeSeeds).reduce((a, b) => a + b, 0) : 0,
        payout: expectedPayout(finish.rows[i], settings.payoutWeights),
        expected: finish.rows[i].reduce((acc, p, j) => acc + p * (j + 1), 0),
        expectedSeed: regularRow.reduce((acc, p, j) => acc + p * (j + 1), 0),
        strength: scenario.strengths.get(rosterId) ?? 0,
        points: scenario.result.meanPoints.get(rosterId) ?? 0,
      };
    });
  }, [scenario, settings.payoutWeights, teamName, playoffTeams]);

  if (simError) {
    return (
      <Panel>
        <EmptyState title="The simulation failed" action={<Button onClick={runBaseline}>Try again</Button>}>
          {simError}
        </EmptyState>
      </Panel>
    );
  }

  if (!scenario || !derived) {
    return (
      <div className="space-y-4">
        <Panel className="p-5">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-4 h-64 w-full" />
        </Panel>
        <p className="px-1 text-[0.8125rem] text-ink-400">
          {simulating ? 'Running the season simulation…' : 'Connect a league to build the matrix.'}
        </p>
      </div>
    );
  }

  const sorted = [...derived].sort((a, b) => b.title - a.title);
  const you = derived.find((d) => d.rosterId === userRosterId);
  const winnerTakeAll =
    settings.payoutWeights.length === 1 && settings.payoutWeights[0] === 1;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="p-4">
          <Stat
            label={you ? 'Your title odds' : 'Best title odds'}
            tone="blend"
            hint={you ? `Projected finish ${ordinal(you.expected)}` : sorted[0].name}
          >
            {percent(you ? you.title : sorted[0].title)}
          </Stat>
        </Panel>
        <Panel className="p-4">
          <Stat
            label="Expected payout"
            hint={winnerTakeAll ? 'Winner take all: identical to title odds' : 'Weighted by your payout structure'}
          >
            {percent(you ? you.payout : sorted[0].payout)}
          </Stat>
        </Panel>
        <Panel className="p-4">
          <Stat label="Seasons simulated" hint={elapsed ? `${Math.round(elapsed)}ms in a worker` : undefined}>
            {settings.simSeasons.toLocaleString()}
          </Stat>
        </Panel>
        <Panel className="p-4">
          <Stat
            label="Weekly variance"
            hint={`σ ${settings.weeklySigma} points around a ${settings.leagueMeanPoints} point league mean`}
          >
            ±{settings.weeklySigma}
          </Stat>
        </Panel>
      </div>

      <Panel className="overflow-hidden animate-rise">
        <PanelHeader
          title="Regular season seeding"
          subtitle={`Where the ${league?.regularSeasonWeeks ?? 14}-week schedule leaves each team. A full schedule averages a lot of variance away, and this is what decides who reaches the bracket at all.`}
          right={
            <Button size="sm" onClick={runBaseline} disabled={simulating}>
              {simulating ? 'Simulating…' : 'Re-run'}
            </Button>
          }
        />
        <FinishMatrixHeatmap
          matrix={scenario.result.regularSeason}
          teamName={teamName}
          highlightRosterId={userRosterId}
          caption={`Columns are seeds. The first ${playoffTeams} make the playoffs.`}
        />
      </Panel>

      <Panel className="overflow-hidden animate-rise">
        <PanelHeader
          title="Final standings after the bracket"
          subtitle={`The same season carried through the playoffs${
            (league?.playoffWeeksPerRound ?? 1) > 1 ? ', two weeks per round' : ''
          }. The bracket adds its own noise on top of the schedule, so this matrix can only be more spread than the one above it. That widening is the postseason's luck, made visible rather than argued about.`}
        />
        <FinishMatrixHeatmap
          matrix={scenario.result.finish}
          teamName={teamName}
          highlightRosterId={userRosterId}
          caption="Columns are final placements. Every win now number in the app is derived from this matrix."
        />
      </Panel>

      <Panel className="animate-rise">
        <PanelHeader
          title="How far each team gets"
          subtitle="Read across: reaching the bracket is mostly earned over the schedule, winning it mostly is not."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-[0.8125rem]">
            <thead className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-400">
              <tr className="border-b border-white/[0.06]">
                <th className="py-2 pl-4 font-medium sm:pl-5">Team</th>
                <th className="px-2 py-2 text-right font-medium">Proj. seed</th>
                <th className="px-2 py-2 text-right font-medium">Make playoffs</th>
                {derived.some((d) => d.bye > 0) ? (
                  <th className="px-2 py-2 text-right font-medium">First-round bye</th>
                ) : null}
                <th className="px-2 py-2 text-right font-medium">Reach final</th>
                <th className="py-2 pr-4 text-right font-medium text-blend-400 sm:pr-5">Title</th>
              </tr>
            </thead>
            <tbody>
              {[...derived]
                .sort((a, b) => b.title - a.title)
                .map((d) => (
                  <tr
                    key={d.rosterId}
                    className={`border-b border-white/[0.035] ${
                      d.rosterId === userRosterId ? 'bg-blend-500/[0.06]' : ''
                    }`}
                  >
                    <td className="truncate py-2 pl-4 text-ink-100 sm:pl-5">{d.name}</td>
                    <td className="num px-2 py-2 text-right text-ink-400">
                      {ordinal(d.expectedSeed)}
                    </td>
                    <td className="num px-2 py-2 text-right text-ink-200">
                      {percent(d.madePlayoffs, 0)}
                    </td>
                    {derived.some((x) => x.bye > 0) ? (
                      <td className="num px-2 py-2 text-right text-ink-400">
                        {percent(d.bye, 0)}
                      </td>
                    ) : null}
                    <td className="num px-2 py-2 text-right text-ink-200">
                      {percent(d.finalist, 0)}
                    </td>
                    <td className="num py-2 pr-4 text-right font-semibold text-blend-400 sm:pr-5">
                      {percent(d.title, 1)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[0.75rem] leading-relaxed text-ink-400 sm:px-5">
          Bracket shape{' '}
          {league?.bracketSource === 'sleeper'
            ? `read from this league's published bracket (${league.playoffRounds} rounds)`
            : `derived from ${playoffTeams} playoff teams — Sleeper only publishes the bracket once the playoffs are seeded`}
          {(league?.playoffWeeksPerRound ?? 1) > 1
            ? ', two weeks per round, which favours the better team'
            : ', one week per round'}
          .
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Championship odds"
            subtitle="The first column of the matrix, sorted. Nothing else in the standings is worth anything under winner take all."
          />
          <div className="p-4 sm:p-5">
            <TeamBars
              entries={sorted.map((d) => ({ rosterId: d.rosterId, name: d.name, value: d.title }))}
              format={(n) => percent(n)}
              highlight={userRosterId}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Lineup strength and projected scoring"
            subtitle="Optimal starting lineup value, and the weekly scoring mean it implies. A bench acquisition moves neither, which is why it moves nothing in the matrix."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-[0.8125rem]">
              <thead className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-400">
                <tr className="border-b border-white/[0.06]">
                  <th className="py-2 pl-4 text-left font-medium sm:pl-5">Team</th>
                  <th className="px-3 py-2 text-right font-medium">Lineup</th>
                  <th className="px-3 py-2 text-right font-medium">Points/wk</th>
                  <th className="py-2 pr-4 text-right font-medium sm:pr-5">Proj. finish</th>
                </tr>
              </thead>
              <tbody>
                {[...derived]
                  .sort((a, b) => a.expected - b.expected)
                  .map((row) => (
                    <tr
                      key={row.rosterId}
                      className={`border-b border-white/[0.035] ${
                        row.rosterId === userRosterId ? 'bg-blend-500/[0.05]' : ''
                      }`}
                    >
                      <td className="max-w-[10rem] truncate py-2 pl-4 text-ink-200 sm:pl-5">
                        {row.name}
                      </td>
                      <td className="num px-3 py-2 text-right text-now-400">
                        {value(row.strength, 0)}
                      </td>
                      <td className="num px-3 py-2 text-right text-ink-300">
                        {value(row.points, 1)}
                      </td>
                      <td className="num py-2 pr-4 text-right text-ink-300 sm:pr-5">
                        {ordinal(row.expected)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Callout tone="info" title="Why this matrix and not a single number">
        A closed form ranking or softmax cannot represent the coupling that makes this product
        work: when one team improves, every other team moves, and it moves most for the teams it
        passes. That only emerges from simulating the season and letting complete finish orders
        accumulate.{' '}
        {league?.scheduleSource === 'generated'
          ? 'This league has no published schedule yet, so a round robin stands in for it.'
          : `Sleeper's actual remaining schedule is used, ${league?.completedWeeks ?? 0} weeks already in the books.`}
      </Callout>
    </div>
  );
}
