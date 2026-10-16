import { randomBytes } from 'node:crypto';
import { z } from '@sab/shared';
import { tool } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), makeSafeFetch: vi.fn() }));
vi.mock('./safe-fetch.js', () => ({ makeSafeFetch: mocks.makeSafeFetch }));

import { estimateTokens, LlmChatError, LlmChatService } from './llm-chat.service.js';
import { SafePostError } from './safe-request.js';

const target = { baseUrl: 'https://api.example.com/v1/', model: 'm-1', apiKey: 'sk-secret-key' };

function completion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c',
    object: 'chat.completion',
    created: 1,
    model: 'm-1',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    ...overrides,
  };
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const request: Parameters<LlmChatService['chat']>[1] = {
  system: 'be brief',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
      ],
    },
  ],
  maxOutputTokens: 50,
};

function sentBody(call = 0): Record<string, unknown> {
  const init = mocks.fetch.mock.calls[call]?.[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

let service: LlmChatService;

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.makeSafeFetch.mockReset();
  mocks.makeSafeFetch.mockReturnValue(mocks.fetch);
  service = new LlmChatService();
});

describe('LlmChatService.chat', () => {
  it('sends the messages in order with an image data URL and max_tokens, no temperature', async () => {
    mocks.fetch.mockResolvedValue(reply(200, completion()));
    await service.chat(target, request);

    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/chat/completions');
    const body = sentBody();
    expect(body.model).toBe('m-1');
    expect(body.max_tokens).toBe(50);
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
        ],
      },
    ]);
  });

  it('maps provider usage and the stop reason', async () => {
    mocks.fetch.mockResolvedValue(
      reply(
        200,
        completion({
          choices: [
            { index: 0, message: { role: 'assistant', content: 'x' }, finish_reason: 'length' },
          ],
        }),
      ),
    );
    const result = await service.chat(target, request);
    expect(result).toEqual({
      text: 'x',
      usage: { inputTokens: 11, outputTokens: 7, total: 18, estimated: false },
      cut: true,
      toolCalls: [],
    });
  });

  it('estimates usage when the provider omits it', async () => {
    mocks.fetch.mockResolvedValue(reply(200, completion({ usage: undefined })));
    const result = await service.chat(target, request);
    const chars = 'be brief'.length + 'hi'.length + 'hello'.length + 'look'.length;
    expect(result.usage).toEqual({
      inputTokens: estimateTokens(chars, 1),
      outputTokens: estimateTokens('hello'.length),
      total: estimateTokens(chars, 1) + estimateTokens('hello'.length),
      estimated: true,
    });
  });

  it('retries once with max_completion_tokens when max_tokens is refused, then remembers it', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        reply(400, { error: { message: "Unsupported parameter: 'max_tokens'" } }),
      )
      .mockImplementation(() => Promise.resolve(reply(200, completion())));

    await service.chat(target, request);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const retried = sentBody(1);
    expect(retried.max_completion_tokens).toBe(50);
    expect(retried).not.toHaveProperty('max_tokens');
    expect(retried).not.toHaveProperty('temperature');

    await service.chat(target, request);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(sentBody(2).max_completion_tokens).toBe(50);
  });

  it('does not retry a 400 that is not about max_tokens', async () => {
    mocks.fetch.mockResolvedValue(reply(400, { error: { message: 'bad model' } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('bad_response'));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('maps %i to unauthorized without keeping provider text', async (status) => {
    mocks.fetch.mockResolvedValue(
      reply(status, { error: { message: 'key sk-secret-key rejected' } }),
    );
    const error = await service.chat(target, request).catch((e: unknown) => e);
    expect(error).toEqual(new LlmChatError('unauthorized'));
    expect(String((error as Error).message)).not.toContain('sk-secret-key');
  });

  it.each([429, 500, 503])('maps %i to unreachable and does not retry', async (status) => {
    mocks.fetch.mockResolvedValue(reply(status, { error: { message: 'slow down' } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('unreachable'));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('maps 402 to provider_quota and does not retry', async () => {
    mocks.fetch.mockResolvedValue(reply(402, { error: { message: 'pay up' } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('provider_quota'));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    'insufficient_quota',
    'Billing hard limit reached',
    'You exceeded your current quota, please check your plan',
    'No CREDIT left',
  ])('maps a 429 whose body says "%s" to provider_quota', async (words) => {
    mocks.fetch.mockResolvedValue(reply(429, { error: { message: words } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('provider_quota'));
  });

  it.each([
    'Quota exceeded for metric generate_content_requests, limit: 15 per minute',
    'Rate limit reached for requests, billing is fine',
    'insufficient_quota but only 3 requests per second allowed',
    'slow down',
  ])('maps a 429 about a passing rate limit ("%s") to unreachable', async (words) => {
    mocks.fetch.mockResolvedValue(reply(429, { error: { message: words } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('unreachable'));
  });

  it.each([
    [429, 'exceeded_current_quota_error'],
    [400, 'Your credit balance is too low to access the Anthropic API'],
  ])('maps a %i saying "%s" to provider_quota', async (status, words) => {
    mocks.fetch.mockResolvedValue(reply(status, { error: { type: words, message: words } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('provider_quota'));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps any other 400 a bad response, even when it mentions credit elsewhere', async () => {
    mocks.fetch.mockResolvedValue(reply(400, { error: { message: 'invalid model name' } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('bad_response'));
    mocks.fetch.mockResolvedValue(reply(400, { error: { message: 'credit_card field unknown' } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('bad_response'));
  });

  it('keeps nothing of the provider body when it reports no credit', async () => {
    const distinctive = `body-${randomBytes(8).toString('hex')}`;
    mocks.fetch.mockResolvedValue(
      reply(429, { error: { code: 'insufficient_quota', distinctive } }),
    );
    const error = (await service.chat(target, request).catch((e: unknown) => e)) as Error;
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(distinctive);
  });

  it('does not read a 500 whose body mentions credit as an empty account', async () => {
    mocks.fetch.mockResolvedValue(reply(500, { error: { message: 'credit service down' } }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('unreachable'));
  });

  it('builds the transport with the call limits and no host allow-list', async () => {
    mocks.fetch.mockResolvedValue(reply(200, completion()));
    await service.chat(target, request);
    expect(mocks.makeSafeFetch).toHaveBeenCalledWith({ timeoutMs: 60_000, maxBytes: 1024 * 1024 });
  });

  it('does not loop when a remembered endpoint still answers 400 about max_tokens', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        reply(400, { error: { message: "Unsupported parameter: 'max_tokens'" } }),
      )
      .mockImplementationOnce(() => Promise.resolve(reply(200, completion())))
      .mockImplementation(() =>
        Promise.resolve(reply(400, { error: { message: "Unsupported parameter: 'max_tokens'" } })),
      );
    await service.chat(target, request);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);

    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('bad_response'));
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('asks another model or endpoint with max_tokens again', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        reply(400, { error: { message: "Unsupported parameter: 'max_tokens'" } }),
      )
      .mockImplementation(() => Promise.resolve(reply(200, completion())));
    await service.chat(target, request);

    await service.chat({ ...target, model: 'other' }, request);
    await service.chat({ ...target, baseUrl: 'https://other.example/v1' }, request);
    expect(sentBody(2).max_tokens).toBe(50);
    expect(sentBody(3).max_tokens).toBe(50);
  });

  it.each([
    ['input', { completion_tokens: 7 }, { inputTokens: 'est', outputTokens: 7 }],
    ['output', { prompt_tokens: 11 }, { inputTokens: 11, outputTokens: 'est' }],
  ])('estimates only the missing %s count', async (_name, usage, expected) => {
    mocks.fetch.mockResolvedValue(reply(200, completion({ usage })));
    const result = await service.chat(target, request);
    const chars = 'be brief'.length + 'hi'.length + 'hello'.length + 'look'.length;
    const inputTokens = expected.inputTokens === 'est' ? estimateTokens(chars, 1) : 11;
    const outputTokens = expected.outputTokens === 'est' ? estimateTokens('hello'.length) : 7;
    expect(result.usage).toEqual({
      inputTokens,
      outputTokens,
      total: inputTokens + outputTokens,
      estimated: true,
    });
  });

  it('sends no system message for an empty system prompt', async () => {
    mocks.fetch.mockResolvedValue(reply(200, completion()));
    await service.chat(target, { ...request, system: '' });
    const messages = sentBody().messages as { role: string }[];
    expect(messages.some((message) => message.role === 'system')).toBe(false);
  });

  it('keeps the transport reason', async () => {
    mocks.fetch.mockRejectedValue(new SafePostError('blocked'));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('blocked'));
    mocks.fetch.mockRejectedValue(new SafePostError('too_large'));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('bad_response'));
  });

  it('maps an abort to unreachable', async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException('aborted', 'AbortError'));
          // The SDK may reach fetch before or after the caller aborts.
          if (init.signal.aborted) abort();
          else init.signal.addEventListener('abort', abort);
        }),
    );
    const pending = service.chat(target, { ...request, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toEqual(new LlmChatError('unreachable'));
  });

  it('rejects an answer that is not a chat completion', async () => {
    mocks.fetch.mockResolvedValue(reply(200, { nope: true }));
    await expect(service.chat(target, request)).rejects.toEqual(new LlmChatError('bad_response'));
  });
});

function toolCall(
  id: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = {
    prompt_tokens: 10,
    completion_tokens: 2,
    total_tokens: 12,
  },
) {
  return completion({
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id, type: 'function', function: { name: 'lookup', arguments: '{"q":"abc"}' } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: usage ?? undefined,
  });
}

describe('LlmChatService.chat with tools', () => {
  const execute = vi.fn((_input: { q: string }) => ({ found: 'yes' }));
  const tools = {
    lookup: tool({ description: 'look', inputSchema: z.object({ q: z.string() }), execute }),
  };

  beforeEach(() => {
    execute.mockClear();
  });

  it('runs the tool, sums the usage of every step and reports the calls', async () => {
    mocks.fetch
      .mockResolvedValueOnce(reply(200, toolCall('call_1')))
      .mockResolvedValueOnce(
        reply(
          200,
          completion({ usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 } }),
        ),
      );
    const result = await service.chat(target, { ...request, tools, maxSteps: 3 });

    expect(execute).toHaveBeenCalledWith({ q: 'abc' }, expect.anything());
    expect(result.text).toBe('hello');
    expect(result.usage).toEqual({
      inputTokens: 40,
      outputTokens: 7,
      total: 47,
      estimated: false,
    });
    expect(result.toolCalls).toEqual([
      { name: 'lookup', args: '{"q":"abc"}', resultBytes: JSON.stringify({ found: 'yes' }).length },
    ]);
    expect(sentBody(0).tools).toHaveLength(1);
    const second = sentBody(1).messages as { role: string }[];
    expect(second.at(-1)?.role).toBe('tool');
  });

  it('forbids a tool on the last step, so a model that keeps calling still ends in text', async () => {
    mocks.fetch
      .mockResolvedValueOnce(reply(200, toolCall('call_1')))
      .mockResolvedValueOnce(reply(200, completion()));
    await service.chat(target, { ...request, tools, maxSteps: 2 });
    expect(sentBody(0).tool_choice).toBe('auto');
    expect(sentBody(1).tool_choice).toBe('none');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('counts the whole chat as estimated when one step reported no usage', async () => {
    mocks.fetch
      .mockResolvedValueOnce(reply(200, toolCall('call_1', null)))
      .mockResolvedValueOnce(reply(200, completion()));
    const result = await service.chat(target, { ...request, tools, maxSteps: 3 });
    expect(result.usage.estimated).toBe(true);
    expect(result.usage.total).toBeGreaterThan(0);
  });

  it('retries once without tools when the endpoint refuses them, and remembers it', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        reply(400, { error: { message: "Unknown parameter: 'tools' is not supported" } }),
      )
      .mockImplementation(() => Promise.resolve(reply(200, completion())));

    await service.chat(target, { ...request, tools, maxSteps: 3 });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(sentBody(0)).toHaveProperty('tools');
    expect(sentBody(1)).not.toHaveProperty('tools');

    await service.chat(target, { ...request, tools, maxSteps: 3 });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(sentBody(2)).not.toHaveProperty('tools');
  });

  it('does not take a 400 about something else for a tools refusal', async () => {
    mocks.fetch.mockResolvedValue(reply(400, { error: { message: 'bad model' } }));
    await expect(service.chat(target, { ...request, tools, maxSteps: 3 })).rejects.toEqual(
      new LlmChatError('bad_response'),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not remember a refusal when the retry without tools fails too', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        reply(400, { error: { message: "Unknown parameter: 'tools' is not supported" } }),
      )
      .mockResolvedValueOnce(reply(401, { error: { message: 'bad key' } }))
      .mockImplementation(() => Promise.resolve(reply(200, completion())));

    await expect(service.chat(target, { ...request, tools, maxSteps: 3 })).rejects.toEqual(
      new LlmChatError('unauthorized'),
    );
    await service.chat(target, { ...request, tools, maxSteps: 3 });
    expect(sentBody(2)).toHaveProperty('tools');
  });

  it('keeps tools on after an unrelated 400 that mentions a function', async () => {
    mocks.fetch.mockResolvedValueOnce(
      reply(400, { error: { message: 'invalid value in function body of the prompt' } }),
    );
    await expect(service.chat(target, { ...request, tools, maxSteps: 3 })).rejects.toEqual(
      new LlmChatError('bad_response'),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends no tools when none are given', async () => {
    mocks.fetch.mockResolvedValue(reply(200, completion()));
    const result = await service.chat(target, request);
    expect(sentBody()).not.toHaveProperty('tools');
    expect(result.toolCalls).toEqual([]);
  });
});

describe('LlmChatService.ping', () => {
  it('asks for five tokens', async () => {
    mocks.fetch.mockResolvedValue(reply(200, completion()));
    await service.ping(target);
    expect(sentBody().max_tokens).toBe(5);
    expect((sentBody().messages as { role: string }[]).map((m) => m.role)).toEqual(['user']);
  });
});

describe('estimateTokens', () => {
  it('is chars/2.5 rounded up plus 1000 per image', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(6)).toBe(3);
    expect(estimateTokens(5, 2)).toBe(2002);
  });
});
