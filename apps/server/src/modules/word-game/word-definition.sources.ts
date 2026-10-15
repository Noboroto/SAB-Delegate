import { z } from '@sab/shared';

/**
 * The free, keyless sources a word's meaning is read from. Every fetcher
 * returns `null` when the source has no entry for the word and throws when it
 * could not be asked (network, timeout, quota, unexpected shape), so the caller
 * can tell "not there" from "try again later".
 *
 * The HTML and wikitext cleanup is written here rather than taken from a
 * package: what is needed is dropping tags, templates and link markup from one
 * line, and the packages that do it (html-to-text, wtf_wikipedia) each bring a
 * full parser for documents this never reads. Entities are decoded from a
 * short list: the REST API sends UTF-8 text and wikitext uses only a handful;
 * an unknown one is shown as written rather than adding a dependency.
 */

export type DefinitionFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Wikimedia asks every client to name itself and give a way to reach the owner. */
const USER_AGENT = 'SAB-Delegate/1.0 (https://github.com/Noboroto/SAB-Delegate)';
const TIMEOUT_MS = 3000;
/** One sense is shown; longer text is cut so the reply stays short. */
const MAX_TEXT = 300;

/**
 * An English sense with its part of speech, as shown in the reply. Every parser
 * ends with these schemas: what leaves this file is checked once more after the
 * cleanup, whatever odd input went in.
 */
export const EnglishSenseSchema = z.object({
  partOfSpeech: z.string(),
  definition: z.string().min(1),
  example: z.string().min(1).optional(),
});
export type EnglishSense = z.infer<typeof EnglishSenseSchema>;

/** A Vietnamese meaning; `partOfSpeech` is the English name, to match the English sense. */
const VietnameseSenseSchema = z.object({
  partOfSpeech: z.string().optional(),
  meaning: z.string().min(1),
});
export type VietnameseSense = z.infer<typeof VietnameseSenseSchema>;

async function get(fetcher: DefinitionFetch, url: string): Promise<Response | null> {
  const response = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Dictionary source answered HTTP ${response.status}`);
  return response;
}

export function truncate(text: string, max = MAX_TEXT): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  minus: '−',
  times: '×',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (!name.startsWith('#')) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const hex = name[1] === 'x' || name[1] === 'X';
    const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    // `fromCodePoint` throws past the last code point; such an entity is left as written.
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * The first line of a Wiktionary definition as plain text. Sub-senses follow in
 * a nested list and style sheets sit inline, so both are dropped before the tags.
 */
export function htmlToText(html: string): string {
  const head = lineText(html.split(/\n|<(?:ol|ul|dl)\b/i)[0] ?? '');
  // Some senses are only a heading for their sub-senses ("Used before a noun
  // phrase, including a simple noun"); the first sub-sense completes them.
  if (/[.!?)]$/.test(head)) return head;
  const firstItem = /<li\b[^>]*>([\s\S]*)/i.exec(html)?.[1];
  if (firstItem === undefined) return head;
  const sub = lineText(firstItem.split(/\n|<\/li>|<(?:ol|ul|dl)\b/i)[0] ?? '');
  if (sub === '') return head;
  return head === '' ? sub : `${head}: ${sub}`;
}

function lineText(html: string): string {
  const withoutBlocks = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  return squash(decodeEntities(withoutBlocks.replace(/<[^>]*>/g, '')));
}

const WiktionaryDefinitionSchema = z.object({
  definition: z.string(),
  examples: z.array(z.string()).optional(),
  parsedExamples: z.array(z.object({ example: z.string() })).optional(),
});

const WiktionaryEntriesSchema = z.object({
  en: z
    .array(
      z.object({
        partOfSpeech: z.string(),
        definitions: z.array(WiktionaryDefinitionSchema),
      }),
    )
    .optional(),
});

/** Entries such as "Symbol" or "Letter" come first for short words but say little. */
const MINOR_PARTS = new Set(['symbol', 'letter', 'character']);

export function parseEnglishWiktionary(body: unknown): EnglishSense | null {
  const entries = WiktionaryEntriesSchema.parse(body).en ?? [];
  const ordered = [
    ...entries.filter((entry) => !MINOR_PARTS.has(entry.partOfSpeech.toLowerCase())),
    ...entries.filter((entry) => MINOR_PARTS.has(entry.partOfSpeech.toLowerCase())),
  ];
  for (const entry of ordered) {
    for (const sense of entry.definitions) {
      const definition = htmlToText(sense.definition);
      if (definition === '') continue;
      const rawExample = sense.parsedExamples?.[0]?.example ?? sense.examples?.[0];
      const example = rawExample === undefined ? '' : htmlToText(rawExample);
      return EnglishSenseSchema.parse({
        partOfSpeech: entry.partOfSpeech.toLowerCase(),
        definition: truncate(definition),
        ...(example === '' ? {} : { example: truncate(example, 200) }),
      });
    }
  }
  return null;
}

export async function fetchEnglishWiktionary(
  fetcher: DefinitionFetch,
  word: string,
): Promise<EnglishSense | null> {
  const response = await get(
    fetcher,
    `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
  );
  return response === null ? null : parseEnglishWiktionary(await response.json());
}

