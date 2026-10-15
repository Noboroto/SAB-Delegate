import { describe, expect, it } from 'vitest';
import { anagramKey, compactWord, scrambleLetters, syllableCount } from './vietnamese.js';

/** A random source that replays `values` and then repeats the last one. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] as number;
}

describe('compactWord', () => {
  it('writes the tone on either vowel of "hoạ" / "họa" the same way', () => {
    expect(compactWord('hoạ')).toBe(compactWord('họa'));
    expect(compactWord('thuý')).toBe(compactWord('thúy'));
    expect(compactWord('Hoà Bình')).toBe(compactWord('hòa bình'));
  });

  it('ignores case, spacing and the space between syllables', () => {
    const expected = compactWord('học sinh');
    expect(compactWord('Học  Sinh')).toBe(expected);
    expect(compactWord('  học\tsinh\n')).toBe(expected);
  });

  it('writes an unspaced "họcsinh" like "học sinh"', () => {
    expect(compactWord('họcsinh')).toBe(compactWord('học sinh'));
  });

  it('places tones per vowel run, so old and new tone spelling match', () => {
    expect(compactWord('hoạ gia')).toBe(compactWord('họa gia'));
    expect(compactWord('thuý')).toBe(compactWord('thúy'));
    expect(compactWord('thuở')).toBe('thuở');
    expect(compactWord('học sinh')).toBe('họcsinh');
  });

  it('gives the same result for decomposed and precomposed input', () => {
    const decomposed = 'học sinh'.normalize('NFD');
    expect(decomposed).not.toBe('học sinh');
    expect(compactWord(decomposed)).toBe(compactWord('học sinh'));
  });

  it('keeps the vowel marks on the letter: "ă", "â" and "a" differ', () => {
    expect(compactWord('ăn')).not.toBe(compactWord('an'));
    expect(compactWord('ân')).not.toBe(compactWord('ăn'));
    expect(compactWord('đi')).not.toBe(compactWord('di'));
  });

  it('keeps different tones apart', () => {
    expect(compactWord('má')).not.toBe(compactWord('mà'));
    expect(compactWord('mả')).not.toBe(compactWord('mã'));
    expect(compactWord('mạ')).not.toBe(compactWord('ma'));
  });

  it('keeps a mark on the syllable it belongs to', () => {
    expect(compactWord('má ma')).not.toBe(compactWord('ma má'));
  });

  it('is empty for blank text', () => {
    expect(compactWord('')).toBe('');
    expect(compactWord('  \n ')).toBe('');
  });
});

describe('anagramKey', () => {
  it('is equal for any ordering of the same letters', () => {
    expect(anagramKey('tiếng')).toBe(anagramKey('gniết'));
    expect(anagramKey('con mèo')).toBe(anagramKey('mèo con'));
    expect(anagramKey('abc')).toBe(anagramKey('cba'));
  });

  it('ignores spaces, case and tone placement', () => {
    expect(anagramKey('Học Sinh')).toBe(anagramKey('sinh HỌC'));
    expect(anagramKey('hoạ')).toBe(anagramKey('họa'));
  });

  it('differs when a letter or a tone differs', () => {
    expect(anagramKey('abc')).not.toBe(anagramKey('abd'));
    expect(anagramKey('abc')).not.toBe(anagramKey('abcc'));
    expect(anagramKey('má')).not.toBe(anagramKey('mà'));
  });
});

describe('syllableCount', () => {
  it.each([
    ['học', 1],
    ['học sinh', 2],
    ['  học   sinh  giỏi ', 3],
    ['', 0],
    ['   ', 0],
  ])('counts %j as %i', (text, count) => {
    expect(syllableCount(text)).toBe(count);
  });
});

describe('scrambleLetters', () => {
  it('upper-cases the letters and separates them with " / "', () => {
    const result = scrambleLetters('mèo', () => 0);
    expect(result).toMatch(/^[^ ]( \/ [^ ]){2}$/u);
    expect(result).toBe(result.toUpperCase());
    expect(result.split(' / ').sort()).toEqual(['M', 'O', 'È'].sort());
  });

  it('drops the spaces of a phrase and keeps every letter', () => {
    const letters = scrambleLetters('học sinh').split(' / ');
    expect(letters).toHaveLength(7);
    expect([...letters].sort()).toEqual(Array.from('HỌCSINH').sort());
  });

  it('never returns the answer order when another order exists', () => {
    // random() = 0.99 picks j = i on every step, so the first pass leaves the
    // letters where they were; the retry must then move them.
    const answer = 'abcd';
    const result = scrambleLetters(answer, sequence([0.99, 0.99, 0.99, 0, 0, 0]));
    expect(result.replaceAll(' / ', '')).not.toBe('ABCD');
    expect(result.split(' / ').sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('terminates for a word that has only one order', () => {
    expect(scrambleLetters('aaa', () => 0.5)).toBe('A / A / A');
    expect(scrambleLetters('a')).toBe('A');
  });

  it('is a valid shuffle with the real random source', () => {
    for (let run = 0; run < 50; run += 1) {
      const result = scrambleLetters('tiếng việt').split(' / ');
      expect([...result].sort()).toEqual(Array.from('TIẾNGVIỆT').sort());
    }
  });
});
