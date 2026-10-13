import { MESSAGE_MAX_LENGTH } from '../constants/limits.js';

/** Sent when there is nothing to say: Discord rejects an empty body. */
const EMPTY_PLACEHOLDER = '(empty)';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Length of the slice to take from `line` at `start`: at most `max`, backed off
 * by one when the cut would strand half of a surrogate pair (an emoji), which
 * Discord shows as a broken character.
 */
function sliceLength(line: string, start: number, max: number): number {
  const remaining = line.length - start;
  if (remaining <= max) return remaining;
  if (max > 1 && isHighSurrogate(line.charCodeAt(start + max - 1))) return max - 1;
  return max;
}

/**
 * Splits text on line boundaries into pieces of at most `max` characters. A
 * single line longer than `max` is cut hard, since there is no better seam.
 * Whitespace-only pieces are dropped because Discord rejects them, and input
 * with nothing left yields one placeholder so a caller always has a body.
 */
export function splitMessage(text: string, max: number = MESSAGE_MAX_LENGTH): string[] {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`splitMessage: max must be a positive integer, got ${String(max)}`);
  }
  const chunks: string[] = [];
  let current: string | undefined;

  for (const line of text.split('\n')) {
    let start = 0;
    do {
      const length = sliceLength(line, start, max);
      const part = line.slice(start, start + length);
      if (current === undefined) {
        current = part;
      } else if (current.length + 1 + part.length > max) {
        chunks.push(current);
        current = part;
      } else {
        current += '\n' + part;
      }
      start += length;
    } while (start < line.length);
  }
  if (current !== undefined) chunks.push(current);

  const nonBlank = chunks.filter((chunk) => chunk.trim().length > 0);
  return nonBlank.length > 0 ? nonBlank : [EMPTY_PLACEHOLDER];
}
