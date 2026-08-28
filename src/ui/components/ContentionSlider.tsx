import { selectPosture, useStore } from '../../state/store';
import { POSTURE_COPY, classify } from '../../engine/posture';
import { percent } from '../format';

const STOPS = [
  { at: 0, label: 'Full rebuild' },
  { at: 0.3, label: 'Balanced' },
  { at: 0.6, label: 'Contending' },
  { at: 0.8, label: 'Dynasty' },
  { at: 1, label: 'All in' },
];

/**
 * Where a weight alone puts a team.
 *
 * Used only when the user has taken the slider over. With a simulation the
 * posture comes from two axes, and `dynasty` needs both — a weight on its own
 * cannot tell a young contender from an old one, so the manual reading of this
 * band is `contending` rather than a `dynasty` the numbers have not earned.
 */
function fromWeightAlone(weight: number): keyof typeof POSTURE_COPY {
  if (weight <= 0.12) return 'full_rebuild';
  if (weight < 0.36) return 'rebuilding';
  if (weight <= 0.6) return 'balanced';
  if (weight < 0.88) return 'contending';
  return 'all_in';
}

/**
 * The primary way a team's situation reaches every value screen, so it sits at
 * the top of them rather than in a settings page.
 *
 * It is derived, not asked. The simulation knows this team's championship
 * probability and the pipeline knows whether its assets expire, which is the
 * whole question the slider used to put back to the user. Dragging it still
 * works and then sticks, because a manager planning something the model cannot
 * see — a tank, a rebuild starting next week — should be able to say so.
 */
export function ContentionSlider({ compact = false }: { compact?: boolean }) {
  const weight = useStore((s) => s.settings.contentionWeight);
  const setContention = useStore((s) => s.setContention);
  const clearOverride = useStore((s) => s.clearContentionOverride);
  const override = useStore((s) => s.contentionOverride);
  const posture = useStore(selectPosture);

  const derived = posture != null && override == null;
  const copy = derived ? POSTURE_COPY[posture.posture] : POSTURE_COPY[fromWeightAlone(weight)];

  return (
    <div className="panel px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400">
            Contention timeline
          </h2>
          <span className="text-sm font-semibold text-ink-100">{copy.label}</span>
          {derived ? (
            <span className="num rounded-full bg-blend-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-blend-400">
              from your odds
            </span>
          ) : posture != null ? (
            <button
              onClick={clearOverride}
              className="focus-ring rounded-full border border-white/15 px-2 py-0.5 text-[0.625rem] text-ink-400 transition hover:text-ink-200"
            >
              manual · reset to {POSTURE_COPY[classify(posture.contention, posture.futureStrength)].label}
            </button>
          ) : null}
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
        <>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-400">{copy.blurb}</p>
          {posture ? (
            <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] pt-2 text-[0.6875rem] text-ink-500">
              <span>
                Championship odds{' '}
                <span className="text-ink-300">{percent(posture.championshipOdds, 1)}</span>
              </span>
              <span>
                Contention{' '}
                <span className="text-ink-300">{percent(posture.contention, 0)}</span> of league
              </span>
              <span>
                Future assets{' '}
                <span className="text-ink-300">{percent(posture.futureStrength, 0)}</span> of league
              </span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
