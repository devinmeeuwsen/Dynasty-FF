#!/usr/bin/env node
/**
 * Build the bundled ranking snapshot from KeepTradeCut.
 *
 * KTC publishes crowdsourced market values rather than a ranking. That is a
 * strictly better input than an ordering: a rank says only who is ahead, a
 * value says by how much. Two boards carry the two horizons this product needs,
 * each in one-quarterback and superflex flavours:
 *
 *   dynasty-rankings  -> the player's Rating, the single dynasty number
 *   fantasy-rankings  -> the shape the redraft curve is fitted to
 *
 * Redraft ORDER comes from FantasyPros expert consensus rather than from
 * KeepTradeCut, because a hundred analysts updated daily beat a crowdsourced
 * trade market at the question of who scores most this season.
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

/** KeepTradeCut's own position code for a rookie draft pick. */
const PICK_POSITION = 'RDP';

/** `2027 Early 1st` -> year 2027, round 1, tier early. */
const PICK_NAME = /^(\d{4})\s+(Early|Mid|Late)\s+(\d)(?:st|nd|rd|th)$/i;
const TIERS = ['early', 'mid', 'late'];

/** KTC pins its best asset to 9999. Fixed, so ratings do not drift on refresh. */
const KTC_MAX = 9999;

/**
 * FantasyPros expert consensus, which is the redraft opinion this product
 * uses. Their robots.txt permits these pages (only /ajax/, /api/, /json/,
 * /xml/ and /nfl/ranker/ are disallowed) and their llms.txt advertises them
 * to agents by name. The rankings are embedded in the page server side, so no
 * disallowed endpoint is touched. Fetched at build time only, once per deploy.
 */
const FP_BOARDS = [
  { format: 'standard', url: 'https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php' },
  { format: 'superflex', url: 'https://www.fantasypros.com/nfl/rankings/ppr-superflex-cheatsheets.php' },
];

const BOARDS = [
  { horizon: 'dynasty', url: 'https://keeptradecut.com/dynasty-rankings' },
  { horizon: 'redraft', url: 'https://keeptradecut.com/fantasy-rankings' },
];

const UA =
  'Dynasty-FF/1.0 (+https://github.com/devinmeeuwsen/Dynasty-FF) build-time snapshot, 2 req/deploy';

/** Pull the `ecrData` object out of a FantasyPros rankings page. */
export function extractEcrData(html, label = 'page') {
  const marker = 'var ecrData';
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`${label}: ecrData not found — page structure changed`);
  const from = html.indexOf('{', at);
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
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(from, i + 1));
    }
  }
  throw new Error(`${label}: ecrData object never closed`);
}

async function fetchFantasyPros(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return extractEcrData(await response.text(), url);
}

/**
 * Fit `value = A * exp(-lambda * (rank - 1))` to a board by least squares on
 * the log values.
 *
 * The redraft market is far flatter than the dynasty one — lambda comes out
 * around 0.0055 against the dynasty board's 0.021 — so reusing the dynasty
 * constant would put redraft values on a scale roughly four times steeper.
 * Since long term value is the DIFFERENCE between the two, that mismatch does
 * not cancel: it shifted the whole column by about +17 and made ninety percent
 * of the league read as future leaning. Fitting the curve to the board it is
 * meant to represent is what makes the subtraction mean anything.
 */
export function fitDecay(values) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  values.forEach((v, i) => {
    if (!(v > 0)) return;
    const x = i;
    const y = Math.log(v);
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  });
  if (n < 10) throw new Error('not enough points to fit a redraft curve');
  const lambda = -(n * sxy - sx * sy) / (n * sxx - sx * sx);
  const scale = Math.exp((sy + lambda * sx) / n);
  if (!(lambda > 0) || !(scale > 0)) {
    throw new Error(`redraft curve fit is degenerate: scale ${scale}, lambda ${lambda}`);
  }
  return { scale: Math.round(scale * 100) / 100, lambda: Math.round(lambda * 1e6) / 1e6 };
}

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