const DatamuseSchema = z.array(
  z.object({ word: z.string(), defs: z.array(z.string()).optional() }),
);

const DATAMUSE_PARTS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
};

/** Datamuse defines through WordNet: each definition is "<pos>\t<text>". */
export function parseDatamuse(body: unknown, word: string): EnglishSense | null {
  const match = DatamuseSchema.parse(body).find((entry) => entry.word === word);
  const first = match?.defs?.[0];
  if (first === undefined) return null;
  const tab = first.indexOf('\t');
  const definition = squash(tab === -1 ? first : first.slice(tab + 1));
  if (definition === '') return null;
  const tag = tab === -1 ? '' : first.slice(0, tab);
  return EnglishSenseSchema.parse({
    partOfSpeech: DATAMUSE_PARTS[tag] ?? '',
    definition: truncate(definition),
  });
}

export async function fetchDatamuse(
  fetcher: DefinitionFetch,
  word: string,
): Promise<EnglishSense | null> {
  const response = await get(
    fetcher,
    `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dp&max=1`,
  );
  return response === null ? null : parseDatamuse(await response.json(), word);
}

/**
 * Section markers of vi.wiktionary. Older pages use `{{-eng-}}` and
 * `{{-noun-}}`, newer ones `=={{langname|en}}==` and `==={{ĐM|n}}===`; both
 * are in use today.
 */
const PARTS_OF_SPEECH: Record<string, string> = {
  noun: 'noun',
  n: 'noun',
  verb: 'verb',
  v: 'verb',
  'tr-verb': 'verb',
  'intr-verb': 'verb',
  'aux-verb': 'verb',
  adj: 'adjective',
  adv: 'adverb',
  prep: 'preposition',
  conj: 'conjunction',
  interj: 'interjection',
  intj: 'interjection',
  pronoun: 'pronoun',
  'per-pronoun': 'pronoun',
  'def-article': 'article',
  'indef-article': 'article',
  article: 'article',
  determiner: 'determiner',
  num: 'numeral',
};

/**
 * Old-style markers that are sections inside a language but hold no meaning.
 * A marker that is neither one of these nor a part of speech is taken as the
 * next language (`{{-vie-}}`, but also `{{-cus-ash-}}`): reading on past an
 * unknown marker once showed the meaning of another language's word, while
 * stopping early only loses a meaning, which the translation then covers.
 */
const SECTIONS = new Set([
  'pron',
  'etym',
  'etymology',
  'ref',
  'reference',
  'syn',
  'ant',
  'drv',
  'derived',
  'related',
  'expr',
  'forms',
  'usage',
  'homo',
  'paro',
  'trans',
  'translit',
  'info',
  'see also',
  'further',
  'compound',
  'alter form',
  'abbr',
  'letter',
  'symbol',
  'decl',
]);

