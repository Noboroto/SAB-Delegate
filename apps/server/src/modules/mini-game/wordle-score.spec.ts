import { describe, expect, it } from 'vitest';
import { renderBoard, scoreGuess, type LetterMark } from './wordle-score.js';

/** "HNM" style shorthand: H hit, N near, M miss. */
function marks(guess: string, answer: string): string {
  const short: Record<LetterMark, string> = { HIT: 'H', NEAR: 'N', MISS: 'M' };
  return scoreGuess(guess, answer)
    .map((mark) => short[mark])
    .join('');
}

describe('scoreGuess', () => {
  it('marks every letter a hit for the answer itself', () => {
    expect(marks('crane', 'crane')).toBe('HHHHH');
  });

  it('marks every letter a miss when none is in the answer', () => {
    expect(marks('fuzzy', 'crane')).toBe('MMMMM');
  });

  it('marks a misplaced letter near', () => {
    expect(marks('nacre', 'crane')).toBe('NNNNH');
  });

  it('marks only one e of "speed" against "abide"', () => {
    // The answer has a single e; the guess has two, so the second is a miss.
    expect(marks('speed', 'abide')).toBe('MMNMN');
  });

  it('gives the hit its letter before a misplaced copy can take it', () => {
    // "eerie" against "there": the last e is a hit and uses up one of the two e.
    expect(marks('eerie', 'there')).toBe('NMNMH');
  });

  it('marks as many near copies as the answer has left over', () => {
    expect(marks('llama', 'hello')).toBe('NNMMM');
    // Both l of the answer are hits, so the l before them has none left.
    expect(marks('lolly', 'hello')).toBe('MNHHM');
  });

  it('counts a second copy as a miss once the answer is used up', () => {
    expect(marks('geese', 'eagle')).toBe('NNMMH');
    expect(marks('aaaaa', 'abaca')).toBe('HMHMH');
    expect(marks('aabbb', 'baaac')).toBe('NHNMM');
  });

  it('returns one mark per letter of the guess', () => {
    expect(scoreGuess('crane', 'slate')).toHaveLength(5);
  });
});

describe('renderBoard', () => {
  it('prints one line per guess: the squares, then the upper-case word in code format', () => {
    const board = renderBoard(['fuzzy', 'crane'], 'crane');
    expect(board).toBe('⬛⬛⬛⬛⬛ `FUZZY`\n🟩🟩🟩🟩🟩 `CRANE`');
  });

  it('uses yellow for a near letter and green for a hit', () => {
    expect(renderBoard(['nacre'], 'crane')).toBe('🟨🟨🟨🟨🟩 `NACRE`');
  });

  it('is empty without guesses', () => {
    expect(renderBoard([], 'crane')).toBe('');
  });
});
