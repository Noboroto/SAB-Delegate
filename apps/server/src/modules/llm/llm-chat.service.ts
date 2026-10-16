import { Injectable } from '@nestjs/common';
import type { LlmTestResult } from '@sab/shared';
import { APICallError, generateText, isStepCount, type ModelMessage, type ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LRUCache } from 'lru-cache';
import type { LlmTarget } from './llm.service.js';
import { makeSafeFetch } from './safe-fetch.js';
import { SafePostError } from './safe-request.js';

const CALL_TIMEOUT_MS = 60_000;
/** A model may gain tool support; the remembered refusal lapses so it is asked again. */
const TOOLS_REFUSED_TTL_MS = 60 * 60_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CHARS_PER_TOKEN = 2.5;
/** A picture costs the model far more than its few base64 characters suggest. */
const TOKENS_PER_IMAGE = 1000;
const PING_PROMPT = 'Trả lời đúng một từ: OK';

type ChatPart =
  { type: 'text'; text: string } | { type: 'image'; data: Uint8Array; mediaType: string };

type ChatMessage = { role: 'user' | 'assistant'; content: ChatPart[] };

type ChatRequest = {
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Without tools the call is a single completion. */
  tools?: ToolSet;
  /** Most model calls one chat may make while tools are in play. */
  maxSteps?: number;
};

/** One tool the model called: the arguments as sent and the size of what came back. */
type ToolCallRecord = { name: string; args: string; resultBytes: number };

type ChatResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number; total: number; estimated: boolean };
  /** The model stopped because it ran out of output tokens, not because it was done. */
  cut: boolean;
  /** Every tool call of the chat, in order; empty when none was made or offered. */
  toolCalls: ToolCallRecord[];
};

export type ChatFailureReason = NonNullable<LlmTestResult['reason']>;

/** Why a chat call failed; the provider's own text is never kept. */
export class LlmChatError extends Error {
  constructor(readonly reason: ChatFailureReason) {
    super(`Chat call failed: ${reason}`);
    this.name = 'LlmChatError';
  }
}

/** Token estimate for text the provider did not count (quota heuristic). */
export function estimateTokens(chars: number, images = 0): number {
  return Math.ceil(chars / CHARS_PER_TOKEN) + images * TOKENS_PER_IMAGE;
}

/** What providers put in a 429 body when the account, not the request rate, is the problem. */
const OUT_OF_CREDIT_WORDS =
  /insufficient_quota|billing|credit|payment|exceeded your current quota|exceeded_current_quota|out of credits/iu;
/** Anthropic-compatible APIs answer an empty balance with a 400, so a 400 needs this exact wording. */
const EMPTY_BALANCE_WORDS = /credit balance is too low/iu;
/** A per-minute or per-day quota is a rate limit: it lifts by itself within moments. */
const RATE_LIMIT_WORDS = /per[_ ]?(?:minute|second|hour|day)|rate[_ ]?limit|requests? per/iu;

/**
 * Whether a refusal means the account ran out of credit rather than a passing
 * overload. The body is only read to decide; neither it nor any part of it is
 * kept or logged.
 */
export function isOutOfCredit(status: number | undefined, body: string | undefined): boolean {
  if (status === 402) return true;
  if (body === undefined || RATE_LIMIT_WORDS.test(body)) return false;
  if (status === 400) return EMPTY_BALANCE_WORDS.test(body);
  return status === 429 && OUT_OF_CREDIT_WORDS.test(body);
}

function failureOf(error: unknown): LlmChatError {
  if (error instanceof LlmChatError) return error;
  if (error instanceof SafePostError) {
    return new LlmChatError(error.reason === 'too_large' ? 'bad_response' : error.reason);
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (isOutOfCredit(status, error.responseBody)) return new LlmChatError('provider_quota');
    if (status === 401 || status === 403) return new LlmChatError('unauthorized');
    // Rate limits and provider outages pass; asking again later may work.
    if (status === 429 || (status !== undefined && status >= 500)) {
      return new LlmChatError('unreachable');
    }
    return new LlmChatError('bad_response');
  }
  // Aborts, network faults and malformed answers all surface here; only a
  // failure to reach the endpoint is worth retrying later.
  return new LlmChatError(
    error instanceof Error && error.name.startsWith('AI_') ? 'bad_response' : 'unreachable',
  );
}

/**
 * A 400 that says the endpoint cannot take tool definitions. Only phrasings of
 * that refusal: a bare "function" or "tool" also appears in unrelated 400s.
 */
const TOOLS_REFUSED_WORDS =
  /(?:does not|doesn't|do not|don't) support (?:\w+ )?(?:tools?|function[_ ]call)|tools?['"]? (?:are|is) not supported|unsupported[^.\n]{0,40}\btools?\b|function[_ ]calling is not|tool_choice/iu;

function refusesTools(error: unknown): boolean {
  return (
    APICallError.isInstance(error) &&
    error.statusCode === 400 &&
    TOOLS_REFUSED_WORDS.test(error.responseBody ?? '')
  );
}

const ARGS_MAX_CHARS = 400;

function argsText(input: unknown): string {
  const text = JSON.stringify(input ?? {}) ?? '{}';
  return text.length <= ARGS_MAX_CHARS ? text : `${text.slice(0, ARGS_MAX_CHARS - 1)}…`;
}

function toModelMessage(message: ChatMessage): ModelMessage {
  if (message.role === 'assistant') {
    const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    return { role: 'assistant', content: text };
  }
  return {
    role: 'user',
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text }
        : { type: 'file' as const, data: part.data, mediaType: part.mediaType },
    ),
  };
}

