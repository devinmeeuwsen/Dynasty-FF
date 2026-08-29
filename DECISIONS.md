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

**Now shipped, from KeepTradeCut rather than FantasyPros.** FantasyPros' terms do not
permit scraping and their feed is a paid/partner product, so that door stayed shut.
KeepTradeCut is a different case, checked rather than assumed: `robots.txt` is
`Allow: /` with no disallows, there is no terms-of-service page, and the dynasty and
redraft boards are served without a login or paywall. Both boards embed the full data
as a `playersArray` literal, so one request each gets everything.

The refresh runs at **build time only** — two requests per deploy, never one per
visitor — and the result is committed, so a KeepTradeCut outage degrades to the last
good snapshot instead of breaking the site. Attribution appears in the UI and README.
An in-browser refresh is impossible regardless: those boards carry no
`access-control-allow-origin` header.

**Still worth your judgement:** this is a courtesy read of a free public site, not a
licensed feed. If this ever becomes high-traffic or commercial, ask KeepTradeCut
directly. Nothing else in the codebase is blocked on that conversation.

### Two identifier traps, both live

Keying the two boards together looked trivial and was not:

- **`playerID` is per-board.** Of the players on both boards, 184 of 281 carry a
  *different* `playerID` on each. Keying on it welded the redraft board's values onto
  the wrong dynasty names — it put a fringe receiver at redraft WR4 wearing Drake
  Maye's number. `mflid` is stable across both, present on every row and unique within
  a board. The builder validates all three of those properties on every run and then
  checks that dynasty and redraft ratings still correlate (r ≈ 0.91), which is the
  check that actually catches cross-wiring.
- **KeepTradeCut's mflids collide with Sleeper's player ids.** 25 of them are also
  valid Sleeper ids belonging to *different* players — mflid 13116 is Patrick Mahomes,
  Sleeper 13116 is Tre Watson. `matchRankings` trusts `entry.sleeperId` and skips name
  matching when it is set, so the bundled board deliberately leaves it unset and goes
  through name matching. That is asserted in the test suite.

## Superseded: the synthesized dynasty ordering

Kept for the record — the section below described the old bundled snapshot, which
derived a dynasty ordering from Sleeper's single `search_rank` list via an age model.
KeepTradeCut supplies both horizons directly, so none of it is live any more. The
builder and its age model are **deleted rather than kept as a fallback**: they wrote
the v1 snapshot format to the same path the v2 loader reads, so running one would have
silently replaced real market values with derived ones and broken the app in a way no
type check would catch. Git history has them if a Sleeper-only fallback is ever wanted.
Two things the swap fixed outright: Sleeper's `active` flag is unreliable,
so 185 of the old snapshot's 500 players had no NFL team and Tom Brady sat at dynasty
QB ~90 overall; and the age curves were this codebase's opinion, where the market's own
view is now observed directly (players 23 and under gain ~12 ranks between the redraft
and dynasty boards, players 29 and over lose ~26).

**The bundled snapshot's dynasty ordering is synthesized, not sourced.** Sleeper
publishes only one ordering; dynasty vs redraft and 1QB vs superflex are derived from
it via the documented QB discount (0.76 for 1QB boards, landing QB1 ~overall 15) and
the age-horizon model that used to live in `scripts/age-model.mjs`. The orderings pass smell tests
(rookies climb in dynasty, 30-year-old RBs fall, superflex QB1 goes ~4th overall), but
it is a model of a market, not the market. The UI labels it and every serious user
should import a real board. This was the only way to satisfy "works out of the box"
without scraping.

## The contention timeline is derived

**Changed: it used to be a user input.** Asking a manager to set their own
contention timeline asks them to answer the question the product exists to
answer, and then prices every asset off their guess. The simulation already
publishes this team's championship probability and the pipeline already knows
whether its assets expire, so the slider now reads:

    weight = clamp(0.14 + 0.90 * contention - 0.25 * futureStrength, 0, 1)

Both inputs are rank-based standings within the league rather than shares of a
total, because championship odds are heavily skewed — one dominant roster can
hold a third of them, and a share-based measure would read every other team as
hopeless. Ties share a rank, so a league of identical rosters sits at 0.5
instead of handing an arbitrary team the top spot.

`futureStrength` adds draft capital to long term roster value, because they
answer the same question: a stack of firsts and a roster of 23 year olds are
both ways of having a future, and a team that traded its picks for veterans has
neither however good it looks this season.

**Decision needed from you:** the thresholds. `dynasty` currently needs top-30%
contention and an above-median future. Those are stated in one place in
`src/engine/posture.ts` and are the numbers most worth arguing with once you
have run it against your own league.

