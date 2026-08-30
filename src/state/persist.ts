import type { EngineSettings } from '../engine/types';
import { DEFAULT_SETTINGS } from '../engine/types';

/**
 * Configuration is shareable through the query string and sticky through
 * localStorage. The URL wins on load, so a link someone sends you opens their
 * configuration rather than yours.
 */

export interface Persisted {
  username: string;
  /**
   * Sleeper's id for the signed-in user, which is what resolves WHICH roster
   * is theirs.
   *
   * Persisting the username alone was not enough. On reload the store restored
   * the name and went straight to `selectLeague`, which resolves the user's
   * roster from the `user` OBJECT — still null, because nothing had looked the
   * name up yet. So `userRosterId` came back null and every view fell through
   * to `rosters[0]`: the roster page opened on somebody else's team, the
   * contention timeline read somebody else's odds, and draft capital showed
   * somebody else's picks. It only looked right in the session where the
   * league was first connected.
   */
  userId: string | null;
  leagueId: string | null;
  settings: EngineSettings;
  nameOverrides: Record<string, string>;
  /**
   * Null means the contention timeline follows the simulation. A number means
   * the user took it over, and that choice outlives a reload — otherwise a
   * manager who deliberately set a tank would silently be put back on the
   * model's reading of their roster every time they opened the page.
   */
  contentionOverride?: number | null;
}

const KEY = 'dynasty-ff:state';

/** Short keys keep the shared link readable. */
const URL_KEYS: Record<string, keyof EngineSettings> = {
  lam: 'lambda',
  crv: 'curve',
  con: 'contentionWeight',
  sim: 'simSeasons',
  sig: 'weeklySigma',
  rps: 'replacementPointsPerStarter',
  lmp: 'leagueMeanPoints',
  sd: 'seed',
  pbr: 'pickBaseRank',
  pex: 'pickExponent',
  fdy: 'futureDiscountPerYear',
  fuy: 'futureUncertaintyPerYear',
  dor: 'draftOrderRule',
  dzt: 'deadZoneThreshold',
};

const NUMERIC = new Set<keyof EngineSettings>([
  'lambda',
  'contentionWeight',
  'simSeasons',
  'weeklySigma',
  'replacementPointsPerStarter',
  'leagueMeanPoints',
  'seed',
  'pickBaseRank',
  'pickExponent',
  'futureDiscountPerYear',
  'futureUncertaintyPerYear',
  'deadZoneThreshold',
]);

export function shareUrl(state: Persisted): string {
  const params = new URLSearchParams();
  if (state.leagueId) params.set('lg', state.leagueId);
  if (state.username) params.set('u', state.username);

  for (const [short, key] of Object.entries(URL_KEYS)) {
    const value = state.settings[key];
    if (value === DEFAULT_SETTINGS[key]) continue;
    params.set(short, String(value));
  }
  const payout = state.settings.payoutWeights;
  if (payout.length !== 1 || payout[0] !== 1) params.set('pay', payout.join('.'));

  const url = new URL(window.location.href);
  url.search = params.toString();
  url.hash = '';
  return url.toString();
}

function fromUrl(): Partial<Persisted> | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if ([...params.keys()].length === 0) return null;

  const settings: Partial<EngineSettings> = {};
  for (const [short, key] of Object.entries(URL_KEYS)) {
    const raw = params.get(short);
    if (raw == null) continue;
    if (NUMERIC.has(key)) {
      const value = Number(raw);
      if (Number.isFinite(value)) (settings as Record<string, unknown>)[key] = value;
    } else {
      (settings as Record<string, unknown>)[key] = raw;
    }
  }
  const payout = params.get('pay');
  if (payout) {
    const weights = payout.split('.').map(Number).filter(Number.isFinite);
    if (weights.length > 0) settings.payoutWeights = weights;
  }

  return {
    username: params.get('u') ?? '',
    leagueId: params.get('lg'),
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

export function loadPersisted(): Partial<Persisted> | null {
  const url = fromUrl();
  let stored: Partial<Persisted> | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Partial<Persisted>;
  } catch {
    stored = null;
  }
  if (!url && !stored) return null;
  return {
    username: url?.username || stored?.username || '',
    leagueId: url?.leagueId ?? stored?.leagueId ?? null,
    settings: { ...DEFAULT_SETTINGS, ...stored?.settings, ...url?.settings },
    nameOverrides: stored?.nameOverrides ?? {},
  };
}

export function persist(state: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode or quota */
  }
}
