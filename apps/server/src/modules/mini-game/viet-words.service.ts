import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppStateService } from '../../app-state/app-state.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { readAsset } from '../word-game/dictionary.service.js';
import { compactWord } from './vietnamese.js';

const WORDS_ASSET = 'viet-words.txt';
const MEANINGS_ASSET = 'viet-meanings.tsv';
const SEED_KEY = 'viet-words:asset-hash';
/**
 * Part of the seed hash: raise it whenever `normalizeWord` changes, so the
 * stored keys are computed again even though the assets did not change.
 */
const NORMALIZE_VERSION = '1';
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

type SeedRow = { word: string; source: string | null; meaning: string | null };

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
    .filter((word) => word !== '')
    .map((word) => {
      const entry = known.get(word);
      return { word, source: entry?.source ?? null, meaning: entry?.meaning ?? null };
    });
}

/**
 * The Vietnamese words of the scramble, kept in Postgres with their meanings.
 *
 * The bundled list and meanings are loaded at boot, in the background, only when
 * they changed since the last load (their hash is kept in AppState). A load
 * never overwrites a meaning found later (an LLM's, or a confirmed absence):
 * only rows without one take the bundled meaning.
 */
@Injectable()
export class VietWordsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VietWordsService.name);
  private seeding: Promise<void> | undefined;
  private count: number | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly appState: AppStateService,
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
      .update(NORMALIZE_VERSION)
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
      // key computed again, and a word without a meaning yet takes the bundled
      // one. A meaning already there (LLM, NONE) is kept.
      await this.prisma.$executeRaw`
        INSERT INTO "VietWord" ("word", "normalized", "meaning", "meaningSource", "meaningAt")
        SELECT w, n, m, s::"MeaningSource", CASE WHEN s IS NULL THEN NULL ELSE now() END
        FROM unnest(
          ${batch.map((row) => row.word)}::text[],
          ${batch.map((row) => normalizeWord(row.word))}::text[],
          ${batch.map((row) => row.meaning)}::text[],
          ${batch.map((row) => row.source)}::text[]
        ) AS t(w, n, m, s)
        ON CONFLICT ("word") DO UPDATE SET
          "normalized" = EXCLUDED."normalized",
          "meaning" = CASE WHEN "VietWord"."meaningSource" IS NULL
            THEN EXCLUDED."meaning" ELSE "VietWord"."meaning" END,
          "meaningAt" = CASE WHEN "VietWord"."meaningSource" IS NULL
            THEN EXCLUDED."meaningAt" ELSE "VietWord"."meaningAt" END,
          "meaningSource" = COALESCE("VietWord"."meaningSource", EXCLUDED."meaningSource")`;
    }
    await this.appState.set(SEED_KEY, hash);
    this.count = undefined;
    this.logger.log(`Loaded ${rows.length} Vietnamese words`);
  }
}
