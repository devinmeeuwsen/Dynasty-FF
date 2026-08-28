import { useMemo, useState } from 'react';
import type { FinishMatrix as Matrix } from '../../engine/types';
import { divergingColor, heatColor, percent, signedPercentPoints } from '../format';

/**
 * The signature screen: rows are teams, columns are finish positions, cells are
 * shaded by probability.
 *
 * Row and column totals are always visible, because the doubly stochastic
 * property is the correctness invariant of the whole model and the user should
 * be able to see it holding. Every row sums to one hundred percent because each
 * team finishes somewhere; every column sums to one hundred percent because
 * each position is occupied by exactly one team. Nothing here normalises
 * anything — these numbers come straight out of the simulation counts.
 */
export function FinishMatrixHeatmap({
  matrix,
  teamName,
  highlightRosterId,
  mode = 'absolute',
  caption,
}: {
  matrix: Matrix;
  teamName: (rosterId: number) => string;
  highlightRosterId?: number | null;
  mode?: 'absolute' | 'delta';
  caption?: string;
}) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  const { order, columnSums, check, scale } = useMemo(() => {
    const expected = matrix.rows.map((row, i) => ({
      index: i,
      rosterId: matrix.rosterIds[i],
      value: row.reduce((acc, p, j) => acc + p * (j + 1), 0),
    }));
    // Absolute matrices read best sorted by projected finish; a delta matrix
    // must keep team order stable so it can be compared against the baseline.
    if (mode === 'absolute') expected.sort((a, b) => a.value - b.value);

    const sums = new Array(matrix.rosterIds.length).fill(0);
    let max = 0;
    for (const row of matrix.rows) {
      for (let j = 0; j < row.length; j++) {
        sums[j] += row[j];
        max = Math.max(max, Math.abs(row[j]));
      }
    }
    // An absolute matrix must be doubly stochastic (rows and columns sum to
    // one); a delta matrix must sum to zero both ways, because probability is
    // redistributed, never created. Check the property that actually applies.
    const target = mode === 'delta' ? 0 : 1;
    const rowSums = matrix.rows.map((row) => row.reduce((a, b) => a + b, 0));
    const maxRowError = Math.max(...rowSums.map((v) => Math.abs(v - target)), 0);
    const maxColumnError = Math.max(...sums.map((v) => Math.abs(v - target)), 0);
    return {
      order: expected,
      columnSums: sums,
      check: {
        ok: maxRowError <= 1e-6 && maxColumnError <= 1e-6,
        maxRowError,
        maxColumnError,
      },
      scale: max,
    };
  }, [matrix, mode]);

  const n = matrix.rosterIds.length;
  if (n === 0) return null;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[42rem] px-4 pb-4 sm:px-5">
        <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-ink-900/95 py-2 pr-3 text-left text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400 backdrop-blur">
                Team
              </th>
              {Array.from({ length: n }, (_, j) => (
                <th
                  key={j}
                  className={`num px-0 pb-2 text-center text-[0.6875rem] font-medium transition-colors ${
                    hover?.col === j ? 'text-ink-100' : 'text-ink-400'
                  }`}
                >
                  {j + 1}
                </th>
              ))}
              <th className="num pb-2 pl-3 text-right text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400">
                Σ
              </th>
            </tr>
          </thead>
          <tbody>
            {order.map((entry, displayRow) => {
              const row = matrix.rows[entry.index];
              const rowSum = row.reduce((a, b) => a + b, 0);
              const highlighted = highlightRosterId === entry.rosterId;
              return (
                <tr key={entry.rosterId} className="group">
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 max-w-[9.5rem] truncate bg-ink-900/95 py-1 pr-3 text-left font-medium backdrop-blur ${
                      highlighted ? 'text-blend-400' : 'text-ink-200'
                    }`}
                  >
                    {highlighted ? (
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-blend-400 align-middle" />
                    ) : null}
                    {teamName(entry.rosterId)}
                  </th>
                  {row.map((probability, col) => (
                    <td
                      key={col}
                      onMouseEnter={() => setHover({ row: displayRow, col })}
                      onMouseLeave={() => setHover(null)}
                      title={`${teamName(entry.rosterId)} · ${col + 1}${suffix(col + 1)} · ${
                        mode === 'delta'
                          ? signedPercentPoints(probability)
                          : percent(probability)
                      }`}
                      className="p-px"
                    >
                      <div
                        className={`num flex h-8 items-center justify-center rounded-[3px] text-[0.6875rem] tabular-nums transition ${
                          hover && (hover.row === displayRow || hover.col === col)
                            ? 'ring-1 ring-inset ring-white/20'
                            : ''
                        }`}
                        style={{
                          background:
                            mode === 'delta'
                              ? divergingColor(probability, scale)
                              : heatColor(probability, scale),
                          color:
                            Math.abs(probability) > scale * 0.45
                              ? 'var(--color-ink-100)'
                              : 'var(--color-ink-400)',
                        }}
                      >
                        {formatCell(probability, mode, scale)}
                      </div>
                    </td>
                  ))}
                  <td className="num py-1 pl-3 text-right text-ink-400">
                    {mode === 'delta' ? signedPercentPoints(rowSum, 1) : percent(rowSum, 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky left-0 z-10 bg-ink-900/95 pt-2 pr-3 text-left text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400 backdrop-blur">
                Σ
              </th>
              {columnSums.map((sum, j) => (
                <td key={j} className="num pt-2 text-center text-[0.6875rem] text-ink-400">
                  {mode === 'delta' ? signedPercentPoints(sum, 1) : percent(sum, 0)}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>

        <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-400">
          {caption ??
            'Every row sums to 100% because each team finishes somewhere. Every column sums to 100% because each position is taken by exactly one team.'}{' '}
          <span className={check.ok ? 'text-good-500' : 'text-bad-500'}>
            {check.ok
              ? mode === 'delta'
                ? `Conserved within ${Math.max(check.maxRowError, check.maxColumnError).toExponential(0)} — probability moved, none created.`
                : `Doubly stochastic within ${Math.max(check.maxRowError, check.maxColumnError).toExponential(0)} — raw simulation counts, no normalisation applied.`
              : `Off by ${Math.max(check.maxRowError, check.maxColumnError).toExponential(1)}. That is a bug to find, not a matrix to rescale.`}
          </span>
        </p>
      </div>
    </div>
  );
}

function formatCell(probability: number, mode: 'absolute' | 'delta', scale: number): string {
  if (mode === 'delta') {
    if (Math.abs(probability) < scale * 0.02) return '';
    return (probability * 100).toFixed(Math.abs(probability) >= 0.01 ? 1 : 2);
  }
  if (probability < 0.005) return '';
  return (probability * 100).toFixed(0);
}

function suffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}
