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

## Depth belongs in team strength, and only the first backup does

Before this change a team's strength was its optimal starting lineup and
nothing else, which meant a team with the league's best bench and a team with
an empty one projected identically, and acquiring a backup quarterback moved a
championship probability by exactly zero.

The fix is not a fudge factor on the bench. A starter misses weeks — one bye in
fourteen, plus roughly an eighth of the rest to injury — and when he does, the
slot is filled by the best eligible bench player rather than by a waiver claim,
so the team keeps that player's value above replacement instead of losing all
of it. Depth is therefore worth exactly the probability that it gets used:

    depth = P(starting slot needs covering) × best eligible backup's value

with the probability set at 0.2. That single expression also decides how far
down the bench to count, which is the part worth stating plainly. The second
backup at a position only plays when the starter AND the first backup are both
out, which is q² ≈ 4% — inside the noise of everything else in the model. Depth
past the first body is not a rounding error being ignored; it is genuinely
close to worthless, which is why a fourth running back does nothing for a team
and a second quarterback does.

One backup per SLOT CLASS, not per position. A lineup of QB / RB / RB / WR / WR
/ WR / TE / FLEX yields five backup slots — QB, RB, WR, TE, FLEX — because the
two running back slots are already covered by one body for the same reason the
second backup does not matter. Assigning those backups is the same problem as
assigning starters, so it runs through the same matroid-greedy optimizer: a
team is never credited for a backup arrangement it could not actually field.

The waiver wire still contributes nothing, at either line, because a free agent
has a value above replacement of exactly zero by construction.

## Superseded: a freed roster spot is worth zero

The claim was that an empty seat earns nothing, because every value here is
measured above replacement and replacement level IS the best free agent, so the
player who fills the seat is worth exactly zero by construction.

That reasoning proves less than it appears to, and it took a user pushing back
to see it. Value above replacement asks how much better a player is than one
you could sign for free — a question that silently assumes you have a spot to
put the free one in. When roster capacity binds, that assumption is precisely
what is in doubt. The yardstick cannot measure the seat, and a limitation of
the instrument was being reported as a result.

## What an open roster spot is worth

An option, and a repeatable one. Sign a wire player; keep him if he climbs;
drop him for nothing and draw again if he does not. The expectation of any
single draw is zero, which is what replacement level means, but you hold the
right and not the obligation to keep the result. So the seat earns

    E[max(0, drift)]   rather than   E[drift]

a call struck at the money and re-struck every week. Its whole value is
volatility, and volatility is never negative. The intuition that an empty seat
is worth something is the payoff structure of a call, which is why it feels
like value even though the average signing is worthless.

The default is 3, and unlike the 0.80 gap retention it is an ESTIMATE rather
than a measurement — one snapshot cannot observe how often wire players break
out. Twelve teams times roughly three speculative seats is thirty-six seats
chasing maybe three to five players a season who go from unrostered to
genuinely startable at around thirty points of value. That puts a speculative
seat next to a mediocre first backup, which matches how managers treat them. It
lives in settings precisely because it is a judgement rather than a finding.

It lands in the win-now column AND the future column at the same size. That is
not double counting: the scale is a weighted average, so a value present in
both contributes exactly itself whatever the team's posture. It is also the
correct behaviour — a wire breakout serves a contender as depth and a rebuilder
as an asset, so the seat is worth the same to either and only the use differs.

The cost of NOT having a seat is the other half, and it was already here. A
team at its limit that receives more bodies than it sends must release somebody
it chose over the wire, and the cheapest legal cut is charged against it.
Overage a league already has is never charged: Sleeper counts injured reserve
and taxi players in the same list, so a legal roster can read as over the limit.

## Surplus is measured over a horizon, against like

A player can be worth ten points on the open market and nothing at all to the
team holding him — behind two starters and a backup, he does not move that
team's strength by a hundredth of a point. Until both figures are visible, the
trade converting him into a pick reads as a plain loss, and that was the most
common way this calculator misled its reader.

Getting the comparison right took two corrections.