function sizeOf(messages: ChatMessage[], system: string) {
  let chars = system.length;
  let images = 0;
  for (const { content } of messages) {
    for (const part of content) {
      if (part.type === 'text') chars += part.text.length;
      else images += 1;
    }
  }
  return { chars, images };
}

/**
 * Multi-message, multimodal chat completions against the configured
 * OpenAI-compatible endpoint, through the SSRF-safe transport. Never retries on
 * its own (a retry is a second bill); the caller decides.
 */
@Injectable()
export class LlmChatService {
  /** Endpoints (`baseUrl` + model) that refused `max_tokens`: asked the other way from the start. */
  private readonly completionTokenParam = new LRUCache<string, true>({ max: 100 });
  /** Endpoints (`baseUrl` + model) that refused tool definitions: asked without them from the start. */
  private readonly toolsRefused = new LRUCache<string, true>({
    max: 100,
    ttl: TOOLS_REFUSED_TTL_MS,
  });

  async chat(target: LlmTarget, request: ChatRequest): Promise<ChatResult> {
    const key = `${target.baseUrl}\n${target.model}`;
    const messages = request.messages.map(toModelMessage);
    const offered = request.tools !== undefined && Object.keys(request.tools).length > 0;
    const steps = request.maxSteps ?? 1;
    const run = async (completionTokens: boolean, withTools: boolean) => {
      const provider = createOpenAICompatible({
        name: 'chat',
        baseURL: target.baseUrl.replace(/\/+$/u, ''),
        apiKey: target.apiKey,
        fetch: makeSafeFetch({ timeoutMs: CALL_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES }),
        // Newer OpenAI models refuse `max_tokens`; the parameter every
        // compatible API agrees on for them is `max_completion_tokens`.
        ...(completionTokens
          ? {
              transformRequestBody: ({ max_tokens, ...rest }: Record<string, unknown>) => ({
                ...rest,
                max_completion_tokens: max_tokens,
              }),
            }
          : {}),
      });
      return generateText({
        model: provider.chatModel(target.model),
        ...(request.system === '' ? {} : { instructions: request.system }),
        messages,
        maxOutputTokens: request.maxOutputTokens,
        abortSignal: request.signal,
        maxRetries: 0,
        ...(withTools && request.tools !== undefined
          ? {
              tools: request.tools,
              stopWhen: isStepCount(steps),
              // The last step may not call a tool, so the chat always ends in text.
              prepareStep: ({ stepNumber }: { stepNumber: number }) =>
                stepNumber >= steps - 1 ? { toolChoice: 'none' as const } : undefined,
            }
          : {}),
      });
    };
    const withTokenParam = async (withTools: boolean) => {
      try {
        return await run(this.completionTokenParam.has(key), withTools);
      } catch (error) {
        if (
          this.completionTokenParam.has(key) ||
          !APICallError.isInstance(error) ||
          error.statusCode !== 400 ||
          !(error.responseBody ?? '').includes('max_tokens')
        ) {
          throw error;
        }
        const retried = await run(true, withTools);
        this.completionTokenParam.set(key, true);
        return retried;
      }
    };

    let result: Awaited<ReturnType<typeof run>>;
    try {
      const useTools = offered && !this.toolsRefused.has(key);
      try {
        result = await withTokenParam(useTools);
      } catch (error) {
        // One retry, without tools. The refusal is remembered only once the
        // retry works: a 400 the tools did not cause must not switch them off.
        if (!useTools || !refusesTools(error)) throw error;
        result = await withTokenParam(false);
        this.toolsRefused.set(key, true);
      }
    } catch (error) {
      throw failureOf(error);
    }

    const { chars, images } = sizeOf(request.messages, request.system);
    // `usage` already sums every step. The SDK reports a count the provider
    // left out as 0, not undefined, so 0 is read as missing: a prompt is never
    // empty, and an answer with text cost output tokens. One step without a
    // count makes the whole figure an estimate.
    const given = result.usage.inputTokens;
    const produced = result.usage.outputTokens;
    const stepsCounted = result.steps.every((step) => (step.usage.inputTokens ?? 0) > 0);
    const inputKnown = given !== undefined && given > 0 && stepsCounted;
    const outputKnown = produced !== undefined && (produced > 0 || result.text === '');
    const counted = inputKnown && outputKnown;
    const toolChars = result.steps.reduce(
      (sum, step) =>
        sum + step.toolResults.reduce((n, r) => n + JSON.stringify(r.output).length, 0),
      0,
    );
    const inputTokens = inputKnown
      ? given
      : estimateTokens(chars, images) * result.steps.length + estimateTokens(toolChars);
    const outputTokens = outputKnown ? produced : estimateTokens(result.text.length);
    const resultBytes = new Map(
      result.steps.flatMap((step) =>
        step.toolResults.map((r) => [r.toolCallId, Buffer.byteLength(JSON.stringify(r.output))]),
      ),
    );
    return {
      text: result.text,
      usage: {
        inputTokens,
        outputTokens,
        total: counted
          ? (result.usage.totalTokens ?? inputTokens + outputTokens)
          : inputTokens + outputTokens,
        estimated: !counted,
      },
      cut: result.finishReason === 'length',
      toolCalls: result.steps.flatMap((step) =>
        step.toolCalls.map((call) => ({
          name: call.toolName,
          args: argsText(call.input),
          resultBytes: resultBytes.get(call.toolCallId) ?? 0,
        })),
      ),
    };
  }

  /** A five-token completion: proves the endpoint, model and key work. Throws `LlmChatError`. */
  async ping(target: LlmTarget): Promise<void> {
    await this.chat(target, {
      system: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: PING_PROMPT }] }],
      maxOutputTokens: 5,
    });
  }
}
