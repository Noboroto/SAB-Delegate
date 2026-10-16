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
