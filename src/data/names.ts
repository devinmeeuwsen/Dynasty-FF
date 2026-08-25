import type { Position } from '../engine/types';

/**
 * Name matching between Sleeper player identifiers and ranking list names.
 *
 * These will not match cleanly. Suffixes, punctuation, nicknames and the
 * occasional outright different spelling all appear. Unmatched players are
 * surfaced in the interface rather than silently dropped, and manual overrides
 * persist.
 */

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

const ALIASES: Record<string, string> = {
  // Common short forms and alternate spellings that appear in exported lists.
  mitchtrubisky: 'mitchelltrubisky',
  joshuapalmer: 'joshpalmer',
  gabedavis: 'gabrieldavis',
  cadeotton: 'cadeotton',
  chigoziemvele: 'chigoziemvele',
  kennethwalkeriii: 'kennethwalker',
  marvinmimsjr: 'marvinmims',
  michaelpittmanjr: 'michaelpittman',
  travisetiennejr: 'travisetienne',
  brianrobinsonjr: 'brianrobinson',
  odellbeckhamjr: 'odellbeckham',
  jeffwilsonjr: 'jeffwilson',
  markstjulien: 'markstjulien',
  amonrastbrown: 'amonrastbrown',
  dkmetcalf: 'dkmetcalf',
  aj: 'aj',
  cj: 'cj',
  tj: 'tj',
  dj: 'dj',
  jk: 'jk',
};

/**
 * Reduce a display name to a stable key: lowercase, strip punctuation and
 * whitespace, drop generational suffixes.
 */
export function normalizeName(raw: string): string {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  const parts = cleaned.split(' ').filter(Boolean);
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();

  const key = parts.join('');
  return ALIASES[key] ?? key;
}

export interface MatchCandidate {
  id: string;
  name: string;
  position: Position;
  team: string | null;
}

export interface MatchResult {
  /** Ranking entry name → resolved player id. */
  matched: Map<string, string>;
  /** Ranking names with no confident match, surfaced in the interface. */
  unmatched: { name: string; position: Position; team: string | null }[];
  /** Matches that needed a fallback rule, worth showing for review. */
  fuzzy: { name: string; matchedTo: string; rule: string }[];
}

interface IndexedCandidate extends MatchCandidate {
  key: string;
  lastFirstInitial: string;
}

function buildIndex(candidates: MatchCandidate[]) {
  const byKey = new Map<string, IndexedCandidate[]>();
  const byLastInitial = new Map<string, IndexedCandidate[]>();

  for (const c of candidates) {
    const key = normalizeName(c.name);
    const parts = c.name.trim().split(/\s+/);
    const last = normalizeName(parts.slice(1).join(' ') || parts[0]);
    const initial = normalizeName(parts[0]).slice(0, 1);
    const indexed: IndexedCandidate = { ...c, key, lastFirstInitial: `${last}|${initial}` };

    const list = byKey.get(key) ?? [];
    list.push(indexed);
    byKey.set(key, list);

    const list2 = byLastInitial.get(indexed.lastFirstInitial) ?? [];
    list2.push(indexed);
    byLastInitial.set(indexed.lastFirstInitial, list2);
  }
  return { byKey, byLastInitial };
}

/**
 * Match ranking entries to players. Position must always agree — a name
 * collision across positions is a different human, and a wrong cross-position
 * match would corrupt the value curves silently.
 */
export function matchRankings(
  entries: { name: string; position: Position; team: string | null; sleeperId?: string }[],
  candidates: MatchCandidate[],
  overrides: ReadonlyMap<string, string> = new Map(),
): MatchResult {
  const { byKey, byLastInitial } = buildIndex(candidates);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const matched = new Map<string, string>();
  const unmatched: MatchResult['unmatched'] = [];
  const fuzzy: MatchResult['fuzzy'] = [];

  for (const entry of entries) {
    const key = normalizeName(entry.name);

    const override = overrides.get(key);
    if (override && byId.has(override)) {
      matched.set(key, override);
      continue;
    }

    // A list that already carries Sleeper ids needs no matching at all.
    if (entry.sleeperId && byId.has(entry.sleeperId)) {
      matched.set(key, entry.sleeperId);
      continue;
    }

    const exact = (byKey.get(key) ?? []).filter((c) => c.position === entry.position);
    if (exact.length === 1) {
      matched.set(key, exact[0].id);
      continue;
    }
    if (exact.length > 1) {
      // Disambiguate a genuine duplicate by NFL team.
      const byTeam = entry.team
        ? exact.filter((c) => c.team === entry.team)
        : [];
      if (byTeam.length === 1) {
        matched.set(key, byTeam[0].id);
        fuzzy.push({ name: entry.name, matchedTo: byTeam[0].name, rule: 'duplicate name resolved by team' });
        continue;
      }
      matched.set(key, exact[0].id);
      fuzzy.push({ name: entry.name, matchedTo: exact[0].name, rule: 'ambiguous duplicate, took first' });
      continue;
    }

    // Fall back to last name plus first initial, which catches nicknames.
    const parts = entry.name.trim().split(/\s+/);
    const last = normalizeName(parts.slice(1).join(' ') || parts[0]);
    const initial = normalizeName(parts[0]).slice(0, 1);
    const near = (byLastInitial.get(`${last}|${initial}`) ?? []).filter(
      (c) => c.position === entry.position && (!entry.team || !c.team || c.team === entry.team),
    );
    if (near.length === 1) {
      matched.set(key, near[0].id);
      fuzzy.push({ name: entry.name, matchedTo: near[0].name, rule: 'last name and first initial' });
      continue;
    }

    unmatched.push({ name: entry.name, position: entry.position, team: entry.team });
  }

  return { matched, unmatched, fuzzy };
}
