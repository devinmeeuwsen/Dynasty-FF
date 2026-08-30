#!/usr/bin/env node
/**
 * Browser smoke test against a synthetic synced league.
 *
 * Every Sleeper endpoint is intercepted and answered from fixtures, so this
 * drives the real built bundle down the full synced path — username lookup,
 * league selection, the worker simulation, every view — with no network and no
 * real account.
 *
 * This exists because the unit suite cannot see the class of bug that matters
 * most here. A React render loop from a store selector that returns a fresh
 * object passes all 65 tests and then blanks the page the moment a league
 * connects. That shipped once; this is what caught it.
 *
 *   npm run build && node scripts/smoke-synced.mjs
 *
 * Exits non-zero on any page error, so it can gate a deploy.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Playwright is deliberately NOT a dependency of this project: it would put a
 * browser download in front of every `npm install` for a script most
 * contributors never run. Resolved at runtime instead, from the project or
 * from a global install.
 */
async function loadChromium() {
  const require = createRequire(import.meta.url);
  const candidates = ['playwright', 'playwright-core', '@playwright/test'];
  for (const name of candidates) {
    try {
      return (await import(name)).chromium;
    } catch {
      try {
        return require(name).chromium;
      } catch {
        /* try the next one */
      }
    }
  }
  // Fall back to the global install, which is where a machine that runs this
  // occasionally usually has it.
  let globalRoot = '';
  try {
    globalRoot = (await import('node:child_process'))
      .execSync('npm root -g', { encoding: 'utf8' })
      .trim();
  } catch {
    /* npm not on PATH; the NODE_PATH sweep below may still find it */
  }
  const dirs = [globalRoot, ...(process.env.NODE_PATH ?? '').split(path.delimiter)].filter(Boolean);
  for (const dir of dirs) {
    for (const name of candidates) {
      for (const entry of ['index.mjs', 'index.js']) {
        const file = path.join(dir, name, entry);
        if (fs.existsSync(file)) return (await import(`file://${file}`)).chromium;
      }
    }
  }
  console.error(
    'This smoke test needs Playwright, which is not a project dependency.\n' +
      '  npm i -g playwright   (or)   npx playwright@1 install chromium\n' +
      'then re-run: npm run build && npm run smoke',
  );
  process.exit(2);
}

const chromium = await loadChromium();

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const OUT = process.env.SMOKE_OUT ?? path.join(ROOT, '.smoke');
fs.mkdirSync(OUT, { recursive: true });

// Draft from the shipped board so the fixture league contains real players at
// real values, which is what makes the derived posture meaningful here.
const board = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/data/rankings/snapshots/bundled.json'), 'utf8'),
);
const sleeperPool = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/data/players/pool.json'), 'utf8'),
).players;
const norm = (x) => x.toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv)$/, '');
const byName = new Map();
for (const [id, r] of Object.entries(sleeperPool)) byName.set(`${norm(r[0])}|${r[1]}`, id);
const ids = [];
for (const [key] of board.boards['dynasty.superflex']) {
  const p = board.players[key];
  const sid = byName.get(`${norm(p[0])}|${p[1]}`);
  if (sid) ids.push(sid);
  if (ids.length >= 192) break;
}

const TEAMS = 12, SPOTS = 16;
const NAMES = ['Gridiron Collective','Autumn Dynasty','Fourth and Long','The Reclamation','Northside Syndicate','Paper Champions','Slow Burn FC','Terminal Velocity','The Long Game','Salary Dump','Rebuild Season','Window Open'];

// Snake draft the mapped pool so team strength varies realistically.
const rosters = Array.from({ length: TEAMS }, () => []);
let p = 0;
for (let round = 0; round < SPOTS && p < ids.length; round++) {
  const order = round % 2 === 0 ? [...rosters.keys()] : [...rosters.keys()].reverse();
  for (const t of order) { if (p < ids.length) rosters[t].push(ids[p++]); }
}

const users = Array.from({ length: TEAMS }, (_, i) => ({
  user_id: `u${i + 1}`, display_name: NAMES[i], metadata: { team_name: NAMES[i] },
}));

