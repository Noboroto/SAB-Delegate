import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppStateService } from '../../app-state/app-state.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LlmService } from '../llm/llm.service.js';
import { readAsset } from '../word-game/dictionary.service.js';
import { compactWord } from './vietnamese.js';

const WORDS_ASSET = 'viet-words.txt';
const MEANINGS_ASSET = 'viet-meanings.tsv';
const SEED_KEY = 'viet-words:asset-hash';
/**
 * Part of the seed hash: raise it whenever the load itself changes (the
 * `normalizeWord` keys, which words are kept), so the table is loaded again
 * even though the assets did not change.
 */
const SEED_VERSION = '2';
const SEED_BATCH = 2_000;
const MEANING_SOURCES = new Set(['WIKTIONARY', 'VNTK']);

const MARKS = /\p{M}/gu;
const SPACES = /\s+/gu;

/**
 * A word with every mark removed (tones and vowel marks alike), `đ` as `d`, lower
 * case and no spaces: "Hậu Cần" and "hau can" both read "haucan". Only a first,
 * coarse look-up key; the exact check compares `compactWord`.
 */
export function normalizeWord(text: string): string {
  return text
    .normalize('NFD')
    .replace(MARKS, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'd')
    .toLowerCase()
    .replace(SPACES, '');
}

type SeedRow = { word: string; source: string; meaning: string };

function parseAssets(words: string, meanings: string): SeedRow[] {
  const known = new Map<string, { source: string; meaning: string }>();
  for (const line of meanings.split('\n')) {
    const [word, source, meaning] = line.split('\t');
    if (word === undefined || source === undefined || meaning === undefined) continue;
    if (!MEANING_SOURCES.has(source) || meaning.trim() === '') continue;
    known.set(word.normalize('NFC'), { source, meaning: meaning.trim() });
  }
  return words
    .split('\n')
    .map((line) => line.trim().normalize('NFC'))
    .flatMap((word) => {
      const entry = known.get(word);
      return entry === undefined ? [] : [{ word, ...entry }];
    });
}

/**
 * The Vietnamese words of the scramble, kept in Postgres with their meanings.
 * Only words a dictionary explains are kept: a listed word no dictionary
 * explains is neither a puzzle nor an accepted guess.
 *
 * The bundled list and meanings are loaded at boot, in the background, only when
 * they changed since the last load (their hash is kept in AppState). A load
 * never overwrites a meaning found later (an LLM's), and removes every row
 * left without a meaning.
 */
