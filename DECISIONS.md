# Decisions

The build prompt listed a set of decisions to bring back rather than guess. Each is
answered here: what shipped, why, and what remains genuinely open. Every default named
below is exposed as a setting, so disagreeing with a call means moving a slider, not
editing code.

## The decay curve default

**Shipped: `rawValue(rank) = 100·exp(−0.021·(rank−1))`, as specified, with power-law and
logistic alternatives behind the same interface.**

Evidence for the calibration: public dynasty trade-value charts (KeepTradeCut-style
community values, DynastyProcess's crowdsourced data) consistently show the ~100th
overall asset trading at 10–15% of the #1 asset, which is exactly where λ=0.021 puts it
(12.3%). A single exponential is slightly too *shallow* at the very top of the board —
markets price the #1 overall asset closer to 1.3–1.5× the #4 asset than the 1.06× a pure
exponential gives — which is why the logistic variant exists. But the top-of-board error
mostly cancels in trade *differences*, and the exponential's one-parameter simplicity
makes the advanced setting comprehensible. Verdict: right default, keep λ tunable
(0.008–0.05 exposed), revisit only if users consistently report top-heavy trades looking
too cheap.

## Weekly scoring variance

**Shipped: σ = 28 points per team-week, around a league mean of 112.**

Empirically, PPR teams score with a weekly standard deviation of roughly 22–30 points
around their own mean (checked against published weekly score distributions and the
score spreads visible in the live league used for testing, where weekly team scores
ranged 77–148 in a single week). The mapping from lineup strength to points is affine —
`points = starters × replacementPointsPerStarter + k × strength`, with k set so the
league-average lineup scores the league mean. An earlier z-score mapping was discarded
because it made a team's sensitivity depend on how tightly packed its league happened to
be (in a league of near-identical rosters, one waiver claim moved a team several
standard deviations).

Calibration target from the prompt: best lineup in a 12-team league lands 15–25% in the
first-place column, not 60%. At σ=28 with a realistically stratified fixture league the
best roster lands at ~22%; even a deliberately absurd super-team stays under 50%. The
validation suite pins both (tests 11 and the stacked-league companion). σ, the
replacement intercept, and the league mean are all settings.

## Full-season vs remaining-schedule simulation mid-season

**Shipped: remaining-schedule simulation.** The current standings (wins, ties, points
for) are taken as fixed history, Sleeper's actual remaining schedule is fetched, and
only unplayed weeks are rolled. Pre-season, the full schedule is simulated; when Sleeper
hasn't generated a schedule yet (offseason, pre-draft), a round-robin stands in and the
interface says so. This is strictly better than re-simulating played weeks: it prices
the season a team is actually having, which is what makes mid-season pick trading
correct (a 2-6 team's own first is worth more *now* than in August, and the matrix
shows it). The one thing not carried over from history is week-to-week team strength
drift; strengths are always current-roster.

## How many simulated seasons

**Shipped: 8,000 default, choices from 2,000 to 30,000.**

Measured on the pure engine (Node, single worker): 1,000 seasons ≈ 24ms, 8,000 ≈ 190ms,
and title-odds spread across five independent seeds is 4.0pp at 1,000 seasons, 1.9pp at
4,000, 0.9pp at 8,000. First-round pick values move less than 3% of their magnitude
across seeds at 8,000 (test 20 enforces this). 8,000 is the knee of the curve: pick
values stop visibly jittering while a full trade evaluation (two simulations plus
re-valuing every pick twice) stays under half a second in the worker. Equally load-
bearing: baseline and trade scenarios share one seed (common random numbers), so trade
deltas are far more stable than either absolute number — without that trick even 30,000
seasons would show jittery deltas.

## Historical hit rates by rookie draft slot

**Shipped: `effectiveRank(slot) = 14 · slot^0.62` — a pick at overall slot *s* of the
rookie draft returns, in expectation, the asset at that dynasty overall rank.**

Anchors this produces: 1.01 → ~rank 14, 1.06 → ~rank 42, 1.12 → ~rank 65, 2.06 → ~rank
89, 3.12 → deep in the replacement pool. This matches the robust findings of public
rookie-pick studies (DynastyProcess pick charts, hit-rate studies of first-rounders):
early firsts return a top-15 dynasty asset in expectation, the first round decays
steeply, second rounds are lottery tickets worth a fraction of late firsts, and third
rounds are near-replacement. The concavity (exponent < 1) is the important part — the
1.01→1.04 gap must dwarf the 2.04→2.07 gap. Both parameters are settings. Honest
caveat: expectation hides the bimodality of rookie outcomes (hit big or bust); a
distribution-over-outcomes model would be the next refinement, and it matters most for
exactly-one-pick rebuilds.

## Width of the projected finish distribution

**Shipped: the simulation's own spread for next season's picks, widened toward uniform
by 35% per additional year out, with a 10% per-year value discount.**

For the next draft, no extra widening is applied: the Monte Carlo spread at σ=28 already
gives a mid-table team a 10th–90th percentile slot range of four to six slots, which is
neither point-estimate-narrow nor everything-looks-the-same-wide. The dead zone warning
fires on the matrix net, not on distribution tails, so the width mainly affects
displayed ranges and cross-season discounting. The 35%/year widening encodes that a
2027 finish is genuinely less knowable than a 2026 finish; at two years out the
distribution is ~70% of the way to uniform, which matches how flat real markets price
picks two classes out (round matters, original team barely does). Both knobs are
settings.

## Win now: redraft rankings vs projected points

**Shipped: redraft rankings, converted through the same value curve.** The tradeoff as
promised:

- **Points are additive**, which is what the lineup optimizer and the points-mean
  mapping actually want. Summing curve-values as if they were points is a modelling
  convenience, not an identity.
- **Rankings are sourceable and robust.** They exist for free (paste/import), update
  all season, and already price injury risk, role, and schedule the way a consensus
  does. Projected points need a licensed feed, and raw projections are notoriously
  flat-biased at the top (projection systems compress stars toward the mean, exactly
  the players this product is about).
- The affine strength→points mapping recovers most of what additivity would buy: team
  strength differences translate to points differences at a calibrated, league-wide
  rate. What is lost is within-position shape (two RB2s vs an RB1+RB3 with equal summed
  value score identically here; with real point projections they might not).

Verdict: rankings now; if a licensed projections feed lands later, it should slot in as
a third `RankingSource` that carries point values, and only `projectMeanPoints` would
need to notice.

## The two-year win-now horizon

**Shipped: one-year redraft as the win-now measurement, unmodified.** The case: the
win-now *number* the product ultimately reports is the change in expected payout from
the matrix, and the matrix simulates *this* season — a two-year win-now blend would
smear a measurement that is otherwise exactly defined. Year two is not ignored; it
lives in the dynasty ranking (which is the market's discount of all future years,
year two most heavily) and reaches the user through the timeline slider: a contender at
75% weight is effectively pricing "this year, mostly, and next year somewhat." Building
a synthetic year-two list (e.g. age-adjusted redraft) would double-count aging that
dynasty rank already prices, and the prompt's own warning about subtraction-derived
numbers applies with equal force to blend-derived ones. If a real two-season projection
source ever exists, it can replace the redraft list wholesale rather than being
approximated.

## The dead zone threshold

**Shipped: 1% championship probability, tunable 0.2%–6%.** In a 12-team league the
uniform prior is 8.3%, so 1% means "this trade moved your title odds by less than an
eighth of an average team's share" — small enough that dead-zone moves (10th→6th with
real capital spent) reliably trip it, large enough that a genuine contender push
(+5pp and up) reliably doesn't. The warning also requires actual capital loss *net of
coupling gains* and a material projected-finish improvement, so it cannot fire on a
trade that merely shuffles bench depth. Test 18 pins both directions.

