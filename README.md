# Dynasty FF — league-synced, roster-aware value calculator

Values for **your** league, not a league like yours. Connect a Sleeper league and every
number becomes specific to that league's settings, its actual waiver wire, your roster,
and your draft pick holdings.

## What makes it different

1. **League shape changes value.** Fewer teams or fewer bench spots means better players
   sit on waivers, which compresses ordinary players and concentrates value at the top.
   Replacement level is *observed* from the league's real rosters, not assumed.
2. **Every player carries two values.** Win now (from redraft rankings) and long term
   (from dynasty rankings), independently measured in the same units — never derived
   from each other by subtraction.
3. **Value is specific to the acquiring roster.** A player who can't crack a starting
   lineup has a marginal win-now value of exactly zero for that roster.
4. **Draft pick ownership changes the calculus.** The league is zero sum: when you
   improve, your own picks get worse and the picks you hold from teams you pass get
   better. The trade calculator re-runs the whole season simulation and shows you the
   redistribution, pick by pick.

**Governing principle:** only two outcomes have value — winning a championship, and
accumulating assets that improve future championship odds. The default payout structure
is winner-take-all (configurable for leagues that pay 2nd/3rd).

## Getting your Sleeper league in

Sleeper's API is public, needs no key, and sends `access-control-allow-origin: *`,
so the browser calls it directly. **This project needs no backend, no database and
no server** — it is a static site plus a calculation engine that runs in the
visitor's browser. Hosting is the only infrastructure required.

### Hosting

The repository is public, so **GitHub Pages is free** and is wired up in
`.github/workflows/deploy.yml`: every push to `main` runs the tests, refreshes
the player pool, builds, and publishes.

**One-time setup:** Settings → Pages → Source: **GitHub Actions**. This cannot be
automated — a workflow's `GITHUB_TOKEN` may deploy to Pages but may not create
the Pages site, so the first enable is a manual click. After that every push
deploys on its own. The site lands at

    https://devinmeeuwsen.github.io/Dynasty-FF/

Nothing else is required — no backend, no database, no server.

#### Alternatives

Any static host works, and these have free tiers that also cover private
repositories should this one ever go private again:

| Host | Free tier | Notes |
|---|---|---|
| **Cloudflare Pages** | unlimited sites, 500 builds/month, unmetered bandwidth | recommended; private repos included |
| **Netlify** | 100GB bandwidth, 300 build-minutes/month | `netlify.toml` in this repo preconfigures it |
| **Vercel** | hobby tier | `vercel.json` in this repo preconfigures it; hobby is non-commercial |

Connect the repo and use:

```
build command:      npm run build
output directory:   dist
node version:       22
```

No account linking at all? `npm run build` locally and drag the `dist/` folder
onto <https://app.netlify.com/drop>. CI also uploads `dist` as a downloadable
`site` artifact on every push.

Note that GitHub Pages is free only on public repositories; on a private one it
requires a paid plan, and enabling it fails with `Resource not accessible by
integration`. Every host above is free either way.

### Running it locally

`npm install && npm run dev`, then enter your Sleeper username and pick a league.

A claude.ai Artifact **cannot** do the live lookup: that sandbox blocks network
calls to any non-allowlisted host, which is why the companion artifact uses
paste-import. That is a restriction of the artifact sandbox, not of this app.

## Running it

```bash
npm install
npm run dev        # local dev server
npm test           # engine validation suite (48 tests, including the 20 from the spec)
npm run build      # production build (static site, dist/)
npm run snapshot:build   # regenerate the bundled ranking snapshot from Sleeper
```

No backend is required to run the app; it is a static single-page application. All
league-specific calculation happens in the browser (the Monte Carlo season simulation
runs in a web worker). The Sleeper player file (~15MB source, trimmed to ~1MB) is cached
in IndexedDB for 24 hours per Sleeper's guidance and is never fetched on page load.

## Architecture

```
src/engine/     Pure calculation engine. No UI imports, no network, no side effects.
                rank → curves → replacement → values → lineup → season sim → picks →
                scenario → trade. Each stage independently testable.
src/data/       Sleeper client + cache, ranking sources (bundled snapshot, paste/file
                import, automated-refresh stub), name matching, engine assembly.
src/workers/    The simulation worker.
src/state/      Zustand store, worker client, URL/localStorage persistence.
src/ui/         React views. Amber = win now, teal = long term, violet = blend,
                everywhere.
scripts/        Bundled-snapshot generator and its age/horizon model.
```

### Correctness invariants (tested, never patched over)

- The finish probability matrix is **doubly stochastic by construction** — every
  simulated season produces one complete finish order. No row/column normalisation is
  ever applied; if the property fails, that's a bug to find (tie handling, bracket
  seeding), and the UI shows the check.
- Every waiver-wire player's value above replacement is **exactly zero**.
- The lineup optimizer is matroid-greedy and **matches brute force** on randomized
  rosters.
- Draft capital is **approximately conserved** through any trade; the drift is reported.
- Baseline and trade scenarios share a seed, so trade deltas are signal, not Monte
  Carlo noise; identical inputs reproduce exactly.

## Rankings

Three sources behind one interface:

- **KeepTradeCut market values** (ships in the repo) — crowdsourced dynasty and redraft
  values, rescaled to 0-100. Captured at build time, twice per deploy, so a visit costs
  KeepTradeCut nothing and the app works offline on first paint. Values belong to
  [keeptradecut.com](https://keeptradecut.com) and are attributed in the UI.
- **Paste / file import** — FantasyPros CSV exports, spreadsheet pastes, or plain
  numbered lists. Overrides the bundled board.
- **Live refresh in the browser** — not available: KeepTradeCut serves HTML with no
  CORS header. Refresh happens on each deploy instead (see `DECISIONS.md`).

A source that publishes **values** is used as published — the rank→value curve is
bypassed entirely, because a value carries the gaps between players and an ordering
does not. The curve, and the rule that QB/TE take ordering from positional lists but
scale from the overall list, still apply to imported lists that carry ranks alone.

### Two columns, not one

- **Rating** — 0-100 standalone market value. Every player has one, waiver wire
  included.
- **VAR** — rating minus the best unrostered player at that position. Zero *is* the
  waiver wire; negative means the free agent pool already offers better. Signed on
  screen; the engine clamps it at zero internally, because a player who never cracks
  the lineup adds no marginal value to it.

## Key documents

- [`DECISIONS.md`](./DECISIONS.md) — every calibration decision the spec asked to have
  brought back: the decay curve, weekly variance, simulation count, pick hit rates,
  distribution width, the two-year horizon, TEP, unusual formats, and what shipped for
  each.
