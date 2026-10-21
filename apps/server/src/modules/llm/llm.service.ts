import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  LlmModelsRequestSchema,
  LlmSettingsInputSchema,
  z,
  type ActorContext,
  type LlmModelsResult,
  type LlmSettings,
  type LlmTestResult,
} from '@sab/shared';
import pLimit from 'p-limit';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ChatbotPauseService, pauseKeyOf } from './chatbot-pause.service.js';
import { isOutOfCredit } from './llm-chat.service.js';
import { SafePostError, safePostJson } from './safe-post.js';
import { safeRequest } from './safe-request.js';
import { decryptSecret, encryptSecret } from './secret-box.js';

/** The two settings the module reads from the environment (see `LlmModule`). */
export const LLM_ENV = Symbol('LLM_ENV');
type LlmEnv = { secret: string | undefined; adminGuildId: string };

const CALL_TIMEOUT_MS = 15_000;
/** A meaning is a sentence or two; this also caps what a call can cost. */
const MAX_OUTPUT_TOKENS = 160;
const MEANING_MAX_LENGTH = 400;
/** How the model says it does not know the word, as the prompt asks. */
const NO_MEANING = 'NONE';
/** After a failed call, no question for this long: a dead endpoint is not hammered. */
const COOLDOWN_MS = 10 * 60_000;
/** A meaning with a link is not kept: it would show to every server, forever. */
const LINK = /https?:\/\/|discord\.gg|www\./iu;

/** A model list is a few KB on most providers; the cap bounds what a hostile endpoint can make us read. */
const MODELS_MAX_BYTES = 2 * 1024 * 1024;
const MODELS_MAX_COUNT = 1000;
const MODEL_ID_MAX_LENGTH = 200;

const ModelListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/** The key and address a server saved earlier; either may be missing. */
type StoredLlmKey = { baseUrl: string | null; apiKeyEnc: string | null };

const CompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

/** Everything a call to the endpoint needs; the key is the decrypted secret. */
const LlmTargetSchema = z.object({ baseUrl: z.string(), model: z.string(), apiKey: z.string() });
export type LlmTarget = z.infer<typeof LlmTargetSchema>;

function completionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/chat/completions`;
}

/**
 * The one LLM the bot may ask, as a last resort, what a Vietnamese word means:
 * only for a word a player has just solved and no dictionary explains, and once
 * per word (the caller stores the answer). Any OpenAI-compatible
 * chat-completions API (OpenAI, Anthropic, Gemini, OpenRouter, …), so no
 * provider SDK is needed for one POST.
 *
 * The API key is stored encrypted with LLM_KEY_SECRET and never returned; a
 * stored key is only ever sent to the base URL it was saved with.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  /** One question at a time, whatever happens in the game: never a burst. */
  private readonly calls = pLimit(1);
  private pausedUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_ENV) private readonly env: LlmEnv,
    private readonly pause: ChatbotPauseService,
  ) {}

  /** The admin guild's id: the only server whose managers configure the LLM. */
  get adminGuildId(): string {
    return this.env.adminGuildId;
  }

  /** The settings as the given server's managers may see them. */
  async settings(guildId: string = this.env.adminGuildId): Promise<LlmSettings> {
    if (guildId !== this.env.adminGuildId) {
      return {
        adminServer: false,
        available: false,
        enabled: false,
        baseUrl: null,
        model: null,
        keyLast4: null,
      };
    }
    const row = await this.row();
    return {
      adminServer: true,
      available: this.env.secret !== undefined,
      enabled: row?.enabled ?? false,
      baseUrl: row?.baseUrl ?? null,
      model: row?.model ?? null,
      // A key the current secret cannot read is no key: the form asks for it again.
      keyLast4: row !== null && this.readKey(row.apiKeyEnc) !== null ? row.keyLast4 : null,
    };
  }

  async save(input: unknown, actor: ActorContext): Promise<LlmSettings> {
    const secret = this.requireSecret();
    const parsed = LlmSettingsInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { baseUrl, model, enabled, apiKey } = parsed.data;
    const current = await this.row();
    if (
      apiKey === undefined &&
      (current === null ||
        current.baseUrl !== baseUrl ||
        decryptSecret(current.apiKeyEnc, secret) === null)
    ) {
      throw new ServiceError(ErrorCode.LLM_KEY_REQUIRED);
    }
    const key =
      apiKey === undefined
        ? { apiKeyEnc: current?.apiKeyEnc ?? '', keyLast4: current?.keyLast4 ?? '' }
        : { apiKeyEnc: encryptSecret(apiKey, secret), keyLast4: apiKey.slice(-4) };

    // New settings deserve a new try, whatever the old ones did.
    this.pausedUntil = 0;
    this.pause.clearGlobal();
    await this.prisma.$transaction(async (tx) => {
      await tx.llmConfig.upsert({
        where: { singleton: true },
        create: { baseUrl, model, enabled, ...key },
        update: { baseUrl, model, enabled, ...key },
      });
      await this.audit.record(
        {
          guildId: this.env.adminGuildId,
          actor,
          action: AUDIT_ACTIONS.llmConfigure,
          params: {
            host: new URL(baseUrl).host,
            model,
            enabled,
            keyChanged: apiKey !== undefined,
          },
        },
        tx,
      );
    });
    return this.settings();
  }

  /** One short completion with the given settings, saved or not. */
  async test(input: unknown): Promise<LlmTestResult> {
    const parsed = LlmSettingsInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { baseUrl, model, apiKey } = parsed.data;
    const key = await this.resolveKey(baseUrl, apiKey, () => this.row());
    try {
      await this.complete({ baseUrl, model, apiKey: key }, 'Trả lời đúng một từ: OK', 5);
      // A working endpoint ends an outage the admin has just fixed (a top-up, a new plan).
      this.pause.clear(pauseKeyOf(null, baseUrl, model, key.slice(-4)));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: failureReason(error) };
    }
  }

  /**
   * The model ids the endpoint serves, with the given key or, without one, the
   * stored key of `loadStored` (only for the address it was saved for).
   */
  async listModels(
    input: unknown,
    loadStored: () => Promise<StoredLlmKey | null>,
  ): Promise<LlmModelsResult> {
    const parsed = LlmModelsRequestSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { baseUrl, apiKey } = parsed.data;
    const key = await this.resolveKey(baseUrl, apiKey, loadStored);
    try {
      const response = await safeRequest({
        url: `${baseUrl.replace(/\/+$/u, '')}/models`,
        method: 'GET',
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        timeoutMs: CALL_TIMEOUT_MS,
        maxBytes: MODELS_MAX_BYTES,
      });
      return { ok: true, models: modelIds(response.status, response.body) };
    } catch (error) {
      return { ok: false, reason: failureReason(error) };
    }
  }

  /** {@link listModels} for the shared LLM: the stored key is the saved global one. */
  listGlobalModels(input: unknown): Promise<LlmModelsResult> {
    return this.listModels(input, () => this.row());
  }

  /**
   * The key to call `baseUrl` with: the one given, else the stored one, which
   * only ever goes to the address it was saved for.
   */
  private async resolveKey(
    baseUrl: string,
    apiKey: string | undefined,
    loadStored: () => Promise<StoredLlmKey | null>,
  ): Promise<string> {
    if (apiKey !== undefined) return apiKey;
    this.requireSecret();
    const stored = await loadStored();
    if (stored === null || stored.baseUrl !== baseUrl || stored.apiKeyEnc === null) {
      throw new ServiceError(ErrorCode.LLM_KEY_REQUIRED);
    }
    const key = this.readKey(stored.apiKeyEnc);
    if (key === null) throw new ServiceError(ErrorCode.LLM_KEY_REQUIRED);
    return key;
  }

  /**
   * The meaning of `word` in one or two Vietnamese sentences; `null` when the
   * model says it does not know the word; `undefined` when no LLM is set up or
   * the call failed, so nothing is to be stored and a later solve may ask again.
   */
  async explainVietnamese(word: string): Promise<string | null | undefined> {
    if (Date.now() < this.pausedUntil) return undefined;
    const target = await this.globalTarget();
    if (target === null) return undefined;
    const prompt =
      `Giải nghĩa từ tiếng Việt "${word}" như một từ điển: một hoặc hai câu, ` +
      `dưới ${MEANING_MAX_LENGTH} ký tự, không nhắc lại từ đó, không định dạng. ` +
      `Nếu không chắc đây là một từ có nghĩa trong tiếng Việt, chỉ trả lời ${NO_MEANING}.`;
    try {
      const { text, cut } = await this.calls(() =>
        this.complete(target, prompt, MAX_OUTPUT_TOKENS),
      );
      const meaning = text.trim().replace(/\s+/gu, ' ');
      // Only the model's own "none" is stored as such. An empty or cut-off
      // answer (a reasoning model spending its tokens elsewhere) says nothing
      // about the word and is not kept.
      if (meaning.toUpperCase() === NO_MEANING) return null;
      if (meaning === '' || cut || LINK.test(meaning)) return undefined;
      return meaning.slice(0, MEANING_MAX_LENGTH);
    } catch (error) {
      this.pausedUntil = Date.now() + COOLDOWN_MS;
      this.logger.warn(
        `Asking the LLM for a meaning failed (${failureReason(error)}); paused for ${COOLDOWN_MS / 60_000} min`,
      );
      return undefined;
    }
  }

  private async complete(
    target: LlmTarget,
    prompt: string,
    maxTokens: number,
  ): Promise<{ text: string; cut: boolean }> {
    const messages = [{ role: 'user', content: prompt }];
    let response = await this.post(target, {
      model: target.model,
      messages,
      max_tokens: maxTokens,
      temperature: 0,
    });
    // Newer OpenAI models refuse `max_tokens` and `temperature`; the one
    // parameter every OpenAI-compatible API agrees on for them is this.
    if (response.status === 400) {
      response = await this.post(target, {
        model: target.model,
        messages,
        max_completion_tokens: maxTokens,
      });
    }
    if (response.status === 401 || response.status === 403) throw new LlmUnauthorized();
    if (isOutOfCredit(response.status, JSON.stringify(response.body ?? ''))) {
      throw new LlmOutOfCredit();
    }
    const parsed = CompletionSchema.safeParse(response.body);
    if (response.status !== 200 || !parsed.success) throw new SafePostError('bad_response');
    const choice = parsed.data.choices[0];
    return { text: choice?.message.content ?? '', cut: choice?.finish_reason === 'length' };
  }

  private post(target: LlmTarget, payload: Record<string, unknown>) {
    return safePostJson(
      completionsUrl(target.baseUrl),
      { authorization: `Bearer ${target.apiKey}` },
      payload,
      CALL_TIMEOUT_MS,
    );
  }

  /** The saved settings ready to call, or `null` when switched off or unusable. */
  async globalTarget(): Promise<LlmTarget | null> {
    if (this.env.secret === undefined) return null;
    const row = await this.row();
    if (row === null || !row.enabled) return null;
    const apiKey = this.readKey(row.apiKeyEnc);
    if (apiKey === null) {
      this.logger.warn('The stored LLM API key cannot be read with LLM_KEY_SECRET; enter it again');
      return null;
    }
    return LlmTargetSchema.parse({ baseUrl: row.baseUrl, model: row.model, apiKey });
  }

  private row() {
    // `findFirst`: batched findUnique calls on a Boolean unique field fail (see SmtpConfigService.row).
    return this.prisma.llmConfig.findFirst({
      where: { singleton: true },
      select: { baseUrl: true, model: true, apiKeyEnc: true, keyLast4: true, enabled: true },
    });
  }

  /** Encrypts an API key for storage; throws when no secret is configured. */
  sealKey(plain: string): string {
    return encryptSecret(plain, this.requireSecret());
  }

  /** Throws `LLM_NOT_AVAILABLE` when the server has no secret to seal keys with. */
  assertSecretAvailable(): void {
    this.requireSecret();
  }

  /** The key behind a `sealKey` value, or `null` when the current secret cannot read it. */
  openKey(stored: string): string | null {
    return this.readKey(stored);
  }

  private readKey(stored: string): string | null {
    return this.env.secret === undefined ? null : decryptSecret(stored, this.env.secret);
  }

  private requireSecret(): string {
    if (this.env.secret === undefined) throw new ServiceError(ErrorCode.LLM_NOT_AVAILABLE);
    return this.env.secret;
  }
}

/** Ids of a `/models` answer, or the failure it is; the provider's text is read, never kept. */
function modelIds(status: number, body: Buffer): string[] {
  if (status === 401 || status === 403) throw new LlmUnauthorized();
  if (isOutOfCredit(status, body.toString('utf8'))) throw new LlmOutOfCredit();
  // A rate limit or an outage passes; any other refusal means this is not a model list.
  if (status === 429 || status >= 500) throw new SafePostError('unreachable');
  if (status !== 200) throw new SafePostError('bad_response');
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch {
    throw new SafePostError('bad_response');
  }
  const list = ModelListSchema.safeParse(json);
  if (!list.success) throw new SafePostError('bad_response');
  const ids = new Set<string>();
  for (const { id } of list.data.data) {
    const trimmed = id.trim();
    if (trimmed !== '' && trimmed.length <= MODEL_ID_MAX_LENGTH) ids.add(trimmed);
  }
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MODELS_MAX_COUNT);
}

class LlmUnauthorized extends Error {}
class LlmOutOfCredit extends Error {}

function failureReason(error: unknown): NonNullable<LlmTestResult['reason']> {
  if (error instanceof LlmUnauthorized) return 'unauthorized';
  if (error instanceof LlmOutOfCredit) return 'provider_quota';
  if (error instanceof SafePostError) {
    return error.reason === 'too_large' ? 'bad_response' : error.reason;
  }
  return 'unreachable';
}
