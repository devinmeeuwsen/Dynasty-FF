import pool from './players/pool.json';
import type { SleeperPlayer } from './sleeper';

/**
 * The player file, baked into the build.
 *
 * Sleeper's live file is ~14MB. Trimmed to the fields this application reads it
 * is 59KB over the wire, so it ships with the app and the first page load costs
 * no network at all. `scripts/build-player-pool.mjs` regenerates it, and CI runs
 * that before every deploy so the shipped pool tracks each release.
 *
 * Users who want data newer than the last deploy can pull live from Settings;
 * that path writes through the same cache and takes precedence from then on.
 */

type Row = [
  name: string,
  position: string,
  team: string | null,
  age: number | null,
  yearsExp: number | null,
  active: 0 | 1,
  searchRank: number | null,
];

interface Pool {
  asOf: string;
  players: Record<string, Row>;
}

const data = pool as unknown as Pool;

let expanded: Record<string, SleeperPlayer> | null = null;

export function bundledPlayers(): Record<string, SleeperPlayer> {
  if (expanded) return expanded;
  const out: Record<string, SleeperPlayer> = {};
  for (const [id, row] of Object.entries(data.players)) {
    out[id] = {
      player_id: id,
      full_name: row[0],
      position: row[1],
      team: row[2],
      age: row[3],
      years_exp: row[4],
      active: row[5] === 1,
      search_rank: row[6],
      injury_status: null,
      number: null,
    };
  }
  expanded = out;
  return out;
}

/** The date the shipped pool was built. */
export const bundledPlayersAsOf = data.asOf;

export const bundledPlayerCount = Object.keys(data.players).length;