/** Reduce a name to a stable key for cross-source matching. */
const norm = (x) =>
  String(x)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '')
    .replace(/(jr|sr|ii|iii|iv|v)$/, '');

/**
 * FantasyPros ranks, matched onto KeepTradeCut's player keys.
 *
 * Matched here rather than at runtime so a name FantasyPros spells differently
 * fails the build loudly instead of silently dropping a player's redraft value
 * to zero in someone's league. Position must agree: a name collision across
 * positions is a different person.
 */
function redraftRanks(ecrData, players) {
  const byNamePos = new Map();
  for (const [key, row] of Object.entries(players)) {
    byNamePos.set(`${norm(row[0])}|${row[1]}`, key);
  }

  const ranked = ecrData.players
    .filter((p) => POSITIONS.has(p.player_position_id))
    .sort((a, b) => a.rank_ecr - b.rank_ecr);

  const out = [];
  const unmatched = [];
  ranked.forEach((p, index) => {
    const key = byNamePos.get(`${norm(p.player_name)}|${p.player_position_id}`);
    // Rank is re-indexed over skill positions only, so kickers and defences
    // sitting in the published list do not push everyone down the curve.
    if (key) out.push([key, index + 1]);
    else unmatched.push(`${p.player_name} (${p.player_position_id})`);
  });
  return { ranks: out, considered: ranked.length, unmatched };
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

/**
 * Tight end premium variants. KeepTradeCut publishes a full board for each
 * scoring level, nested under the same format object.
 *   tep   ~ +0.5 PPR for tight ends
 *   tepp  ~ +1.0
 *   teppp ~ +1.5
 */
const TE_VARIANTS = ['tep', 'tepp', 'teppp'];

function ratingOf(row, formatKey, variant) {
  const format = row[formatKey];
  if (!format) return null;
  return toRating(variant ? format[variant]?.value : format.value);
}

function boardEntries(rows, formatKey, variant = null) {
  const out = [];
  for (const row of rows) {
    if (!POSITIONS.has(row.position)) continue; // drops RDP picks, DST and PK
    const rating = ratingOf(row, formatKey, variant);
    if (rating == null) continue;
    out.push([keyOf(row), rating]);
  }
  // Descending rating is the board order; ties break on KTC's own rank.
  return out.sort((a, b) => b[1] - a[1]);
}

/**
 * A tight end premium changes what tight ends are worth and nothing else.
 *
 * That is what makes storing these as overrides rather than as twelve more
 * full boards correct rather than merely compact: the non-tight-end half of
 * every variant board is byte-identical to the base board. Verified here on
 * every build, because if KeepTradeCut ever started moving other positions
 * under a premium, silently keeping the base values would be wrong.
 */
function teOverride(rows, formatKey, variant) {
  const out = [];
  for (const row of rows) {
    if (!POSITIONS.has(row.position)) continue;
    const base = ratingOf(row, formatKey, null);
    const premium = ratingOf(row, formatKey, variant);
    if (base == null || premium == null) continue;
    if (row.position === 'TE') {
      out.push([keyOf(row), premium]);
    } else if (Math.abs(premium - base) > 1e-9) {
      throw new Error(
        `${formatKey}/${variant}: ${row.playerName} is a ${row.position} but its value ` +
          `moves under a tight end premium (${base} -> ${premium}). The override model ` +
          'assumes only tight ends move; revisit it.',
      );
    }
  }
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

/**
 * Rookie pick values, which the market prices separately from players.
 *
 * KeepTradeCut publishes three tiers per round per year — early, mid, late —
 * rather than a value per draft slot. Those three anchors are stored as
 * published; interpolating them across a league's actual slot count is the
 * engine's job, because it depends on how many teams the league has.
 *
 * Picks carry no `mflid` (every one of them reports 0), so they are keyed by
 * year, round and tier instead. Keying them the way players are keyed would
 * collide all thirty six onto one entry.
 */
function rookiePicks(rows, formatKey) {
  const out = {};
  for (const row of rows) {
    if (row.position !== PICK_POSITION) continue;
    const match = PICK_NAME.exec(String(row.playerName).trim());
    if (!match) continue;
    const [, year, tier, round] = match;
    const rating = toRating(row[formatKey]?.value);
    if (rating == null) continue;
    out[year] ??= {};
    out[year][round] ??= {};
    out[year][round][tier.toLowerCase()] = rating;
  }
  // Drop any year/round that did not produce all three tiers: a partial set
  // would interpolate off a shape the market never published.
  for (const [year, rounds] of Object.entries(out)) {
    for (const [round, tiers] of Object.entries(rounds)) {
      if (TIERS.some((t) => typeof tiers[t] !== 'number')) delete rounds[round];
    }
    if (Object.keys(rounds).length === 0) delete out[year];
  }
  return out;
}

/**
 * How much a draft loses per year of distance, measured rather than assumed.
 *
 * Measured across the two FURTHEST-OUT published years only. The nearest year
 * on the board is often a draft that has already happened — its picks are
 * players now and its values have collapsed — so a ratio involving it runs
 * backwards. Including one here produced a decay above 1.0, which would have
 * had a 2029 pick worth more than a 2028 one.
 */
function yearDecayOf(picks) {
  const years = Object.keys(picks)
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length < 2) return 0.85;

  const from = picks[String(years[years.length - 2])];
  const to = picks[String(years[years.length - 1])];
  const ratios = [];
  for (const round of Object.keys(to)) {
    if (!from[round]) continue;
    for (const tier of TIERS) {
      const a = from[round][tier];
      const b = to[round][tier];
      if (a > 0 && b > 0) ratios.push(b / a);
    }
  }
  if (ratios.length === 0) return 0.85;
  ratios.sort((a, b) => a - b);
  const median = ratios[ratios.length >> 1];
  if (!(median > 0.4 && median < 1)) {
    throw new Error(
      `rookie pick year decay came out at ${median.toFixed(3)} between ${years[years.length - 2]} ` +
        `and ${years[years.length - 1]} — a draft further away should be worth less, not more`,
    );
  }
  return Math.round(median * 1000) / 1000;
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

  const FORMATS = [
    ['dynasty', 'standard', 'oneQBValues'],
    ['dynasty', 'superflex', 'superflexValues'],
    ['redraft', 'standard', 'oneQBValues'],
    ['redraft', 'superflex', 'superflexValues'],
  ];

  const boards = {};
  const teOverrides = {};
  for (const [horizon, qb, formatKey] of FORMATS) {
    boards[`${horizon}.${qb}`] = boardEntries(fetched[horizon], formatKey);
    for (const variant of TE_VARIANTS) {
      const rows = teOverride(fetched[horizon], formatKey, variant);
      if (rows.length) teOverrides[`${horizon}.${qb}.${variant}`] = rows;
    }
  }

  for (const [key, board] of Object.entries({ ...boards, ...teOverrides })) {
    const orphan = board.find(([id]) => !players[id]);
    if (orphan) throw new Error(`${key}: entry ${orphan[0]} has no player record`);
  }

  // Picks are a long term asset only, so they are read off the dynasty board
  // and never the redraft one.
  const picks = {
    standard: rookiePicks(fetched.dynasty, 'oneQBValues'),
    superflex: rookiePicks(fetched.dynasty, 'superflexValues'),
  };
  for (const [qb, table] of Object.entries(picks)) {
    const years = Object.keys(table).sort();
    if (years.length < 2) {
      throw new Error(`rookie picks (${qb}): only ${years.length} year(s) published — cannot extend`);
    }
    console.log(
      `rookie picks ${qb.padEnd(9)} years ${years.join(', ')} — ` +
        `${Object.values(table).reduce((n, r) => n + Object.keys(r).length, 0)} year/round pairs`,
    );
  }
  const pickYearDecay = {
    standard: yearDecayOf(picks.standard),
    superflex: yearDecayOf(picks.superflex),
  };
  console.log(`rookie pick year-over-year decay: ${JSON.stringify(pickYearDecay)}`);

  // FantasyPros supplies the redraft ORDER; the curve it is read through is
  // fitted to KeepTradeCut's own redraft board, so redraft values land on the
  // same scale as the dynasty ratings they get subtracted from.
  const redraft = {};
  for (const { format, url } of FP_BOARDS) {
    const ecrData = await fetchFantasyPros(url);
    const { ranks, considered, unmatched } = redraftRanks(ecrData, players);
    const fit = fitDecay(boards[`redraft.${format}`].map(([, v]) => v));
    redraft[format] = { ...fit, ranks };
    console.log(
      `fantasypros ${format.padEnd(9)} ${considered} ranked, ${ranks.length} matched, ` +
        `${unmatched.length} unmatched — curve scale ${fit.scale} lambda ${fit.lambda}`,
    );
    if (ranks.length < 200) {
      throw new Error(
        `fantasypros ${format}: only ${ranks.length} players matched the KeepTradeCut board — ` +
          'name matching has broken',
      );
    }
  }

  /**
   * FantasyPros publishes no tight end premium variant, so the lift KTC's own
   * premium boards show is carried over as a single multiplier per variant.
   * An average rather than a per-player figure, which is an approximation —
   * but the alternative is a premium league pricing its tight ends off a board
   * that does not know the premium exists.
   */
  const teLift = {};
  for (const [key, rows] of Object.entries(teOverrides)) {
    const base = new Map(boards[key.split('.').slice(0, 2).join('.')] ?? []);
    const lifts = rows.map(([id, r]) => r / base.get(id)).filter((x) => Number.isFinite(x) && x > 0);
    if (lifts.length) {
      teLift[key] = Math.round((lifts.reduce((a, b) => a + b, 0) / lifts.length) * 1000) / 1000;
    }
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
    version: 3,
    source: 'keeptradecut',
    asOf: new Date().toISOString().slice(0, 10),
    provenance:
      'Crowdsourced dynasty and redraft market values from KeepTradeCut, rescaled to 0-100. ' +
      'Long term reads the dynasty board, win now reads the redraft board; the two are ' +
      'independent measurements, not one derived from the other.',
    attribution: [
      { name: 'KeepTradeCut', url: 'https://keeptradecut.com', supplies: 'dynasty values and rookie picks' },
      { name: 'FantasyPros', url: 'https://www.fantasypros.com', supplies: 'redraft expert consensus order' },
    ],
    ktcMax: KTC_MAX,
    players,
    boards,
    // Tight ends only. Merged over the matching base board at load time.
    teOverrides,
    // Rookie draft picks: three tier anchors per year and round.
    rookiePicks: picks,
    pickYearDecay,
    // FantasyPros expert consensus order, plus the curve fitted to the
    // KeepTradeCut redraft board that turns a rank into a 0-100 value.
    redraft,
    teLift,
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
  console.log(`\ntight end premium overrides (tight ends only):`);
  for (const key of Object.keys(teOverrides)) {
    const rows = teOverrides[key];
    const base = new Map(boards[key.split('.').slice(0, 2).join('.')]);
    const lift = rows.map(([id, r]) => r / base.get(id)).filter(Number.isFinite);
    const mean = lift.reduce((a, b) => a + b, 0) / Math.max(1, lift.length);
    console.log(`  ${key.padEnd(28)} ${String(rows.length).padStart(3)} TEs, mean lift x${mean.toFixed(3)}`);
  }
}

// Only run when invoked directly, so the parser stays unit testable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