const league = {
  league_id: 'L1', name: 'The Proving Ground', season: '2026', sport: 'nfl',
  total_rosters: TEAMS, status: 'in_season', avatar: null, previous_league_id: null,
  roster_positions: ['QB','RB','RB','WR','WR','WR','TE','FLEX','SUPER_FLEX','BN','BN','BN','BN','BN','BN','BN'],
  scoring_settings: { rec: 1, bonus_rec_te: 0.5 },
  settings: {
    playoff_teams: 6, playoff_week_start: 15, playoff_round_type: 1,
    league_average_match: 0, draft_rounds: 4, num_teams: TEAMS,
  },
  loser_bracket_id: 'lb1',
};

const rosterObjs = rosters.map((players, i) => ({
  roster_id: i + 1, owner_id: `u${i + 1}`, players,
  starters: players.slice(0, 9), reserve: [], taxi: [],
  settings: { wins: [8,7,7,6,6,6,5,5,4,4,3,3][i], losses: [2,3,3,4,4,4,5,5,6,6,7,7][i], ties: 0,
    fpts: 1300 - i * 28, fpts_decimal: 0 },
}));

const routes = (url) => {
  if (url.includes('/state/nfl')) return { week: 11, season: '2026', season_type: 'regular' };
  if (url.includes('/user/devin/leagues') || /\/user\/u\d+\/leagues/.test(url)) return [league];
  if (url.includes('/user/devin')) return { user_id: 'u1', username: 'devin', display_name: 'Devin' };
  if (url.endsWith('/league/L1')) return league;
  if (url.includes('/league/L1/rosters')) return rosterObjs;
  if (url.includes('/league/L1/users')) return users;
  if (url.includes('/league/L1/traded_picks')) return [
    { season: '2027', round: 1, roster_id: 9, previous_owner_id: 9, owner_id: 1 },
    { season: '2027', round: 1, roster_id: 12, previous_owner_id: 12, owner_id: 2 },
    { season: '2028', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 11 },
  ];
  if (url.includes('/winners_bracket')) return [];
  if (url.includes('/losers_bracket')) return [];
  if (url.includes('/matchups/')) {
    const week = Number(url.split('/matchups/')[1]);
    return rosterObjs.map((r, i) => ({ roster_id: r.roster_id, matchup_id: Math.floor(i / 2) + 1, points: 100 + ((week * 7 + i * 13) % 45) }));
  }
  return null;
};

