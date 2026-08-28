#!/usr/bin/env node
/**
 * Bake Sleeper's player file into the build.
 *
 * The live file is ~14MB and Sleeper asks that it be fetched no more than once
 * per day. Trimmed to the seven fields this application actually reads, it is
 * about 200KB — 59KB over the wire — so shipping it removes a 14MB download
 * from every visitor's first page load and removes the only place a backend
 * would otherwise have earned its keep.
 *
 * Run by CI before each deploy, so the deployed pool is never more than one
 * release stale. Users can still pull live data on demand from Settings.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'data', 'players', 'pool.json');

// Positions the value model covers, plus the ones it carries but does not value.
const KEEP = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

const response = await fetch('https://api.sleeper.app/v1/players/nfl');
if (!response.ok) {
  console.error(`Sleeper returned ${response.status}`);
  process.exit(1);
}
const raw = await response.json();

const players = {};
for (const [id, p] of Object.entries(raw)) {
  const position = p.position ?? p.fantasy_positions?.[0];
  if (!KEEP.has(position)) continue;
  const name = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ');
  if (!name) continue;
  // Positional array rather than an object: same data, far fewer bytes.
  players[id] = [
    name,
    position,
    p.team ?? null,
    p.age ?? null,
    p.years_exp ?? null,
    p.active ? 1 : 0,
    p.search_rank ?? null,
  ];
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), players }));
console.log(`wrote ${OUT} — ${Object.keys(players).length} players`);
