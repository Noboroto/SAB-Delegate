export type LetterMark = 'HIT' | 'NEAR' | 'MISS';

const SQUARES: Record<LetterMark, string> = { HIT: '🟩', NEAR: '🟨', MISS: '⬛' };

/**
 * Wordle's marks for one guess. Exact hits are taken first; a letter elsewhere
 * in the answer is then marked near only as many times as the answer has it
 * left over, so guessing "speed" against "abide" marks one `e`, not two.
 */
export function scoreGuess(guess: string, answer: string): LetterMark[] {
  const marks: LetterMark[] = Array.from(guess, () => 'MISS');
  const left = new Map<string, number>();
  for (let i = 0; i < answer.length; i += 1) {
    const letter = answer[i] as string;
    if (guess[i] === letter) marks[i] = 'HIT';
    else left.set(letter, (left.get(letter) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i += 1) {
    const letter = guess[i] as string;
    const count = left.get(letter) ?? 0;
    if (marks[i] === 'HIT' || count === 0) continue;
    marks[i] = 'NEAR';
    left.set(letter, count - 1);
  }
  return marks;
}

/** One line per guess: its squares, then the word. */
export function renderBoard(guesses: readonly string[], answer: string): string {
  return guesses
    .map((guess) => {
      const squares = scoreGuess(guess, answer)
        .map((mark) => SQUARES[mark])
        .join('');
      return `${squares} \`${guess.toUpperCase()}\``;
    })
    .join('\n');
}
