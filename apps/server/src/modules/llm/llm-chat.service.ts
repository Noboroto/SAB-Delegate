import { Injectable } from '@nestjs/common';
import type { LlmTestResult } from '@sab/shared';
import { APICallError, generateText, type ModelMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LRUCache } from 'lru-cache';
import type { LlmTarget } from './llm.service.js';
import { makeSafeFetch } from './safe-fetch.js';
import { SafePostError } from './safe-request.js';

const CALL_TIMEOUT_MS = 60_000;
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
};

type ChatResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number; total: number; estimated: boolean };
  /** The model stopped because it ran out of output tokens, not because it was done. */
  cut: boolean;
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

function failureOf(error: unknown): LlmChatError {
  if (error instanceof LlmChatError) return error;
  if (error instanceof SafePostError) {
    return new LlmChatError(error.reason === 'too_large' ? 'bad_response' : error.reason);
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
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

  async chat(target: LlmTarget, request: ChatRequest): Promise<ChatResult> {
    const key = `${target.baseUrl}\n${target.model}`;
    const messages = request.messages.map(toModelMessage);
    const run = async (completionTokens: boolean) => {
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
      });
    };

    let result: Awaited<ReturnType<typeof run>>;
    try {
      try {
        result = await run(this.completionTokenParam.has(key));
      } catch (error) {
        if (
          this.completionTokenParam.has(key) ||
          !APICallError.isInstance(error) ||
          error.statusCode !== 400 ||
          !(error.responseBody ?? '').includes('max_tokens')
        ) {
          throw error;
        }
        result = await run(true);
        this.completionTokenParam.set(key, true);
      }
    } catch (error) {
      throw failureOf(error);
    }

    const { chars, images } = sizeOf(request.messages, request.system);
    // The SDK reports a count the provider left out as 0, not undefined, so
    // 0 is read as missing: a prompt is never empty, and an answer with text
    // cost output tokens.
    const given = result.usage.inputTokens;
    const produced = result.usage.outputTokens;
    const inputKnown = given !== undefined && given > 0;
    const outputKnown = produced !== undefined && (produced > 0 || result.text === '');
    const counted = inputKnown && outputKnown;
    const inputTokens = inputKnown ? given : estimateTokens(chars, images);
    const outputTokens = outputKnown ? produced : estimateTokens(result.text.length);
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