@Injectable()
export class VietWordsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VietWordsService.name);
  private seeding: Promise<void> | undefined;
  private count: number | undefined;

  /** One question per word at a time, however many players solve it at once. */
  private readonly explaining = new Map<string, Promise<string | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly appState: AppStateService,
    private readonly llm: LlmService,
  ) {}

  onApplicationBootstrap(): void {
    this.seed().catch(() => undefined);
  }

  /** Whatever its spacing, case or tone placement. */
  async isVietnameseWord(text: string): Promise<boolean> {
    return (await this.find(text)) !== null;
  }

  /**
   * The listed word `text` spells and its meaning, `null` meaning when none is
   * known (yet). `null` when `text` is not a listed word.
   */
  async find(text: string): Promise<{ word: string; meaning: string | null } | null> {
    const normalized = normalizeWord(text);
    if (normalized === '') return null;
    await this.seed();
    // First the coarse key, which an index answers; then the exact letters and
    // tones, which the few rows sharing that key are compared on.
    const rows = await this.prisma.vietWord.findMany({
      where: { normalized },
      select: { word: true, meaning: true },
      take: 50,
    });
    const compact = compactWord(text);
    return rows.find((row) => compactWord(row.word) === compact) ?? null;
  }

  /**
   * The meaning of `word` (as listed) for a word a player has just solved.
   * Every word the load keeps has one; a row stored without one (not by the
   * load) is put to the LLM, once: its answer, or that it has none, is stored
   * and reused from then on.
   * Nothing is stored when no LLM is set up or the call failed, so a later
   * solve may ask again. Never called in bulk: one solved word, one question.
   */
  async explain(word: string): Promise<string | null> {
    const row = await this.prisma.vietWord.findUnique({
      where: { word },
      select: { meaning: true, meaningSource: true },
    });
    if (row === null) return null;
    if (row.meaningSource !== null) return row.meaning;
    let pending = this.explaining.get(word);
    if (pending === undefined) {
      pending = this.askLlm(word).finally(() => this.explaining.delete(word));
      this.explaining.set(word, pending);
    }
    return pending;
  }

  private async askLlm(word: string): Promise<string | null> {
    // A question that finished just before this one began has stored its answer.
    const fresh = await this.prisma.vietWord.findUnique({
      where: { word },
      select: { meaning: true, meaningSource: true },
    });
    if (fresh?.meaningSource != null) return fresh.meaning;
    const meaning = await this.llm.explainVietnamese(word);
    if (meaning === undefined) return null;
    // Only a word still without a meaning: another process may have asked too.
    await this.prisma.vietWord.updateMany({
      where: { word, meaningSource: null },
      data:
        meaning === null
          ? { meaningSource: 'NONE', meaningAt: new Date() }
          : { meaning, meaningSource: 'LLM', meaningAt: new Date() },
    });
    return meaning;
  }

  async pickVietnamese(random: () => number = Math.random): Promise<string> {
    await this.seed();
    this.count ??= await this.prisma.vietWord.count();
    if (this.count === 0) throw new Error('The Vietnamese word list is empty');
    const row = await this.prisma.vietWord.findFirst({
      orderBy: { word: 'asc' },
      skip: Math.floor(random() * this.count),
      select: { word: true },
    });
    if (row === null) {
      // The table shrank since it was counted.
      this.count = undefined;
      return this.pickVietnamese(random);
    }
    return row.word;
  }

  /** One load shared by every caller. */
  private seed(): Promise<void> {
    this.seeding ??= this.load().catch(async (error: unknown) => {
      // A table loaded by an earlier boot still serves the game; the next
      // boot tries the load again. An empty one cannot, so the next call does.
      const loaded = await this.prisma.vietWord.count().catch(() => 0);
      this.logger.error(`Loading the Vietnamese words failed (${errorLabel(error)})`);
      if (loaded > 0) return;
      this.seeding = undefined;
      throw error;
    });
    return this.seeding;
  }

  private async load(): Promise<void> {
    const [words, meanings] = await Promise.all([
      readAsset(WORDS_ASSET),
      readAsset(MEANINGS_ASSET),
    ]);
    const hash = createHash('sha256')
      .update(SEED_VERSION)
      .update('\0')
      .update(words)
      .update('\0')
      .update(meanings)
      .digest('hex');
    if ((await this.appState.get(SEED_KEY)) === hash) return;

    const rows = parseAssets(words, meanings);
    for (let start = 0; start < rows.length; start += SEED_BATCH) {
      const batch = rows.slice(start, start + SEED_BATCH);
      // One statement per batch: new words are inserted, every word gets its
      // key computed again and takes the bundled meaning, unless the LLM's is
      // already there. A word the LLM had no meaning for (NONE) takes it too.
      await this.prisma.$executeRaw`
        INSERT INTO "VietWord" ("word", "normalized", "meaning", "meaningSource", "meaningAt")
        SELECT w, n, m, s::"MeaningSource", now()
        FROM unnest(
          ${batch.map((row) => row.word)}::text[],
          ${batch.map((row) => normalizeWord(row.word))}::text[],
          ${batch.map((row) => row.meaning)}::text[],
          ${batch.map((row) => row.source)}::text[]
        ) AS t(w, n, m, s)
        ON CONFLICT ("word") DO UPDATE SET
          "normalized" = EXCLUDED."normalized",
          "meaning" = CASE WHEN "VietWord"."meaningSource" = 'LLM'
            THEN "VietWord"."meaning" ELSE EXCLUDED."meaning" END,
          "meaningAt" = CASE WHEN "VietWord"."meaningSource" = 'LLM'
            THEN "VietWord"."meaningAt" ELSE EXCLUDED."meaningAt" END,
          "meaningSource" = CASE WHEN "VietWord"."meaningSource" = 'LLM'
            THEN "VietWord"."meaningSource" ELSE EXCLUDED."meaningSource" END`;
    }
    // Rows an earlier list left without a meaning, or the LLM found none for.
    await this.prisma.vietWord.deleteMany({
      where: { OR: [{ meaningSource: null }, { meaningSource: 'NONE' }] },
    });
    await this.appState.set(SEED_KEY, hash);
    this.count = undefined;
    this.logger.log(`Loaded ${rows.length} Vietnamese words`);
  }
}