const root = path.join(ROOT, 'dist');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((q, r) => {
  let f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  r.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise((r) => server.listen(8300, r));

const b = await chromium.launch({ args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1500, height: 1150 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await page.route('**://fonts.*/**', (r) => r.abort());
await page.route('**api.sleeper.app/**', (route) => {
  const url = route.request().url();
  const body = routes(url);
  if (body === null) return route.fulfill({ status: 404, body: 'null', contentType: 'application/json' });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

page.on('requestfailed', (r) => { if (r.url().includes('sleeper')) console.log('REQFAIL', r.url()); });
await page.goto('http://127.0.0.1:8300/', { waitUntil: 'load' });
await page.getByPlaceholder('your sleeper handle').fill('devin');
await page.getByRole('button', { name: /Find my leagues/i }).click();
await page.waitForTimeout(2000);

const card = page.getByText('The Proving Ground').first();
if (await card.count()) { await card.click(); await page.waitForTimeout(8000); }
else console.log('!! league card not found');
// Fail here rather than letting a later selector time out: when the app has
// blown up, the useful message is the page error, not "locator not found".
const alive = await page.locator('.panel').first().count();
if (errs.length || !alive) {
  console.error('FAILED — the app did not survive connecting a league.');
  for (const e of errs) console.error('  ' + e);
  if (!alive) console.error('  no panel rendered (blank page)');
  console.error(
    '\nA "Maximum update depth exceeded" here almost always means a store\n' +
      'selector returned a fresh object or closure. Memoise it in a hook, as\n' +
      'src/ui/usePosture.ts and src/ui/useTeamName.ts do.',
  );
  await b.close();
  server.close();
  process.exit(1);
}
console.log('crash errors: NONE');
const navBtns = (await page.locator('aside button').allInnerTexts()).map(t=>t.trim()).filter(Boolean);
console.log('NAV:', navBtns.join(' | '));
console.log('\nSLIDER:', (await page.locator('.panel').first().innerText()).replace(/\s+/g,' ').slice(0,340));
for (const [tab, file] of [['Players','pr-players'],['League','pr-league'],['Trade','pr-trade'],['Capital','pr-capital'],['Roster','pr-roster']]) {
  const btn = page.locator('aside button', { hasText: new RegExp('^'+tab, 'i') }).first();
  if (!(await btn.count())) { errs.push(`nav button missing: ${tab}`); continue; }
  await btn.click(); await page.waitForTimeout(2500);
  const txt = (await page.locator('main').innerText()).replace(/\s+/g,' ');
  console.log(`  ${tab}: ${txt.length} chars`);
  await page.screenshot({ path: path.join(OUT, `${file}.png`), fullPage: false });
}
// A row action pushed past its scroll container is invisible AND unclickable,
// which is how the trade builder shipped unusable: the Add button was there,
// just past the right edge of a half-width panel. Rendering is not enough to
// assert — the control has to be reachable.
await page.locator('aside button', { hasText: /^Trade/i }).first().click();
await page.waitForTimeout(2500);
const addButtons = page.locator('table tbody tr button', { hasText: /^(Add|In)$/ });
if ((await addButtons.count()) === 0) {
  errs.push('trade builder: no Add button rendered');
} else {
  const box = await addButtons.first().boundingBox();
  const edge = await page
    .locator('table')
    .first()
    .evaluate((t) => t.closest('.overflow-x-auto').getBoundingClientRect().right);
  if (!box || box.x + box.width > edge + 0.5) {
    errs.push(
      `trade builder: Add button is clipped (ends at ${box ? (box.x + box.width).toFixed(0) : '?'}px, ` +
        `panel edge ${edge.toFixed(0)}px) — trim a column or widen the panel`,
    );
  } else {
    await addButtons.first().click();
    await page.waitForTimeout(600);
    const card = (await page.locator('main ul li').first().innerText()).replace(/\s+/g, ' ');
    // The card uppercases its labels in CSS, so compare case-insensitively.
    const flat = card.toLowerCase();
    for (const attr of ['rating', 'redraft', 'var', 'redraft var']) {
      if (!flat.includes(attr)) {
        errs.push(`trade builder: selected player card is missing ${attr} (${card.slice(0, 120)})`);
      }
    }
    console.log('  selected player card:', card.slice(0, 160));
  }

  // Picks: the seasons offered, and that each carries a value.
  const picksTab = page.locator('button', { hasText: /^Picks \(/ }).first();
  if (await picksTab.count()) {
    await picksTab.click();
    await page.waitForTimeout(800);
    const rows = await page.locator('main ul li').allInnerTexts();
    const labels = rows.map((r) => r.replace(/\s+/g, ' ').trim()).filter((r) => /\d{4} \d(st|nd|rd|th) Rd/.test(r));
    const years = [...new Set(labels.map((l) => l.slice(0, 4)))].sort();
    console.log(`  pick rows: ${labels.length}, seasons: ${years.join(', ')}`);
    console.log('  first pick:', labels[0]?.slice(0, 90));
    if (years.includes('2026')) errs.push('picks: 2026 still listed after the rookie draft');
    for (const want of ['2027', '2028', '2029']) {
      if (!years.includes(want)) errs.push(`picks: ${want} missing from the tradeable seasons`);
    }
    if (labels[0] && !/\d+\.\d/.test(labels[0])) {
      errs.push(`picks: no value shown on a pick row (${labels[0].slice(0, 90)})`);
    }
  } else {
    errs.push('trade builder: no Picks tab');
  }
}

// Auto-evaluation. There is no Evaluate button any more, so the only proof
// the calculator still works is putting an asset on each side and watching the
// result appear by itself.
{
  await page.locator('aside button', { hasText: /^Trade/i }).first().click();
  await page.waitForTimeout(1500);
  const panels = page.locator('main section.panel');
  // The contention slider above them is a div, not a section, so the two side
  // builders are the first two panel sections in the view.
  const sideA = panels.nth(0);
  const sideB = panels.nth(1);
  // The earlier block left side A on its Picks tab, and this view has not
  // remounted since. Put both sides back on Players explicitly.
  for (const side of [sideA, sideB]) {
    const tab = side.locator('button', { hasText: /^Players \(/ }).first();
    if (await tab.count()) {
      await tab.click();
      await page.waitForTimeout(300);
    }
  }
  // The earlier block already put a player on side A; start from empty so the
  // one-sided assertion below means what it says.
  const clear = page.locator('main button', { hasText: /^Clear$/ }).first();
  if ((await clear.count()) && (await clear.isEnabled())) {
    await clear.click();
    await page.waitForTimeout(300);
  }
  const addA = sideA.locator('table tbody tr button', { hasText: /^(Add|In)$/ }).first();
  const addB = sideB.locator('table tbody tr button', { hasText: /^(Add|In)$/ }).first();
  if (!(await addA.count()) || !(await addB.count())) {
    const shapes = await panels.evaluateAll((els) =>
      els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 60)),
    );
    errs.push(
      `trade builder: could not find an Add button on both sides (panels: ${JSON.stringify(shapes)})`,
    );
  } else {
    await addA.click();
    await page.waitForTimeout(400);
    const body = await page.locator('main').innerText();
    if (/What each side gains/i.test(body)) {
      errs.push('trade evaluated with only one side filled');
    }
    await addB.click();
    // The season re-runs twice in a worker; give it room without a fixed sleep
    // being the thing under test.
    await page
      .locator('main', { hasText: 'What each side gains' })
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(2500);
    const after = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    for (const want of ['What each side gains', 'team strength', 'Championship probability']) {
      if (!after.includes(want)) {
        errs.push(`trade auto-evaluate: "${want}" never appeared`);
      }
    }

    // A second player on one side makes it a two for one, which is the shape
    // that frees a seat on the other. Both halves of the roster-spot model —
    // the option credited for the seat and the surplus reading on the player
    // who moves — only appear on an uneven deal, so the smoke has to build one.
    const addA2 = sideA
      .locator('table tbody tr button', { hasText: /^Add$/ })
      .first();
    if (await addA2.count()) {
      await addA2.click();
      await page.waitForTimeout(3500);
      const two = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
      const flat = two.toLowerCase();
      for (const want of ['roster spots', 'spot freed', 'market', 'if started', 'your use']) {
        if (!flat.includes(want)) {
          errs.push(`two-for-one: "${want}" never appeared`);
        }
      }
      const spots = two.match(/Roster spots.{0,300}/);
      console.log('  roster spots:', spots ? spots[0] : '(missing)');
      const assets = two.match(/Assets exchanged.{0,320}/);
      console.log('  assets:', assets ? assets[0] : '(missing)');
      await page.screenshot({ path: path.join(OUT, 'trade-two-for-one.png'), fullPage: true });
    } else {
      errs.push('two-for-one: no second Add button on side A');
    }
    const scale = after.match(/What each side gains.{0,320}/);
    console.log('  auto-evaluated:', scale ? scale[0] : '(missing)');
    await page.screenshot({ path: path.join(OUT, 'trade-scale.png'), fullPage: true });
  }
}

// The Rating column carries KeepTradeCut's name, so it has to carry their
// number. It was showing the contention blend, which moved players around the
// board by several places depending on a slider.
{
  await page.locator('aside button', { hasText: /^Players/i }).first().click();
  await page.waitForTimeout(1500);
  const rows = await page.locator('main table tbody tr').evaluateAll((trs) =>
    trs.slice(0, 12).map((tr) => {
      const c = [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim());
      return c.join(' | ');
    }),
  );
  console.log('  players board (top rows):');
  for (const r of rows.slice(0, 6)) console.log('    ' + r.slice(0, 110));
  // Descending by Rating: each row's rating must be <= the one above it.
  const nums = rows
    .map((r) => r.split('|').map((x) => x.trim()))
    .map((c) => parseFloat(c[3]))
    .filter((n) => !Number.isNaN(n));
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] > nums[i - 1] + 0.05) {
      errs.push(`players board is not sorted by rating: ${nums[i - 1]} then ${nums[i]}`);
      break;
    }
  }
  console.log(`    ratings descending across ${nums.length} rows: ${nums.join(' ')}`);
  const heads = (await page.locator('main table thead').first().innerText()).toLowerCase();
  if (heads.includes('blended')) {
    errs.push('players board still carries a Blended column');
  }
}

await page.locator('aside button', { hasText: /^League/i }).first().click();
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, 'league-full.png'), fullPage: true });

await b.close();
server.close();

if (errs.length) {
  console.error('\nFAILED — page errors:');
  for (const e of errs) console.error('  ' + e);
  process.exit(1);
}
console.log(`\nOK — every view rendered with no page errors. Screenshots in ${OUT}`);
