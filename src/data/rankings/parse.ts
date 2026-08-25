import type { Position } from '../../engine/types';
import type { RankingEntry, RankingList } from './types';

/**
 * Manual paste or file import.
 *
 * FantasyPros lets a subscriber export their rankings, so this path works
 * today with no legal or technical risk. It accepts the CSV they produce, a
 * tab separated paste out of a spreadsheet, and a plain numbered list typed by
 * hand, because in practice people arrive with all three.
 */

const TAB = String.fromCharCode(9);
const POSITION_PATTERN = /\b(QB|RB|WR|TE)\b/i;
const VALID: Record<string, Position> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE' };

export interface ParseResult {
  entries: RankingEntry[];
  /** Lines that could not be understood, shown back to the user verbatim. */
  skipped: string[];
  detected: 'csv' | 'tsv' | 'text';
}

function splitRow(line: string, delimiter: string): string[] {
  if (delimiter !== ',') return line.split(delimiter).map((c) => c.trim());
  // Minimal CSV handling: quoted fields may contain commas.
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(text: string): {
  delimiter: string;
  kind: ParseResult['detected'];
} {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  if (sample.includes(TAB)) return { delimiter: TAB, kind: 'tsv' };
  if (sample.includes(',')) return { delimiter: ',', kind: 'csv' };
  return { delimiter: ' ', kind: 'text' };
}

function cleanName(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, '')
    .replace(/^\d+[.)]?\s*/, '')
    .replace(/\s+(QB|RB|WR|TE)\d*\s*$/i, '')
    .replace(/\s+[A-Z]{2,3}\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function positionOf(cells: string[], fallbackLine: string): Position | null {
  for (const cell of cells) {
    const bare = cell.replace(/\d+$/, '').trim().toUpperCase();
    if (VALID[bare]) return VALID[bare];
  }
  const match = fallbackLine.match(POSITION_PATTERN);
  if (match) return VALID[match[1].toUpperCase()] ?? null;
  return null;
}

function teamOf(cells: string[]): string | null {
  for (const cell of cells) {
    const bare = cell.trim().toUpperCase();
    if (/^[A-Z]{2,3}$/.test(bare) && !VALID[bare]) return bare;
  }
  return null;
}

export function parseRankingText(text: string): ParseResult {
  const { delimiter, kind } = detectDelimiter(text);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: RankingEntry[] = [];
  const skipped: string[] = [];
  let rank = 0;

  for (const line of lines) {
    const cells = kind === 'text' ? [line] : splitRow(line, delimiter);
    const lower = line.toLowerCase();

    // Header rows, tier separators and section titles.
    if (/^tier\s*\d+/i.test(line)) continue;
    if (
      /^(rk|rank|overall|player|pos|position)\b/.test(lower) &&
      !POSITION_PATTERN.test(line.replace(/^(rk|rank)\b/i, ''))
    ) {
      continue;
    }

    const position = positionOf(cells, line);
    if (!position) {
      skipped.push(line);
      continue;
    }

    // The name is the longest cell that is neither a position nor a number.
    const nameCell =
      cells
        .filter((c) => {
          const bare = c.replace(/\d+$/, '').trim().toUpperCase();
          return !VALID[bare] && !/^\d+(\.\d+)?$/.test(c) && c.length > 2;
        })
        .sort((a, b) => b.length - a.length)[0] ?? '';

    const name = cleanName(nameCell || line);
    if (!name || name.length < 3) {
      skipped.push(line);
      continue;
    }

    rank += 1;
    entries.push({ name, position, team: teamOf(cells), rank });
  }

  return { entries, skipped, detected: kind };
}

export function listFromText(
  text: string,
  horizon: RankingList['horizon'],
  scope: RankingList['scope'],
  format: RankingList['format'],
): { list: RankingList; skipped: string[] } {
  const parsed = parseRankingText(text);
  let entries = parsed.entries;
  // A positional list should only contain that position; re-rank if the paste
  // included others.
  if (scope !== 'overall') {
    entries = entries
      .filter((e) => e.position === scope)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }
  return { list: { horizon, scope, format, entries }, skipped: parsed.skipped };
}
