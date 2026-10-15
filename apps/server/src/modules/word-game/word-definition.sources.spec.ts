import { describe, expect, it } from 'vitest';
import {
  htmlToText,
  parseDatamuse,
  parseEnglishWiktionary,
  parseMyMemory,
  parseVietnameseWiktionary,
  truncate,
  wikitextToText,
} from './word-definition.sources.js';

// Shapes copied from real answers of each source (2026-10-15), trimmed.

describe('htmlToText', () => {
  it('keeps the first line only, without nested senses, styles or tags', () => {
    const html =
      'To move <a rel="mw:WikiLink" href="/wiki/swiftly">swiftly</a>.\n<ol><li>To move forward</li></ol>';
    expect(htmlToText(html)).toBe('To move swiftly.');
    const styled =
      '<span class="usage-label-sense"></span> <a href="/wiki/vulture">Vulture</a>. <style data-mw-deduplicate="x">.mw-parser-output .defdate{font-size:smaller}</style>';
    expect(htmlToText(styled)).toBe('Vulture.');
  });

  it('completes a sense that is only a heading with its first sub-sense', () => {
    const html =
      'Used before a noun phrase, including a simple noun\n<ol><li>Used before a noun known to the listener.\n<ol><li>deeper</li></ol></li><li>second</li></ol>';
    expect(htmlToText(html)).toBe(
      'Used before a noun phrase, including a simple noun: Used before a noun known to the listener.',
    );
  });

  it('decodes entities and leaves an impossible code point as written', () => {
    expect(htmlToText('salt &amp; pepper&#33; caf&#xE9; &#99999999;')).toBe(
      'salt & pepper! café &#99999999;',
    );
  });
});

describe('parseEnglishWiktionary', () => {
  it('prefers a real part of speech over a leading symbol entry and takes its first example', () => {
    const body = {
      en: [
        { partOfSpeech: 'Symbol', definitions: [{ definition: 'A run in cricket.' }] },
        {
          partOfSpeech: 'Verb',
          definitions: [
            { definition: '' },
            {
              definition: 'To move <a href="/wiki/swiftly">swiftly</a>.',
              parsedExamples: [{ example: '<b>Run</b>, and you might still catch the train!' }],
            },
          ],
        },
      ],
      nl: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'Dutch' }] }],
    };
    expect(parseEnglishWiktionary(body)).toEqual({
      partOfSpeech: 'verb',
      definition: 'To move swiftly.',
      example: 'Run, and you might still catch the train!',
    });
  });

  it('falls back to a minor entry, and is empty without English', () => {
    expect(
      parseEnglishWiktionary({
        en: [{ partOfSpeech: 'Letter', definitions: [{ definition: 'X' }] }],
      }),
    ).toEqual({ partOfSpeech: 'letter', definition: 'X' });
    expect(parseEnglishWiktionary({ nl: [] })).toBeNull();
  });

  it('rejects a body of another shape', () => {
    expect(() => parseEnglishWiktionary({ en: 'nope' })).toThrow();
  });
});

describe('parseDatamuse', () => {
  it('reads the WordNet tag and text of the exact word only', () => {
    const body = [
      { word: 'aasvogel', score: 1, tags: ['n'], defs: ['n\t(South Africa) Vulture. '] },
    ];
    expect(parseDatamuse(body, 'aasvogel')).toEqual({
      partOfSpeech: 'noun',
      definition: '(South Africa) Vulture.',
    });
    expect(parseDatamuse(body, 'aasvogels')).toBeNull();
    expect(parseDatamuse([{ word: 'x' }], 'x')).toBeNull();
  });
});

describe('wikitextToText', () => {
  it('drops templates, even nested, and keeps the label of links', () => {
    expect(
      wikitextToText(
        " {{nhãn|en|South Africa|{{rare}}}} [[con|Con]] [[kền kền]] ([[than#Tiếng Việt|than]]) '''x'''.",
      ),
    ).toBe('Con kền kền (than) x.');
    expect(wikitextToText(' {{alternate spelling of|da|te}}')).toBe('');
  });
});

const OLD_STYLE = `{{-vie-}}
{{-verb-}}
# Bị [[rung động]] nhẹ.
{{-ref-}}
{{-eng-}}
{{-pron-}}
* IPA: /ˈrən/
{{-etymology-}}
# Từ [[tiếng Anh cổ]].
{{-noun-}}
{{en-noun-old}}
# Sự [[chạy]].
#: ''at a '''run''''' — đang chạy
{{-intr-verb-}}
# [[chạy|Chạy]].
{{-ref-}}
{{R:FVDP}}
{{-dan-}}
{{-noun-}}
# Danish sense.`;

const NEW_STYLE = `=={{langname|en}}==
==={{ĐM|etym}}===
# {{bor+|en|af|aardvark}}
==={{ĐM|n}}===
# [[lợn|Lợn]] [[đất]] {{defdate|từ khoảng cuối thế kỷ thứ 18}}
=={{langname|af}}==
==={{ĐM|n}}===
# Afrikaans sense.`;

describe('parseVietnameseWiktionary', () => {
  it('reads the English section of an old-style page, by part of speech, skipping etymology and examples', () => {
    expect(parseVietnameseWiktionary(OLD_STYLE)).toEqual([
      { partOfSpeech: 'noun', meaning: 'Sự chạy.' },
      { partOfSpeech: 'verb', meaning: 'Chạy.' },
    ]);
  });

  it('reads the English section of a new-style page and stops at the next language', () => {
    expect(parseVietnameseWiktionary(NEW_STYLE)).toEqual([
      { partOfSpeech: 'noun', meaning: 'Lợn đất' },
    ]);
  });

  it('stops at any unknown marker, so another language never leaks into English', () => {
    // vi.wiktionary "is": the English senses are only templates, then a hyphenated language code.
    const page =
      '{{-eng-}}\n{{-verb-}}\n# {{see-entry|be}}\n{{-cus-ash-}}\n{{-pronoun-}}\n# [[nhau]].';
    expect(parseVietnameseWiktionary(page)).toEqual([]);
    expect(
      parseVietnameseWiktionary('{{-eng-}}\n{{-see also-}}\n{{-aux-verb-}}\n# Thì, là.'),
    ).toEqual([{ partOfSpeech: 'verb', meaning: 'Thì, là.' }]);
  });

  it('is empty for a page without English', () => {
    expect(parseVietnameseWiktionary('{{-vie-}}\n{{-noun-}}\n# Từ tiếng Việt.')).toEqual([]);
  });
});

describe('parseMyMemory', () => {
  it('returns the translation and throws on a refusal or an exhausted quota', () => {
    const ok = {
      responseStatus: 200,
      quotaFinished: false,
      responseData: { translatedText: 'Để di chuyển nhanh chóng bằng cách đi bộ' },
    };
    expect(parseMyMemory(ok)).toBe('Để di chuyển nhanh chóng bằng cách đi bộ');
    expect(() => parseMyMemory({ ...ok, responseStatus: '403' })).toThrow();
    expect(() => parseMyMemory({ ...ok, quotaFinished: true })).toThrow();
    expect(
      parseMyMemory({ ...ok, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL' } }),
    ).toBeNull();
  });
});

describe('truncate', () => {
  it('cuts long text with an ellipsis and leaves short text alone', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
