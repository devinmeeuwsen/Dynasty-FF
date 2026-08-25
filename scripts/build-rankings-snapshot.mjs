#!/usr/bin/env node
/**
 * Build the bundled ranking snapshot.
 *
 * IMPORTANT — what this is and is not.
 *
 * The application's ranking layer is designed around FantasyPros dynasty and
 * redraft rankings. Automated retrieval of those needs a data partnership or
 * their paid feed, and this codebase does not scrape. So the bundled snapshot,
 * which exists only so the site works out of the box, is derived from a source
 * that IS free and public: Sleeper's own player feed, which publishes a
 * `search_rank` ordering for every player.
 *
 * Two transformations turn that into four usable lists:
 *
 *   1. Sleeper's ordering is superflex flavoured — six quarterbacks inside the
 *      top twenty gives it away. It is used as-is for the superflex redraft
 *      list, and a documented quarterback discount produces the one
 *      quarterback list, landing QB1 around overall sixteen and QB12 around
 *      overall seventy, which is where a real one-quarterback board puts them.
 *
 *   2. The dynasty lists re-score the same players by a discounted sum of
 *      remaining production given age and position, so rookies climb and
 *      productive thirty year olds fall.
 *
 * This is an approximation and the interface says so. Import a real
 * FantasyPros export to replace it.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { horizonMultiplier, productionAtAge } from './age-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'data', 'rankings', 'snapshots', 'bundled.json');

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const POOL_SIZE = 500;
const LAMBDA = 0.021;

/**
 * Quarterback discount for the one-quarterback board. Chosen so the top
 * quarterback lands at roughly overall sixteen: exp(-lambda * 15) / exp(-lambda * 2).
 */
const QB_STANDARD_DISCOUNT = 0.76;

const rawValue = (rank) => Math.exp(-LAMBDA * (rank - 1));

async function fetchPlayers() {
  const response = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!response.ok) throw new Error(`Sleeper players fetch failed: ${response.status}`);
  return response.json();
}

function ageOf(player) {
  if (typeof player.age === 'number' && player.age > 0) return player.age;
  if (typeof player.years_exp === 'number') return 22 + player.years_exp;
  return 25;
}

function rankBy(entries, scoreKey) {
  return [...entries]
    .sort((a, b) => b[scoreKey] - a[scoreKey] || a.searchRank - b.searchRank)
    .map((e) => e.id);
}

async function main() {
  const players = await fetchPlayers();

  const pool = Object.values(players)
    .filter(
      (p) =>
        p.active &&
        POSITIONS.has(p.position) &&
        typeof p.search_rank === 'number' &&
        p.search_rank > 0 &&
        p.search_rank < 2000 &&
        p.full_name,
    )
    .map((p) => ({
      id: p.player_id,
      name: p.full_name,
      position: p.position,
      team: p.team ?? null,
      age: ageOf(p),
      searchRank: p.search_rank,
    }))
    .sort((a, b) => a.searchRank - b.searchRank || a.name.localeCompare(b.name))
    .slice(0, POOL_SIZE);

  // Re-index so ranks are dense 1..N even where Sleeper ties search_rank.
  pool.forEach((p, i) => {
    p.denseRank = i + 1;
    p.base = rawValue(p.denseRank);
  });

  for (const p of pool) {
    // Superflex redraft: Sleeper's ordering, unmodified.
    p.redraftSuperflex = p.base;
    // One quarterback redraft: the same board with quarterbacks discounted.
    p.redraftStandard = p.position === 'QB' ? p.base * QB_STANDARD_DISCOUNT : p.base;

    // Dynasty: re-weight from a one-year horizon to a discounted multi-year
    // horizon. Dividing by this year's production is what makes it a change of
    // horizon rather than a second opinion about talent.
    const thisYear = Math.max(0.2, productionAtAge(p.position, p.age));
    const horizon = horizonMultiplier(p.position, p.age);
    p.dynastySuperflex = p.redraftSuperflex * (horizon / thisYear);
    p.dynastyStandard = p.redraftStandard * (horizon / thisYear);
  }

  const lists = {
    'redraft.overall.standard': rankBy(pool, 'redraftStandard'),
    'redraft.overall.superflex': rankBy(pool, 'redraftSuperflex'),
    'dynasty.overall.standard': rankBy(pool, 'dynastyStandard'),
    'dynasty.overall.superflex': rankBy(pool, 'dynastySuperflex'),
  };

  // Positional lists for quarterback and tight end. These supply ORDERING
  // only; the value scale always comes from the overall list.
  const byId = new Map(pool.map((p) => [p.id, p]));
  for (const [key, order] of Object.entries({
    'redraft.QB': lists['redraft.overall.superflex'],
    'redraft.TE': lists['redraft.overall.standard'],
    'dynasty.QB': lists['dynasty.overall.superflex'],
    'dynasty.TE': lists['dynasty.overall.standard'],
  })) {
    const position = key.split('.')[1];
    lists[key] = order.filter((id) => byId.get(id).position === position);
  }

  const snapshot = {
    version: 1,
    asOf: new Date().toISOString().slice(0, 10),
    provenance:
      "Derived from Sleeper's free public player feed (search_rank) with a documented " +
      'quarterback discount for one-quarterback formats and an age-and-position horizon ' +
      'model for dynasty. This is an approximation of a real FantasyPros board, not a copy ' +
      'of one. Import a FantasyPros export to replace it.',
    lambda: LAMBDA,
    qbStandardDiscount: QB_STANDARD_DISCOUNT,
    players: Object.fromEntries(
      pool.map((p) => [p.id, [p.name, p.position, p.team, p.age]]),
    ),
    lists,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot));

  const summary = (key) =>
    lists[key]
      .slice(0, 12)
      .map((id, i) => `${i + 1}.${byId.get(id).name}(${byId.get(id).position})`)
      .join(' ');
  console.log(`wrote ${OUT} — ${pool.length} players`);
  console.log('redraft standard :', summary('redraft.overall.standard'));
  console.log('redraft superflex:', summary('redraft.overall.superflex'));
  console.log('dynasty standard :', summary('dynasty.overall.standard'));
  const qbAt = (key) =>
    lists[key].findIndex((id) => byId.get(id).position === 'QB') + 1;
  console.log(
    `QB1 overall rank — redraft standard ${qbAt('redraft.overall.standard')}, superflex ${qbAt('redraft.overall.superflex')}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