const OLD_MARKER = /^\{\{-([^{}|]+)-\}\}\s*$/;
const NEW_LANGUAGE = /^==\s*\{\{langname\|([^}|]+)\}\}\s*==\s*$/;
const NEW_SECTION = /^===+\s*\{\{ĐM\|([^}|]+)\}\}\s*===+\s*$/;

/** One definition line of wikitext as plain text; empty when only templates remain. */
export function wikitextToText(line: string): string {
  let text = line.replace(/<ref\b[^>]*\/>|<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  // Templates nest ({{lb|en|{{...}}}}); removing the innermost first until none remain.
  let previous;
  do {
    previous = text;
    text = text.replace(/\{\{[^{}]*\}\}/g, '');
  } while (text !== previous);
  text = text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]*>/g, '');
  return squash(decodeEntities(text));
}

export function parseVietnameseWiktionary(wikitext: string): VietnameseSense[] {
  const senses: VietnameseSense[] = [];
  let inEnglish = false;
  let part: string | undefined;
  for (const raw of wikitext.split('\n')) {
    const line = raw.trim();
    const language = NEW_LANGUAGE.exec(line);
    if (language !== null) {
      if (inEnglish) break;
      inEnglish = language[1]?.trim() === 'en';
      part = undefined;
      continue;
    }
    const old = OLD_MARKER.exec(line);
    if (old !== null) {
      const code = old[1] ?? '';
      if (code === 'eng') {
        inEnglish = true;
        part = undefined;
        continue;
      }
      if (!inEnglish) continue;
      if (code in PARTS_OF_SPEECH) part = PARTS_OF_SPEECH[code];
      else if (SECTIONS.has(code)) part = undefined;
      else break;
      continue;
    }
    const section = NEW_SECTION.exec(line);
    if (section !== null) {
      if (inEnglish) part = PARTS_OF_SPEECH[section[1]?.trim() ?? ''];
      continue;
    }
    if (!inEnglish || part === undefined || !/^#(?![#:*])/.test(line)) continue;
    const meaning = wikitextToText(line.slice(1));
    if (meaning !== '') {
      senses.push(VietnameseSenseSchema.parse({ partOfSpeech: part, meaning: truncate(meaning) }));
    }
  }
  return senses;
}

export async function fetchVietnameseWiktionary(
  fetcher: DefinitionFetch,
  word: string,
): Promise<VietnameseSense[] | null> {
  const response = await get(
    fetcher,
    `https://vi.wiktionary.org/w/index.php?title=${encodeURIComponent(word)}&action=raw`,
  );
  if (response === null) return null;
  const senses = parseVietnameseWiktionary(await response.text());
  return senses.length === 0 ? null : senses;
}

const MyMemorySchema = z.object({
  responseStatus: z.union([z.number(), z.string()]),
  quotaFinished: z.boolean().nullish(),
  responseData: z.object({ translatedText: z.string().nullish() }).nullish(),
});

/** MyMemory answers HTTP 200 even when it refuses; the refusal is in the body. */
export function parseMyMemory(body: unknown): string | null {
  const parsed = MyMemorySchema.parse(body);
  if (Number(parsed.responseStatus) !== 200 || parsed.quotaFinished === true) {
    throw new Error(`Translation refused (status ${String(parsed.responseStatus)})`);
  }
  const text = squash(decodeEntities(parsed.responseData?.translatedText ?? ''));
  if (text === '' || text.startsWith('MYMEMORY WARNING')) return null;
  return truncate(text);
}

export async function translateToVietnamese(
  fetcher: DefinitionFetch,
  text: string,
): Promise<string | null> {
  const response = await get(
    fetcher,
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|vi`,
  );
  return response === null ? null : parseMyMemory(await response.json());
}