## Tight end premium: shift the curve or the input?

**Shipped: neither is hard-coded; the ranking input is the right lever, and the setting
records the league's TEP value for the user.** Reasoning: TEP changes *how good tight
ends are relative to others*, which is precisely what a format-matched ranking list
expresses — the same reason superflex uses a superflex list rather than a replacement-
level adjustment (the engine's own validation test 1 demonstrates that replacement
level alone moves QB value by <20% while the format-correct list moves it 60%+; the
same logic applies to TEP, in miniature). Shifting the curve would misprice every
non-TE. So: the league's `bonus_rec_te` is detected and displayed, and users in TEP
leagues should import a TEP list — the import path tags lists by format already. A
future refinement could auto-nudge TE positional ranks by a documented factor when TEP
is detected and no TEP list is loaded, clearly labelled as an approximation.

## Positions the ranking lists don't cover (K, DEF, IDP)

**Shipped: carried, displayed, excluded from valuation — never silently mapped.**
Sleeper slots that the model doesn't value become `UNSUPPORTED`: their players stay on
rosters (they occupy real spots, which matters for absorption), their slots are shown
in the league summary, and a warning names them. Valuing kickers off a 100-point scale
shared with running backs would be false precision; the honest statement is that a
kicker is worth approximately the waiver wire in dynasty terms. IDP leagues get the
same treatment plus the warning; deep IDP leagues are the weakest case for this app and
the interface says so rather than pretending.

## Unusual formats: best ball, multi-copy, auction contracts

**Shipped: detection and honest labelling, not bespoke models.** Best ball is detected
(`best_ball=1`) and warned: the optimizer's perfect-lineup assumption is actually
*correct* for best ball scoring, but bench depth is worth more than the model assumes.
Multi-copy leagues aren't specially handled (player IDs are unique per roster in
Sleeper's model; a duplicated-player league would value each copy independently, which
is roughly right). Auction/contract leagues carry salary constraints the model cannot
see; the league loads fine and values are still comparative, but contract cost is the
user's own overlay. None of these felt worth guessing at a model for without a real
league to test against.

## Automated ranking refresh

**Shipped: a stub that says no.** FantasyPros' terms do not permit scraping their
ranking pages, and their API is a paid/partner product. The `RankingSource` interface
is built so a licensed feed drops in as a third implementation with zero pipeline
changes. Until then: the bundled snapshot (derived from Sleeper's own free public
`search_rank` ordering plus a documented age-horizon model — provenance stated in the
UI) makes the app work out of the box, and paste/file import of a FantasyPros export is
the supported refresh path. **Decision needed from you:** whether to pursue the paid
feed; nothing else in the codebase is blocked on it.

## One more decision made without asking (flagged for review)

**The bundled snapshot's dynasty ordering is synthesized, not sourced.** Sleeper
publishes only one ordering; dynasty vs redraft and 1QB vs superflex are derived from
it via the documented QB discount (0.76 for 1QB boards, landing QB1 ~overall 15) and
the age-horizon model in `scripts/age-model.mjs`. The orderings pass smell tests
(rookies climb in dynasty, 30-year-old RBs fall, superflex QB1 goes ~4th overall), but
it is a model of a market, not the market. The UI labels it and every serious user
should import a real board. This was the only way to satisfy "works out of the box"
without scraping.