The first version subtracted one season of lineup contribution from a dynasty
rating. Those price different spans — a rating covers a whole remaining career,
call it eight years — so every good player came out looking like surplus. In
this league it ranked a franchise back at 69.8 market and 27.4 used ahead of a
buried receiver at 10.0 and 0.0, exactly backwards.

The second version dodged that by making surplus binary: his whole market value
when the roster does not use him, nothing when it does. Correct as far as it
went, and still wrong in the other direction. A single season is too short. A
rookie behind two starters contributes nothing this year and everything two
years from now, and a one-year window cannot tell him apart from a
thirty-year-old in the same seat.

So the reading now carries three numbers, and the subtraction happens between
the two that share a footing:

    market    dynasty value above replacement — portable currency, untouched
    horizon   worth to a team that starts him, over three seasons
    used      worth to THIS roster, over the same three seasons
    surplus   horizon - used, floored at zero

Both `horizon` and `used` are discounted averages of the same projected season
values over the same window, so the difference is real: value this roster
cannot extract. The weights sum to one, which keeps the result on the value
scale — three seasons of a flat player is worth what one season is, not three
times as much.

The elite case is the test the design has to pass, and it does. A star starts
for anyone, so his `used` sits close to his `horizon` on every roster in the
league and his idle share stays low — you cannot buy one cheap by finding a
team with no use for him, because there is no such team. Measured on the
fixture league, the top players extract between 82% and 100% of their value
while the median rostered player extracts 56%; the gap is depth players, which
is the correct signal.

Usage is marginal, and deliberately so: on a roster three deep at a position
the next man up absorbs most of what a player does, so the team genuinely is
not getting what the league would pay. That is what makes the number
team-specific and what makes a two-sided trade legible.

Long term value stays at market rather than being discounted per team. The
moment it stops being portable, two sides can no longer agree on what anything
is worth, and the two-sided scale goes with it. Surplus sits alongside it.

## Projecting redraft value forward, at a measured rate

Long term value is a player's dynasty rating minus his redraft value: what the
market pays him for his career, less what this season alone is worth. That gap
is a forecast, so it can be run forward:

    projectedRedraft(n) = redraft + (1 − RETENTION^n) × longTerm

A balanced player has no gap and does not move. A future asset's redraft value
rises. A win now player's falls. That is exactly what the three timeline labels
already promise, made quantitative.

RETENTION is measured rather than chosen. Across the 389 players carrying an
age on both boards, the mean gap among future leaning players falls from 7.78
at age 22 to 2.58 at age 27; the geometric mean of the year over year ratios
across that range is 0.80. So a fifth of the gap arrives in a year and about
36% within two.

Two limits, stated because they both point the same way. The measurement is
cross sectional — different players at different ages, not the same player
tracked forward — so it is attenuated by survivorship: the 22 year olds who
bust leave the board rather than reappearing at 23 with a closed gap. And the
same rate is applied to the declining branch, where the cross section cannot
separate a genuinely widening gap from that survivorship running in reverse.
Both errors understate movement, so the projection is conservative.

Picks join a team's projected column in the season they are drafted, on the
same clock as everyone else. Their contribution is scaled rather than clamped,
which is the one approximation in the module.

What this is NOT is a forecast of the league. It is the value each team holds
today, carried forward — the trades and waiver claims that will happen in
between are exactly the part nobody can project, and pretending otherwise would
be the least honest number in the application.

## The trade scale has two readings and no verdict

KeepTradeCut's calculator puts one bar across the middle and tips it toward
whoever won. That question does not survive contact with dynasty: a contender
buying this season and a rebuilder selling it are not competing for the same
thing, and a deal can be genuinely good for both. Collapsing that into a winner
would destroy the premise of the product.

So there are two bars, one per team, each measuring that team's gain against
its own goals — weighted by the posture the simulation infers for THAT team,
not by the user's own slider. Both bars being green is a real and common
outcome rather than a bug in the scale. The weight per side stays draggable,
because a manager can know something the model does not, and dragging one side
never moves the other.

The two components blend honestly because they are already in the same units:
this season's team strength and long term value are both value above
replacement. The blend is a quantity, not an index.

## The trade evaluates itself

