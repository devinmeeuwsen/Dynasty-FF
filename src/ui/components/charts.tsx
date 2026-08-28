import { useMemo, useState } from 'react';
import type { Position, ValuedPlayer } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import type { PositionalCurves } from '../../engine/curves';
import type { ReplacementComparison } from '../../engine/replacement';
import { POSITION_COLOR, percent, value } from '../format';

/**
 * Charts are hand-rolled SVG. A charting library would add a hundred kilobytes
 * and its own visual language; four bespoke charts that share the app's
 * palette and typography are smaller and read as one product.
 */

const QUADRANTS = [
  { x: 0.5, y: 0.5, label: 'Cornerstones', hint: 'high on both' },
  { x: 0.5, y: 0, label: 'Win now assets', hint: 'sell to rebuilders' },
  { x: 0, y: 0.5, label: 'Rebuilding assets', hint: 'buy from contenders' },
  { x: 0, y: 0, label: 'Cuts', hint: 'low on both' },
];

export function ValueScatter({
  players,
  highlight,
  onSelect,
}: {
  players: ValuedPlayer[];
  highlight?: Set<string>;
  onSelect?: (player: ValuedPlayer) => void;
}) {
  const [hovered, setHovered] = useState<ValuedPlayer | null>(null);

  // Plotted on ratings, not value over replacement, and on fixed 0-100 axes.
  // Against replacement every waiver player collapses onto the origin and the
  // quadrants stop separating anything; fixed axes also keep a player in the
  // same spot as filters change.
  const { points, maxX, maxY } = useMemo(
    () => ({ points: players, maxX: 100, maxY: 100 }),
    [players],
  );

  const W = 100;
  const H = 100;

  return (
    <div className="relative">
      <svg
        viewBox={`-14 -8 ${W + 22} ${H + 20}`}
        className="w-full"
        role="img"
        aria-label="Win now value against long term value"
      >
        {/* Quadrant grounds, split at the midpoint of each axis. */}
        {QUADRANTS.map((q) => (
          <rect
            key={q.label}
            x={q.x * W * 0.5 * 2 * 0.5}
            y={(1 - q.y - 0.5) * H}
            width={W / 2}
            height={H / 2}
            fill={
              q.label === 'Cornerstones'
                ? 'rgba(139,124,255,0.05)'
                : q.label === 'Cuts'
                  ? 'rgba(255,255,255,0.012)'
                  : 'rgba(255,255,255,0.025)'
            }
          />
        ))}
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="rgba(255,255,255,0.08)" strokeWidth={0.3} />
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.08)" strokeWidth={0.3} />

        {QUADRANTS.map((q) => (
          <text
            key={`${q.label}-label`}
            x={q.x * W + (q.x === 0 ? 2 : W / 2 - 2)}
            y={(1 - q.y) * H - (q.y === 0 ? H / 2 - 4 : H / 2 - 4)}
            textAnchor={q.x === 0 ? 'start' : 'end'}
            className="fill-ink-500"
            style={{ fontSize: 3.2, fontWeight: 600, letterSpacing: '0.04em' }}
          >
            {q.label.toUpperCase()}
          </text>
        ))}

        {/* Axes */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(255,255,255,0.14)" strokeWidth={0.4} />
        <line x1={0} y1={0} x2={0} y2={H} stroke="rgba(255,255,255,0.14)" strokeWidth={0.4} />
        <text x={W / 2} y={H + 10} textAnchor="middle" className="fill-later-400" style={{ fontSize: 3.6, fontWeight: 600 }}>
          LONG TERM VALUE →
        </text>
        <text
          x={-9}
          y={H / 2}
          textAnchor="middle"
          transform={`rotate(-90 -9 ${H / 2})`}
          className="fill-now-400"
          style={{ fontSize: 3.6, fontWeight: 600 }}
        >
          WIN NOW VALUE →
        </text>

        {points.map((p) => {
          const cx = (p.longTermRating / maxX) * W;
          const cy = H - (p.winNowRating / maxY) * H;
          const isHighlighted = highlight?.has(p.id);
          const r = isHighlighted ? 1.9 : 1.15;
          return (
            <circle
              key={p.id}
              cx={cx}
              cy={cy}
              r={r}
              fill={POSITION_COLOR[p.position]}
              fillOpacity={isHighlighted ? 1 : 0.55}
              stroke={isHighlighted ? '#fff' : 'none'}
              strokeWidth={0.35}
              onMouseEnter={() => setHovered(p)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect?.(p)}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            />
          );
        })}
      </svg>

      {hovered ? (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-lg border border-white/10 bg-ink-950/95 px-3 py-2 text-center shadow-xl backdrop-blur">
          <div className="text-[0.8125rem] font-semibold text-ink-100">{hovered.name}</div>
          <div className="num mt-0.5 text-[0.75rem] text-ink-400">
            <span className="text-now-400">{value(hovered.winNowRating)} now</span>
            {' · '}
            <span className="text-later-400">{value(hovered.longTermRating)} later</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Positional value curves with both replacement levels marked. Divergence
 * between observed and simulated is the point of the chart: it says whether
 * this league rosters deeper or shallower than its settings imply.
 */
export function PositionalCurveChart({
  curves,
  comparison,
  position,
}: {
  curves: PositionalCurves;
  comparison?: ReplacementComparison[];
  position: Position;
}) {
  const list = curves.byPosition[position] ?? [];
  const shown = list.slice(0, Math.min(list.length, 90));
  const maxValue = Math.max(1, ...shown.map((e) => e.value));
  const W = 100;
  const H = 46;

  const row = comparison?.find((c) => c.position === position);
  const indexOfValue = (target: number) => {
    const index = list.findIndex((entry) => entry.value <= target + 1e-9);
    return index < 0 ? shown.length - 1 : Math.min(index, shown.length - 1);
  };

  const path = shown
    .map((entry, i) => {
      const x = (i / Math.max(1, shown.length - 1)) * W;
      const y = H - (entry.value / maxValue) * H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`-2 -4 ${W + 8} ${H + 14}`} className="w-full" role="img" aria-label={`${position} value curve`}>
      <defs>
        <linearGradient id={`fill-${position}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={POSITION_COLOR[position]} stopOpacity={0.32} />
          <stop offset="100%" stopColor={POSITION_COLOR[position]} stopOpacity={0} />
        </linearGradient>
      </defs>

      <path d={`${path} L${W},${H} L0,${H} Z`} fill={`url(#fill-${position})`} />
      <path d={path} fill="none" stroke={POSITION_COLOR[position]} strokeWidth={0.8} />

      {row ? (
        <>
          <ReplacementMarker
            x={(indexOfValue(row.simulated) / Math.max(1, shown.length - 1)) * W}
            height={H}
            color="rgba(255,255,255,0.3)"
            dash="1.5 1.5"
            label="simulated"
            labelAnchor="end"
          />
          <ReplacementMarker
            x={(indexOfValue(row.observed) / Math.max(1, shown.length - 1)) * W}
            height={H}
            color="var(--color-blend-400)"
            label="observed"
            labelAnchor="start"
          />
        </>
      ) : null}

      <text x={0} y={H + 8} className="fill-ink-500" style={{ fontSize: 3.2 }}>
        {position}1
      </text>
      <text x={W} y={H + 8} textAnchor="end" className="fill-ink-500" style={{ fontSize: 3.2 }}>
        {position}
        {shown.length}
      </text>
    </svg>
  );
}

function ReplacementMarker({
  x,
  height,
  color,
  dash,
  label,
  labelAnchor,
}: {
  x: number;
  height: number;
  color: string;
  dash?: string;
  label: string;
  labelAnchor: 'start' | 'end';
}) {
  return (
    <g>
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={height}
        stroke={color}
        strokeWidth={0.5}
        strokeDasharray={dash}
      />
      <text
        x={labelAnchor === 'start' ? x + 1 : x - 1}
        y={3}
        textAnchor={labelAnchor}
        fill={color}
        style={{ fontSize: 2.8, fontWeight: 600 }}
      >
        {label}
      </text>
    </g>
  );
}

/** A team's draft slot distribution, drawn as a small column chart. */
export function SlotDistribution({
  distribution,
  round,
  teams,
}: {
  distribution: number[];
  round: number;
  teams: number;
}) {
  const max = Math.max(...distribution, 0.0001);
  return (
    <div className="flex h-8 items-end gap-px" role="img" aria-label="Draft slot probability">
      {distribution.map((p, i) => (
        <div
          key={i}
          title={`Pick ${round}.${String(i + 1).padStart(2, '0')} · ${percent(p)}`}
          className="min-w-[2px] flex-1 rounded-t-[1px] bg-blend-500/70 transition-all hover:bg-blend-400"
          style={{ height: `${Math.max(4, (p / max) * 100)}%` }}
        />
      ))}
      <span className="sr-only">{teams} possible slots</span>
    </div>
  );
}

/** Compact league-wide bar chart of any per-team number. */
export function TeamBars({
  entries,
  format,
  color = 'var(--color-blend-500)',
  highlight,
}: {
  entries: { rosterId: number; name: string; value: number }[];
  format: (n: number) => string;
  color?: string;
  highlight?: number | null;
}) {
  const max = Math.max(...entries.map((e) => Math.abs(e.value)), 1e-9);
  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li key={entry.rosterId} className="flex items-center gap-3">
          <span
            className={`w-28 shrink-0 truncate text-[0.75rem] sm:w-36 ${
              highlight === entry.rosterId ? 'font-semibold text-blend-400' : 'text-ink-300'
            }`}
          >
            {entry.name}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(Math.abs(entry.value) / max) * 100}%`, background: color }}
            />
          </div>
          <span className="num w-16 shrink-0 text-right text-[0.75rem] text-ink-300">
            {format(entry.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PositionTabs({
  value: current,
  onChange,
}: {
  value: Position;
  onChange: (position: Position) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-ink-950/50 p-0.5">
      {POSITIONS.map((position) => (
        <button
          key={position}
          onClick={() => onChange(position)}
          className={`focus-ring num h-7 rounded-[0.4375rem] px-2.5 text-[0.75rem] font-semibold transition ${
            current === position ? 'text-ink-100' : 'text-ink-400 hover:text-ink-200'
          }`}
          style={
            current === position
              ? { background: `color-mix(in oklab, ${POSITION_COLOR[position]} 22%, transparent)` }
              : undefined
          }
        >
          {position}
        </button>
      ))}
    </div>
  );
}
