import type { RankingSource } from './types';

/**
 * Live in-browser refresh — deliberately a stub.
 *
 * Ranking refresh IS automated, just not from the browser: CI runs
 * `npm run rankings:build` before every deploy, so each release carries a
 * current KeepTradeCut board. What cannot happen at runtime is a fetch from the
 * visitor's browser — KeepTradeCut serves those boards as 1.3MB of HTML with no
 * `access-control-allow-origin` header, so the request is blocked by CORS
 * before it starts and would be an expensive way to get the same numbers.
 *
 * That leaves this switch off by design rather than by omission. A user who
 * wants a board newer than the last deploy, or their own, imports one. See
 * DECISIONS.md.
 */
export const remoteSource: RankingSource = {
  id: 'remote',
  label: 'Live refresh in the browser',
  description:
    'Not available: KeepTradeCut serves its boards as HTML with no CORS header, so a ' +
    'browser cannot read them. Rankings refresh at build time instead — every deploy ' +
    'ships a current board — and you can import your own list below at any time.',
  available: false,
  load: async () => {
    throw new Error(
      'In-browser ranking refresh is not available. Rankings refresh on each deploy; ' +
        'import a ranking list to override them.',
    );
  },
};
