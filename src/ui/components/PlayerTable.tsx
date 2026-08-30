import { useMemo, useState } from 'react';
import type { Position, ValuedPlayer } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { blendedRating } from '../../engine/values';
import { Bar, PositionChip, TextInput, Toggle } from './primitives';
import { TIMELINE_LABEL, deltaClass, signed, timelineClass, timelineOf, value } from '../format';

export type SortKey =
  | 'rating'
  | 'blended'
  | 'var'
  | 'winNow'
  | 'longTerm'
  | 'longTerm'
  | 'name'
  | 'position'
  | 'age';

export type OwnershipFilter = 'all' | 'rostered' | 'free' | 'mine';

interface Props {
  players: ValuedPlayer[];
  weight: number;
  teamName: (rosterId: number) => string;
  userRosterId?: number | null;
  /** Rendered at the end of each row, e.g. an add-to-trade button. */
  rowAction?: (player: ValuedPlayer) => React.ReactNode;
  initialOwnership?: OwnershipFilter;
  showOwner?: boolean;
  pageSize?: number;
  /**
   * Which metric columns to show. Narrow contexts trim this: the trade builder
   * lives in a half-width panel, and carrying all five pushed the row's Add
   * button off the edge — the one control the screen exists for.
   */
  metrics?: SortKey[];
}

const COLUMNS: { key: SortKey; label: string; hint?: string; className: string }[] = [
  {
    key: 'rating',
    label: 'Rating',
    hint: "KeepTradeCut's dynasty value on a 0-100 scale. The dynasty market already prices a player's whole future, this season included, so this is the number.",
    className: 'text-blend-400',
  },
  {
    key: 'winNow',
    label: 'Redraft',
    hint: 'FantasyPros expert consensus order, priced on the same 0-100 ladder as the rating. What he is worth for this season alone.',
    className: 'text-now-400',
  },
  {
    key: 'longTerm',
    label: 'Long term',
    hint: 'Rating minus redraft. Positive means he is a better asset than a starter; negative means the market pays him more for this season than for his career. Within three points either way he is balanced — good now and later.',
    className: 'text-later-400',
  },
  {
    key: 'var',
    label: 'VAR',
    hint: 'Value above replacement: rating minus the best player at this position nobody has rostered. Negative means the waiver wire already offers better.',
    className: 'text-ink-200',
  },
  {
    key: 'blended',
    label: 'Blended',
    hint: 'Rating and redraft mixed by the contention timeline. The only column the slider moves — everything else states a source value unchanged.',
    className: 'text-ink-300',
  },
];

