import { useStore } from '../../state/store';

const STOPS = [
  { at: 0, label: 'Full rebuild' },
  { at: 0.25, label: 'Rebuilding' },
  { at: 0.5, label: 'Balanced' },
  { at: 0.75, label: 'Contending' },
  { at: 1, label: 'All in' },
];

function describe(weight: number): { label: string; blurb: string } {
  if (weight <= 0.12)
    return {
      label: 'Full rebuild',
      blurb: 'Only long term value counts. Win now production is a trade asset, not a goal.',
    };
  if (weight < 0.4)
    return {
      label: 'Rebuilding',
      blurb: 'Long term leads. Sell ageing production while it still prices well.',
    };
  if (weight <= 0.6)
    return {
      label: 'Balanced',
      blurb: 'Both horizons weighted evenly. Cornerstones dominate the board.',
    };
  if (weight < 0.88)
    return {
      label: 'Contending',
      blurb: 'Win now leads. Draft capital is currency, not inventory.',
    };
  return {
    label: 'All in',
    blurb: 'Only this season counts. Championship equity is the entire scoreboard.',
  };
}

/**
 * The primary way a user expresses their situation, so it sits at the top of
 * every value screen rather than in a settings page. Moving it re-sorts every
 * table live.
 */
export function ContentionSlider({ compact = false }: { compact?: boolean }) {
  const weight = useStore((s) => s.settings.contentionWeight);
  const setContention = useStore((s) => s.setContention);
  const { label, blurb } = describe(weight);

  return (
    <div className="panel px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400">
            Contention timeline
          </h2>
          <span className="text-sm font-semibold text-ink-100">{label}</span>
        </div>
        <span className="num text-[0.75rem] text-ink-400">
          {Math.round(weight * 100)}% win now · {Math.round((1 - weight) * 100)}% long term
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={weight}
        aria-label="Contention timeline, from full rebuild to all in"
        onChange={(e) => setContention(Number(e.target.value))}
        className="timeline-slider mt-1"
      />

      <div className="flex justify-between px-0.5">
        {STOPS.map((stop) => (
          <button
            key={stop.at}
            onClick={() => setContention(stop.at)}
            className={`focus-ring -mt-1 rounded px-1 py-0.5 text-[0.6875rem] transition ${
              Math.abs(weight - stop.at) < 0.02
                ? 'text-ink-200'
                : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            {stop.label}
          </button>
        ))}
      </div>

      {compact ? null : (
        <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-400">{blurb}</p>
      )}
    </div>
  );
}
