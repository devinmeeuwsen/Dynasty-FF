#!/usr/bin/env node
/**
 * Build the bundled ranking snapshot from KeepTradeCut.
 *
 * KTC publishes crowdsourced market values rather than a ranking. That is a
 * strictly better input than an ordering: a rank says only who is ahead, a
 * value says by how much. Two boards carry the two horizons this product needs,
 * each in one-quarterback and superflex flavours:
 *
 *   dynasty-rankings  -> long term value
 *   fantasy-rankings  -> win now value
 *
 * Both embed the full board as a `var playersArray = [...]` literal, so one
 * request per board gets everything. This runs at BUILD time only — twice per
 * deploy, never once per visitor — and the result is committed, so a KTC
 * outage degrades to the last good snapshot instead of breaking the site.
 *
 * Values are rescaled to 0-100 by a fixed divisor rather than by each board's
 * own maximum. A fixed divisor preserves KTC's ratios exactly, so a trade that
 * balances on their calculator balances here, and it keeps ratings stable
 * across refreshes instead of shifting everything whenever the top asset moves.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'data', 'rankings', 'snapshots', 'bundled.json');

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

/** KTC pins its best asset to 9999. Fixed, so ratings do not drift on refresh. */
const KTC_MAX = 9999;

const BOARDS = [
  { horizon: 'dynasty', url: 'https://keeptradecut.com/dynasty-rankings' },
  { horizon: 'redraft', url: 'https://keeptradecut.com/fantasy-rankings' },
];

const UA =
  'Dynasty-FF/1.0 (+https://github.com/devinmeeuwsen/Dynasty-FF) build-time snapshot, 2 req/deploy';

async function fetchBoard(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return extractPlayersArray(await response.text(), url);
}

/**
 * Pull the `playersArray` literal out of the page. Scanning for the matching
 * bracket rather than regexing is what makes this safe: player names contain
 * brackets, quotes and escapes, and a lazy regex silently truncates the board.
 */
export function extractPlayersArray(html, label = 'page') {
  const marker = 'var playersArray = ';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`${label}: playersArray not found — page structure changed`);

  const from = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(from, i + 1));
    }
  }
  throw new Error(`${label}: playersArray literal never closed`);
}

/** KTC value -> 0-100 rating. */
export function toRating(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round((100 * value) / KTC_MAX * 10) / 10;
}

/**
 * Key players by `mflid`, NOT by KTC's own `playerID`.
 *
 * `playerID` is per-board: of the players appearing on both the dynasty and the
 * redraft board, well over half carry a different `playerID` on each. Keying on
 * it silently welds one board's values onto another board's names — the failure
 * that put a fringe receiver at redraft WR4 wearing Drake Maye's number. `mflid`
 * is the same on both boards, present on every row and unique within a board,
 * which the validation below re-checks on every build.
 */
const keyOf = (row) => String(row.mflid);

function boardEntries(rows, formatKey) {
  const out = [];
  for (const row of rows) {
    if (!POSITIONS.has(row.position)) continue; // drops RDP picks, DST and PK
    const rating = toRating(row[formatKey]?.value);
    if (rating == null) continue;
    out.push([keyOf(row), rating]);
  }
  // Descending rating is the board order; ties break on KTC's own rank.
  return out.sort((a, b) => b[1] - a[1]);
}

/** Reject a board whose ids are missing, duplicated, or otherwise unusable. */
function validateBoard(label, rows) {
  const players = rows.filter((r) => POSITIONS.has(r.position));
  const seen = new Map();
  for (const row of players) {
    const key = keyOf(row);
    if (!key || key === 'undefined' || key === 'null' || key === '0') {
      throw new Error(`${label}: ${row.playerName} has no mflid — cannot key this board safely`);
    }
    if (seen.has(key)) {
      throw new Error(`${label}: mflid ${key} used by both ${seen.get(key)} and ${row.playerName}`);
    }
    seen.set(key, row.playerName);
  }
  return players.length;
}

/**
 * The two boards measure the same players over different horizons, so their
 * ratings must correlate strongly. Cross-wired identifiers destroy that
 * correlation while leaving both boards individually well formed, so this is
 * the check that actually catches the failure mode described above.
 */
function crossBoardCorrelation(dynastyBoard, redraftBoard) {
  const dyn = new Map(dynastyBoard);
  const pairs = redraftBoard.filter(([id]) => dyn.has(id)).map(([id, r]) => [dyn.get(id), r]);
  if (pairs.length < 50) {
    throw new Error(`only ${pairs.length} players on both boards — identifiers are not lining up`);
  }
  const n = pairs.length;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / n;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  return { r: num / Math.sqrt(dx * dy), n };
}

async function main() {
  const fetched = {};
  for (const board of BOARDS) {
    fetched[board.horizon] = await fetchBoard(board.url);
    const kept = validateBoard(board.horizon, fetched[board.horizon]);
    console.log(`${board.horizon}: ${fetched[board.horizon].length} rows, ${kept} players — ids ok`);
  }

  // One player record per mflid, preferring the dynasty board's metadata since
  // it is the deeper of the two.
  const players = {};
  for (const horizon of ['redraft', 'dynasty']) {
    for (const row of fetched[horizon]) {
      if (!POSITIONS.has(row.position)) continue;
      players[keyOf(row)] = [
        row.playerName,
        row.position,
        row.team ?? null,
        typeof row.age === 'number' ? Math.round(row.age * 10) / 10 : null,
      ];
    }
  }

  const boards = {
    'dynasty.standard': boardEntries(fetched.dynasty, 'oneQBValues'),
    'dynasty.superflex': boardEntries(fetched.dynasty, 'superflexValues'),
    'redraft.standard': boardEntries(fetched.redraft, 'oneQBValues'),
    'redraft.superflex': boardEntries(fetched.redraft, 'superflexValues'),
  };

  for (const [key, board] of Object.entries(boards)) {
    const orphan = board.find(([id]) => !players[id]);
    if (orphan) throw new Error(`${key}: entry ${orphan[0]} has no player record`);
  }

  const { r, n } = crossBoardCorrelation(boards['dynasty.superflex'], boards['redraft.superflex']);
  console.log(`cross-board correlation r=${r.toFixed(3)} over ${n} shared players`);
  if (r < 0.5) {
    throw new Error(
      `dynasty and redraft ratings correlate at only ${r.toFixed(3)} — identifiers are ` +
        'almost certainly cross-wired between the two boards',
    );
  }

  const snapshot = {
    version: 2,
    source: 'keeptradecut',
    asOf: new Date().toISOString().slice(0, 10),
    provenance:
      'Crowdsourced dynasty and redraft market values from KeepTradeCut, rescaled to 0-100. ' +
      'Long term reads the dynasty board, win now reads the redraft board; the two are ' +
      'independent measurements, not one derived from the other.',
    attribution: { name: 'KeepTradeCut', url: 'https://keeptradecut.com' },
    ktcMax: KTC_MAX,
    players,
    boards,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot));

  const top = (key) =>
    boards[key]
      .slice(0, 8)
      .map(([id, rating], i) => `${i + 1}.${players[id][0]}(${players[id][1]} ${rating})`)
      .join(' ');

  console.log(`\nwrote ${OUT} — ${Object.keys(players).length} players`);
  for (const key of Object.keys(boards)) {
    console.log(`${key.padEnd(19)} ${boards[key].length.toString().padStart(3)} — ${top(key)}`);
  }
}

// Only run when invoked directly, so the parser stays unit testable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
