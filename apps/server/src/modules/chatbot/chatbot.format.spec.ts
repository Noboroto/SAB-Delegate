import { MESSAGE_MAX_LENGTH } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import { formatReply } from './chatbot.format.js';

const FOOTER = '-# còn lại 99.999 / 100.000 · làm mới <t:1793466000:R>';
const LINE = `\n${FOOTER}`;

/** Deterministic pseudo-random numbers, so a failure reproduces. */
function lcg(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state % max;
  };
}

describe('formatReply', () => {
  it('puts the footer on its own line at the end of a short answer', () => {
    expect(formatReply('Xin chào', FOOTER)).toEqual([`Xin chào${LINE}`]);
  });

  it('splits a 6000-character answer into chunks that all fit, with the footer on the last only', () => {
    const body = Array.from({ length: 60 }, (_, i) => `${i}: ${'x'.repeat(95)}`).join('\n');
    expect(body.length).toBeGreaterThan(5900);
    const chunks = formatReply(body, FOOTER);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
    expect(chunks.slice(0, -1).every((chunk) => !chunk.includes(FOOTER))).toBe(true);
    expect(chunks.at(-1)?.endsWith(LINE)).toBe(true);
    expect(chunks.filter((chunk) => chunk.includes(FOOTER))).toHaveLength(1);
  });

  it('keeps the footer when the answer is exactly as long as the room left for it', () => {
    const body = 'a'.repeat(MESSAGE_MAX_LENGTH - LINE.length);
    const chunks = formatReply(body, FOOTER);
    expect(chunks).toEqual([`${body}${LINE}`]);
    expect(chunks[0]?.length).toBe(MESSAGE_MAX_LENGTH);
  });

  it('starts a second message when the answer is one character over', () => {
    const chunks = formatReply('a'.repeat(MESSAGE_MAX_LENGTH - LINE.length + 1), FOOTER);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= MESSAGE_MAX_LENGTH)).toBe(true);
    expect(chunks[1]?.endsWith(FOOTER)).toBe(true);
  });

  it('sends only the footer, without a leading blank line, for an answer with no text', () => {
    expect(formatReply('', FOOTER)).toEqual([FOOTER]);
    expect(formatReply(' \n\t ', FOOTER)).toEqual([FOOTER]);
  });

  it('never exceeds the limit and never loses the footer, whatever the answer looks like', () => {
    const next = lcg(20_261_016);
    const pieces = ['a', 'bb', '😀', '\n', '\n\n', ' ', 'đ', 'x'.repeat(40), '😀'.repeat(10)];
    for (let round = 0; round < 300; round += 1) {
      let body = '';
      const target = next(9000);
      while (body.length < target) body += pieces[next(pieces.length)] ?? '';
      const chunks = formatReply(body, FOOTER);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
        // A cut inside an emoji would show as a broken character.
        expect(chunk).not.toMatch(/[\ud800-\udfff]/u);
      }
      expect(chunks.at(-1)?.endsWith(FOOTER)).toBe(true);
      expect(chunks.filter((chunk) => chunk.includes(FOOTER))).toHaveLength(1);
    }
  });

  describe('code blocks', () => {
    const fences = (text: string) =>
      text.split('\n').filter((l) => l.trimStart().startsWith('```'));

    it('closes a block cut by a split and reopens it in the next chunk', () => {
      const code = Array.from({ length: 80 }, (_, i) => `const v${i} = ${'z'.repeat(40)};`);
      const chunks = formatReply(['Đây:', '```ts', ...code, '```', 'Xong.'].join('\n'), FOOTER);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
        // Every chunk holds its blocks whole.
        expect(fences(chunk.replace(LINE, '')).length % 2).toBe(0);
      }
      expect(chunks.at(-1)?.endsWith(`\n${FOOTER}`)).toBe(true);
    });

    it('closes a block the answer left open, before the footer', () => {
      const [only] = formatReply('```js\nlet a = 1;…', FOOTER);
      expect(only).toBe(`\`\`\`js\nlet a = 1;…\n\`\`\`${LINE}`);
    });

    it('leaves a block opened and closed on one line alone', () => {
      expect(formatReply('x ```a``` y\n```b```', FOOTER)).toEqual([
        `x \`\`\`a\`\`\` y\n\`\`\`b\`\`\`${LINE}`,
      ]);
    });

    it('keeps every chunk within the limit for a long block', () => {
      const body = `\`\`\`\n${'q'.repeat(9000)}\n\`\`\``;
      for (const chunk of formatReply(body, FOOTER)) {
        expect(chunk.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
      }
    });
  });

  it('loses no text of the answer', () => {
    const body = Array.from({ length: 80 }, (_, i) => `dòng ${i} ${'y'.repeat(50)}`).join('\n');
    const joined = formatReply(body, FOOTER).join('\n').replace(LINE, '');
    expect(joined).toBe(body);
  });
});