There is no Evaluate button because there is no question it would answer. The
proposal on screen is the one the user wants priced, and a button only ever
lets the result below disagree with the builder above it. The run is debounced
so building a three player side simulates the season once rather than three
times, and the store carries a sequence number so a reply that arrives after a
newer edit is dropped rather than repainting the panel with numbers for a trade
that no longer exists.


## A column that carries a source's name carries that source's value

The Players table labelled a column "Rating", hinted it as "KeepTradeCut's
dynasty value on a 0-100 scale", and then rendered
`blendedRating(player, contentionWeight)` into it. The contention slider was
being multiplied into a number attributed to somebody else.

It was not a rounding difference. At a weight of 0.55 it lifted CeeDee Lamb
from his real 74.6 to 80.2 and moved him from fourteenth on the board to
seventh; it pushed Puka Nacua up seven points and pulled Brock Bowers down
seven. Because the column was also the default sort key, the whole board
reordered itself according to a setting, while claiming to show a market
everyone can check independently.

The bug survived because it is invisible at the far-left stop of the slider,
where the blend equals the rating exactly. Anyone verifying it on a full
rebuild team would have seen the right numbers.

Rating is now the player's rating and VAR is that rating's value above
replacement. The blend was briefly kept as its own column, and then removed
outright: once every other column stated a source value, a column that mixed
two of them by a slider had nothing to say that the two columns beside it did
not say more clearly. The trade card's blended rating and blended VAR went with
it — the card now shows both value-over-replacement figures, each against its
own board, which is what it was already showing in a second attribute anyway.

Nothing on the players table moves with the contention timeline now. The slider
still drives posture, the two-sided trade scale, and the per-side sliders on it;
it just no longer edits numbers attributed to a source.

An audit against a live KeepTradeCut fetch confirms
the boards themselves were never wrong: dynasty one-quarterback and superflex
both match to a mean absolute difference of 0.08 across 463 players, the tight
end premium variants match to 0.2, and the rookie pick tiers match to a tenth.

Two other things fell out of the same read. The sort had `case 'longTerm'`
twice, so ordering by Long term silently ordered by rating. And the browser
smoke now asserts the board is monotonically descending in the Rating column,
because both of these were display bugs that every unit test passed straight
through.


## Whose team the app opens on

Every view resolves "your team" from `userRosterId`, which `selectLeague` sets
by looking the signed-in user up in the league's owner map. On a reload that
came back null, because hydration restored the persisted USERNAME and then went
straight to `selectLeague`, which reads the user OBJECT — still null, since
nothing had looked the name up yet.

So after any refresh the roster page opened on somebody else's team, the
contention timeline read somebody else's championship odds, and draft capital
listed somebody else's picks. It only looked right in the session where the
league was first connected, which is exactly the session in which it would be
tested.

Sleeper's user id is now persisted alongside the username, and `selectLeague`
resolves identity from the live user or that id, whichever it has. Shared links
deliberately carry a null id: whoever opens one looks up their own name, and
until they do no roster is marked as theirs — far better than telling a visitor
that somebody else's team is.

The capital page gained the team dropdown the roster page already had, so
another team's picks can be inspected without the page having to guess.

## The quadrant labels were on the wrong halves

The scatter plots long term value on x and win now on y, which makes the
off-diagonal corners read backwards from the natural phrasing: high on the long
term axis with nothing this season is a REBUILDING asset, and the opposite
corner is a win now one. The two labels were swapped, so every player in the
high-win-now corner was filed under rebuilding and vice versa. The browser
smoke now asserts the win now label sits left of the rebuilding one.

## The positional curve shows a floor, not two verticals

It carried vertical markers for the observed and simulated replacement levels.
They sat close together often enough that the labels overlapped into an
unreadable smear, and a vertical line answers "how many players deep is
replacement" when the question the curve is asking is "how far above free is
this player". A horizontal line at the wire answers that one: everything above
it is worth owning, the gap down to it is the player's value, and the curve
flattening into the line is the moment depth stops mattering at that position.

The observed-against-simulated comparison did not disappear; it lives in the
table below the chart, which is a better place for two numbers that want to be
read against each other precisely.
