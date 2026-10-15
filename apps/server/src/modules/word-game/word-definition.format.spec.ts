import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../i18n/translator.js';
import { formatDefinition } from './word-definition.format.js';

const vi = translatorFor('vi');
const en = translatorFor('en');

describe('formatDefinition', () => {
  it('shows both meanings, the example, the sources and all three links', () => {
    const text = formatDefinition(
      'run',
      {
        english: {
          partOfSpeech: 'noun',
          definition: 'An act of running.',
          example: 'I went for a run.',
          source: 'wiktionary',
        },
        vietnamese: { meaning: 'Sự chạy.', source: 'wiktionary' },
      },
      vi,
    );
    expect(text).toBe(
      [
        '**run** · *noun* · 🇻🇳 Sự chạy.',
        '📖 An act of running. — *I went for a run.*',
        '-# Wiktionary · [Anh-Anh](<https://en.wiktionary.org/wiki/run>) · [Anh-Việt](<https://vi.wiktionary.org/wiki/run>) · [Oxford](<https://www.oxfordlearnersdictionaries.com/search/english/?q=run>)',
      ].join('\n'),
    );
  });

  it('marks a machine translation, names each source and links only the pages that exist', () => {
    const text = formatDefinition(
      'aasvogel',
      {
        english: { partOfSpeech: 'noun', definition: 'Vulture.', source: 'datamuse' },
        vietnamese: { meaning: 'Kền kền.', source: 'machine' },
      },
      en,
    );
    expect(text).toContain('🇻🇳 Kền kền. (machine translation)');
    expect(text).toContain('-# Datamuse · MyMemory · [Oxford](<');
    expect(text).not.toContain('wiktionary.org');
  });

  it('makes a masked link from a source inert and stays within the message limit', () => {
    const text = formatDefinition(
      'x',
      {
        english: {
          partOfSpeech: 'noun',
          definition: `[click](https://evil.example) ${'*'.repeat(3000)}`,
          source: 'datamuse',
        },
      },
      vi,
    );
    expect(text).toContain('\\[click](https://evil.example)');
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it('escapes markdown that comes from a source', () => {
    const text = formatDefinition(
      'star',
      { vietnamese: { meaning: 'Ngôi *sao* _x_', source: 'wiktionary' } },
      vi,
    );
    expect(text.split('\n')[0]).toBe('**star** · 🇻🇳 Ngôi \\*sao\\* \\_x\\_');
  });
});