export function PlayerTable({
  players,
  weight,
  teamName,
  userRosterId,
  rowAction,
  initialOwnership = 'all',
  showOwner = true,
  pageSize = 60,
  metrics,
}: Props) {
  const shown = metrics
    ? COLUMNS.filter((c) => metrics.includes(c.key))
    : COLUMNS;

  // Grow the scroll floor with the columns actually rendered rather than
  // pinning it at the widest case, so a trimmed table stops overflowing
  // instead of merely scrolling further.
  const minWidth = `${(showOwner ? 15 : 10) + shown.length * 4.6 + (rowAction ? 4 : 0)}rem`;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: metrics && !metrics.includes('rating') ? metrics[0] : 'rating',
    desc: true,
  });
  const [query, setQuery] = useState('');
  const [positions, setPositions] = useState<Set<Position>>(new Set(POSITIONS));
  const [ownership, setOwnership] = useState<OwnershipFilter>(initialOwnership);
  const [limit, setLimit] = useState(pageSize);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = players.filter((p) => {
      if (!positions.has(p.position)) return false;
      if (ownership === 'rostered' && p.ownerRosterId == null) return false;
      if (ownership === 'free' && p.ownerRosterId != null) return false;
      if (ownership === 'mine' && p.ownerRosterId !== userRosterId) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.team ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    // Rating is KeepTradeCut's number and nothing else. It used to be
    // `blendedRating(p, weight)`, which meant the contention slider silently
    // rewrote a column labelled with someone else's data and reordered the
    // whole board: at a weight of 0.55 it lifted CeeDee Lamb from 74.6 to 80.2
    // and moved him from 14th to 7th. A column carrying a source's name has to
    // carry that source's value. The blend is still available, as its own
    // column that says what it is.
    const keyed = filtered.map((p) => ({
      player: p,
      rating: p.rating,
      vor: p.ratingVar,
      blended: blendedRating(p, weight),
    }));
    keyed.sort((a, b) => {
      const direction = sort.desc ? -1 : 1;
      switch (sort.key) {
        case 'name':
          return direction * a.player.name.localeCompare(b.player.name);
        case 'position':
          return (
            direction * a.player.position.localeCompare(b.player.position) ||
            b.rating - a.rating
          );
        case 'age':
          return direction * ((a.player.age ?? 99) - (b.player.age ?? 99));
        case 'var':
          return direction * (a.vor - b.vor);
        case 'winNow':
          return direction * (a.player.redraft - b.player.redraft);
        case 'longTerm':
          return direction * (a.player.longTerm - b.player.longTerm);
        case 'blended':
          return direction * (a.blended - b.blended);
        case 'rating':
        default:
          return direction * (a.rating - b.rating);
      }
    });
    return keyed;
  }, [players, positions, ownership, query, sort, weight, userRosterId]);

  const visible = rows.slice(0, limit);

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: key !== 'name' },
    );

  const togglePosition = (position: Position) =>
    setPositions((current) => {
      const next = new Set(current);
      if (next.has(position) && next.size > 1) next.delete(position);
      else next.add(position);
      return next;
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3 sm:px-5">
        <div className="min-w-[9rem] flex-1">
          <TextInput value={query} onChange={setQuery} placeholder="Search player or team" />
        </div>
        <div className="flex gap-1">
          {POSITIONS.map((position) => (
            <button
              key={position}
              onClick={() => togglePosition(position)}
              aria-pressed={positions.has(position)}
              className={`focus-ring num h-8 rounded-lg border px-2.5 text-[0.75rem] font-semibold transition ${
                positions.has(position)
                  ? 'border-white/15 bg-white/[0.08] text-ink-100'
                  : 'border-white/[0.06] text-ink-500 hover:text-ink-300'
              }`}
            >
              {position}
            </button>
          ))}
        </div>
        <Toggle
          size="sm"
          value={ownership}
          onChange={(v) => setOwnership(v as OwnershipFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'rostered', label: 'Rostered' },
            { value: 'free', label: 'Free agents' },
            ...(userRosterId != null ? [{ value: 'mine', label: 'Mine' }] : []),
          ]}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[0.8125rem]" style={{ minWidth }}>
          <thead className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-400">
            <tr className="border-b border-white/[0.06]">
              <th className="w-10 py-2 pl-4 font-medium sm:pl-5">#</th>
              <SortableHeader
                label="Player"
                active={sort.key === 'name'}
                desc={sort.desc}
                onClick={() => toggleSort('name')}
                className="min-w-[10rem]"
              />
              {showOwner ? <th className="px-2 py-2 font-medium">Owner</th> : null}
              {shown.map((column) => (
                <SortableHeader
                  key={column.key}
                  label={column.label}
                  hint={column.hint}
                  active={sort.key === column.key}
                  desc={sort.desc}
                  onClick={() => toggleSort(column.key)}
                  align="right"
                  className={column.className}
                />
              ))}
              {rowAction ? <th className="py-2 pr-4 sm:pr-5" /> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const p = row.player;
              const mine = userRosterId != null && p.ownerRosterId === userRosterId;
              return (
                <tr
                  key={p.id}
                  className={`border-b border-white/[0.035] transition-colors hover:bg-white/[0.03] ${
                    mine ? 'bg-blend-500/[0.04]' : ''
                  }`}
                >
                  <td className="num py-2 pl-4 text-[0.75rem] text-ink-500 sm:pl-5">
                    {index + 1}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2">
                      <PositionChip position={p.position} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink-100">{p.name}</div>
                        <div className="num text-[0.6875rem] text-ink-500">
                          {p.team ?? 'FA'}
                          {p.age != null ? ` · ${p.age}yo` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  {showOwner ? (
                    <td className="px-2 py-2 text-[0.75rem] text-ink-400">
                      {p.ownerRosterId == null ? (
                        <span className="text-ink-500">Waivers</span>
                      ) : (
                        <span className={mine ? 'text-blend-400' : ''}>
                          {teamName(p.ownerRosterId)}
                        </span>
                      )}
                    </td>
                  ) : null}
                  {/* Driven off the same list as the headers, so a trimmed
                      table can never shift its values into the wrong column. */}
                  {shown.map((column) => {
                    switch (column.key) {
                      case 'rating':
                        return (
                          <td key={column.key} className="py-2 pr-3 text-right">
                            <div className="num font-semibold text-blend-400">
                              {value(row.rating)}
                            </div>
                            {/* Scaled against the full 0-100 range, not against
                                whoever tops the current filter, so the bar means
                                the same thing on every screen. */}
                            <Bar
                              fraction={row.rating / 100}
                              color="var(--color-blend-500)"
                              className="mt-1 ml-auto w-14"
                            />
                          </td>
                        );
                      case 'winNow':
                        return (
                          <td key={column.key} className="num py-2 pr-3 text-right text-now-400">
                            {value(p.redraft)}
                          </td>
                        );
                      case 'longTerm':
                        return (
                          <td
                            key={column.key}
                            className={`num py-2 pr-3 text-right ${timelineClass(p.longTerm)}`}
                            title={TIMELINE_LABEL[timelineOf(p.longTerm)]}
                          >
                            {signed(p.longTerm)}
                          </td>
                        );
                      case 'var':
                        return (
                          <td
                            key={column.key}
                            className={`num py-2 pr-3 text-right ${deltaClass(row.vor, 0.05)}`}
                          >
                            {signed(row.vor)}
                          </td>
                        );
                      case 'blended':
                        return (
                          <td key={column.key} className="num py-2 pr-3 text-right text-ink-300">
                            {value(row.blended)}
                          </td>
                        );
                      default:
                        return null;
                    }
                  })}
                  {rowAction ? (
                    <td className="py-2 pr-4 text-right sm:pr-5">{rowAction(p)}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3 text-[0.75rem] text-ink-400 sm:px-5">
        <span className="num">
          {Math.min(limit, rows.length)} of {rows.length}
        </span>
        {limit < rows.length ? (
          <button
            onClick={() => setLimit((l) => l + pageSize * 2)}
            className="focus-ring rounded-lg border border-white/10 px-3 py-1.5 text-ink-200 transition hover:bg-white/[0.06]"
          >
            Show more
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  hint,
  active,
  desc,
  onClick,
  align = 'left',
  className = '',
}: {
  label: string;
  hint?: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th className={`py-2 ${align === 'right' ? 'pr-3 text-right' : 'px-2'} font-medium ${className}`}>
      <button
        onClick={onClick}
        title={hint}
        className={`focus-ring inline-flex items-center gap-1 rounded transition ${
          active ? 'text-ink-100' : 'hover:text-ink-200'
        }`}
      >
        {label}
        <span className={`text-[0.5rem] ${active ? 'opacity-100' : 'opacity-0'}`}>
          {desc ? '▼' : '▲'}
        </span>
      </button>
    </th>
  );
}