## Playoff structure comes from the league

`playoff_round_type` decides whether rounds run one week or two. A two week
round is the sum of two independent weeks, so the mean doubles while the
standard deviation grows only by √2 — the favourite converts noticeably more
often. Modelling a two week league as one week flattens its championship odds
toward the field, so the setting is read rather than assumed, and an
unrecognised value falls back to one week because that widens the distribution
rather than falsely sharpening it.

Sleeper also publishes the real bracket at `/winners_bracket`, which is fetched
and used to report the bracket's true shape. It only exists once the playoffs
are seeded, which for a dynasty tool is the minority of the year, so the
derived reseeded bracket remains the working model and the UI says which one is
in force.

## Rookie picks are priced off the market

**Changed: they used to come from a synthetic curve.** A pick was valued by
mapping its slot to an "effective dynasty rank" and reading the same rank curve
players used. KeepTradeCut publishes what picks actually trade for, so that
guess is no longer needed.

The tiers are defined on a **twelve team board**: an early first is a 1-4
finish, mid is 5-8, late is 9-12. That makes them a statement about absolute
draft position, not about position within a round, and it is the detail that
makes smaller leagues work. The three anchors per round are laid out along the
overall pick number — 2.5, 6.5, 10.5, then 14.5, 18.5, 22.5 — and interpolated
in log space as one continuous curve. A league reads that curve at its own
overall positions, so a ten team league's 2.01 is overall pick 11 and is priced
as the back of a first round (48.0) rather than as an early second (41.9).
Scaling the tiers to the league's own round size instead would have undersold
that pick by about 15%.

A pick is then valued across the **whole row** of the draft slot matrix, never
a point estimate: a team 50% likely to finish last contributes half of a 1.01,
30% second-to-last contributes 0.3 of a 1.02, and so on. That was already the
mechanism; only the per-slot value changed.

`futureDiscountPerYear` is no longer applied on the market path. The published
board already prices a further-out draft lower, so applying both would discount
the same year twice. The year-over-year decay used to extend past the last
published year is measured from the two furthest-out years rather than assumed
— measuring it across all consecutive years produced a decay above 1.0, because
the nearest year on the board is often a draft that has already happened and
whose values have collapsed.

## Which drafts have picks left

**Fixed.** `pickSeasons` keyed off `status === 'complete'`, so a league in
`in_season` was still shown the current year's picks — which are players by
then, the rookie draft having happened. The predicate is now the same one the
schedule loader uses: only `pre_draft` and `drafting` still have this year's
picks outstanding. The range also went from two seasons to three, because
dynasty leagues routinely trade three years out and stopping at two silently
hid every pick beyond next season.

## Redraft value, and the three scalings that did not work

Rating is KeepTradeCut's dynasty value. Redraft is FantasyPros expert consensus
ORDER — a hundred analysts updated daily beat a trade market at predicting one
season — priced on the dynasty ladder read by rank position. Long term is the
difference.

That the two share one distribution is the whole point, because a difference
between differently-scaled numbers measures the scales rather than the player.
Three attempts proved it:

1. **Fitted exponential on the redraft market.** Intercept 84.3 against the
   dynasty board's 100, so the best redraft asset was capped sixteen points
   below the best dynasty one and anyone elite in both read as future leaning.
   Median difference +17.8, ninety percent of the league on one side of zero.
2. **KeepTradeCut's own redraft ladder.** Fixed the ceiling, kept the cliff.
3. **A hand-shaped logistic** — flat top, curve, flat tail, as the shape
   intuitively should be. Gave the flat shoulder but collapsed to a floor of 6
   by rank 200 where dynasty ratings are near 29, pushing the median to +10 and
   reading almost every deep player as a future asset.

What works is the dynasty ladder with a cubic shoulder over its top eight ranks.
Median 0.0, 39% of players inside the ±3 balanced band, and the shoulder stops
the ladder's 99.9-to-92.3 cliff from separating players who are interchangeable
for this season.

**FantasyPros sourcing.** Their `robots.txt` permits these pages — only
`/ajax/`, `/api/`, `/json/`, `/xml/` and `/nfl/ranker/` are disallowed — and
their `llms.txt` advertises the rankings pages to agents by name. The data is
embedded in the allowed page server side, so no disallowed endpoint is touched.
Fetched at build time only. **I could not read their Terms of Use**, which is a
JavaScript-rendered page this environment cannot execute, so that check remains
outstanding and is the one thing worth confirming before this sees real traffic.
