/**
 * The five tone marks as combining characters (grave, acute, tilde, hook above,
 * dot below). The vowel marks (circumflex, breve, horn) are part of the letter
 * and stay on it.
 */
const TONE_MARK = /[\u0300\u0301\u0303\u0309\u0323]/u;
const TONE_MARKS = /[\u0300\u0301\u0303\u0309\u0323]/gu;
const VOWEL_MARK = /[\u0302\u0306\u031b]/u;
const VOWEL = /[aeiouy]/u;
const SPACE = /\s/u;
const SPACES = /\s+/u;

/**
 * A word or phrase in one comparable form: lower case, no spaces, and each
 * tone mark moved to the end of its run of vowels. Vietnamese puts the tone on
 * different vowels by convention ("hoạ" and "họa", "thuý" and "thúy"); the run
 * is the same either way, so both read alike. Working per run rather than per
 * space-separated syllable keeps "học sinh", "Học  Sinh" and "họcsinh" equal.
 */
export function compactWord(text: string): string {
  let out = '';
  let tones = '';
  let inVowels = false;
  for (const char of text.normalize('NFC').toLowerCase().normalize('NFD')) {
    if (TONE_MARK.test(char)) {
      tones += char;
      continue;
    }
    if (inVowels && !VOWEL.test(char) && !VOWEL_MARK.test(char)) {
      out += tones;
      tones = '';
      inVowels = false;
    }
    if (VOWEL.test(char)) inVowels = true;
    if (!SPACE.test(char)) out += char;
  }
  return (out + tones).normalize('NFC');
}

/**
 * Equal for two words made of the same letters and the same tone marks, in any
 * order. Letters and tones are compared apart: the puzzle's letters carry their
 * tones, but a tone may move to another syllable and still use the same set,
 * as in "hầu cận" and "hậu cần". The vowel marks stay part of their letter.
 */
export function anagramKey(text: string): string {
  const decomposed = compactWord(text).normalize('NFD');
  const tones = (decomposed.match(TONE_MARKS) ?? []).sort().join('');
  const letters = Array.from(decomposed.replace(TONE_MARKS, '').normalize('NFC')).sort().join('');
  return `${letters}|${tones}`;
}

/** The number of syllables of a word as written. */
export function syllableCount(text: string): number {
  return text
    .trim()
    .split(SPACES)
    .filter((syllable) => syllable !== '').length;
}

/**
 * The letters of `answer`, upper case, shuffled into an order other than the
 * answer's own whenever its letters allow one. Every Vietnamese letter has a
 * precomposed form, so after NFC one code point is one letter with its marks.
 */
export function scrambleLetters(answer: string, random: () => number = Math.random): string {
  const letters = Array.from(answer.normalize('NFC').replace(/\s+/gu, ''));
  const original = letters.join('');
  const shuffled = [...letters];
  // A word like "ba ba" can shuffle back into itself; a few tries are enough
  // to avoid that, and a word whose letters are all the same has no other order.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j] as string, shuffled[i] as string];
    }
    if (shuffled.join('') !== original) break;
  }
  return shuffled.map((letter) => letter.toUpperCase()).join(' / ');
}

/** A hint at an answer: its shape, and its meaning with the answer hidden. */
type ScrambleHint = { pattern: string; meaning: string | null };

const MASK = '▒▒';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The first letter of each syllable and blanks for the rest ("H _ _   C _ _"),
 * and the meaning with every syllable of the answer hidden, as definitions often
 * repeat the word they define. A meaning that would be left with nothing but
 * masks is dropped.
 */
export function scrambleHint(answer: string, meaning: string | null): ScrambleHint {
  const syllables = answer.normalize('NFC').trim().split(SPACES).filter(Boolean);
  const pattern = syllables
    .map((syllable) => {
      const [first = '', ...rest] = Array.from(syllable);
      return [first.toUpperCase(), ...rest.map(() => '_')].join(' ');
    })
    .join('   ');
  if (meaning === null) return { pattern, meaning: null };
  let masked = meaning.normalize('NFC');
  for (const syllable of syllables) {
    masked = masked.replace(
      new RegExp(`(?<!\\p{L})${escapeRegExp(syllable)}(?!\\p{L})`, 'giu'),
      MASK,
    );
  }
  const leftover = masked.replaceAll(MASK, '').replace(/[\s\p{P}]/gu, '');
  return { pattern, meaning: leftover === '' ? null : masked };
}
