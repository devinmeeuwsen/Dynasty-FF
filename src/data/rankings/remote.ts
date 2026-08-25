import type { RankingSource } from './types';

/**
 * Automated refresh — deliberately a stub.
 *
 * Pulling FantasyPros rankings on a schedule requires either their paid data
 * feed or a data partnership. Scraping the public ranking pages is against the
 * source site's terms, so this codebase does not do it, and the switch stays
 * off until a licensed feed is wired in behind this same interface. See
 * DECISIONS.md.
 */
export const remoteSource: RankingSource = {
  id: 'remote',
  label: 'Automated refresh',
  description:
    'Needs a licensed FantasyPros feed. Not implemented: scraping the public ranking ' +
    'pages would violate the source site terms.',
  available: false,
  load: async () => {
    throw new Error(
      'Automated ranking refresh is not enabled. Import a FantasyPros export instead.',
    );
  },
};
