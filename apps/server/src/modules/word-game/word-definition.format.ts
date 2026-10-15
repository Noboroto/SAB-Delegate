import { escapeMarkdown } from 'discord.js';
import type { translatorFor } from '../../i18n/translator.js';
import type { WordDefinition } from './word-definition.service.js';

type Translator = ReturnType<typeof translatorFor>;

const SOURCE_NAMES = {
  wiktionary: 'Wiktionary',
  datamuse: 'Datamuse',
  machine: 'MyMemory',
} as const;

/** Discord's own limit for a message. */
const MAX_MESSAGE = 2000;

/**
 * Text from a source, made inert: no bold, no fake masked link. Headings and
 * list markers only act at the start of a line, and no source text starts one.
 */
function clean(text: string): string {
  return escapeMarkdown(text, { maskedLink: true });
}

/** `<…>` keeps Discord from unfurling the link even if the flag were dropped. */
function link(label: string, url: string): string {
  return `[${label}](<${url}>)`;
}

/**
 * The reply under an accepted word, in at most three short lines:
 *
 *     **run** · *noun* · 🇻🇳 Sự chạy.
 *     📖 An act of running. — *I went for a run.*
 *     -# Wiktionary · [Anh-Anh](<…>) · [Anh-Việt](<…>) · [Oxford](<…>)
 *
 * Every part comes from outside, so it is escaped; each is already capped in
 * length by the sources, and the whole is cut at Discord's limit should
 * escaping ever push it over.
 */
export function formatDefinition(word: string, definition: WordDefinition, t: Translator): string {
  const { english, vietnamese } = definition;
  const encoded = encodeURIComponent(word);

  const head = [`**${clean(word)}**`];
  if (english !== undefined && english.partOfSpeech !== '') {
    head.push(`*${clean(english.partOfSpeech)}*`);
  }
  if (vietnamese !== undefined) {
    const note =
      vietnamese.source === 'machine' ? ` (${t('word-game.definition.machineTranslated')})` : '';
    head.push(`🇻🇳 ${clean(vietnamese.meaning)}${note}`);
  }

  const lines = [head.join(' · ')];
  if (english !== undefined) {
    const example = english.example === undefined ? '' : ` — *${clean(english.example)}*`;
    lines.push(`📖 ${clean(english.definition)}${example}`);
  }

  const sources = new Set<string>();
  if (english !== undefined) sources.add(SOURCE_NAMES[english.source]);
  if (vietnamese !== undefined) sources.add(SOURCE_NAMES[vietnamese.source]);
  const footer = [...sources];
  if (english?.source === 'wiktionary') {
    footer.push(
      link(t('word-game.definition.englishLink'), `https://en.wiktionary.org/wiki/${encoded}`),
    );
  }
  if (vietnamese?.source === 'wiktionary') {
    footer.push(
      link(t('word-game.definition.vietnameseLink'), `https://vi.wiktionary.org/wiki/${encoded}`),
    );
  }
  footer.push(
    link(
      t('word-game.definition.oxfordLink'),
      `https://www.oxfordlearnersdictionaries.com/search/english/?q=${encoded}`,
    ),
  );
  lines.push(`-# ${footer.join(' · ')}`);
  const text = lines.join('\n');
  return text.length <= MAX_MESSAGE ? text : `${text.slice(0, MAX_MESSAGE - 1)}…`;
}
