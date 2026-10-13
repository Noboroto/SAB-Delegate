import 'reflect-metadata';
import { ErrorCode, MESSAGE_MAX_LENGTH, z } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import { StandardSchemaOptionsPipe } from '../pipes/standard-schema-options.pipe.js';
import {
  AUTOCOMPLETE_MAX_CHOICES,
  withAutocompleteBudget,
  type AutocompleteInteraction,
} from './autocomplete-budget.js';
import { buildMessageCopy } from './message-copy.js';
import { showModalFirst } from './modal.js';
import { discordErrorCode, isDeadInteractionError, replyInChunks } from './reply.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('replyInChunks', () => {
  function target(state: { replied?: boolean; deferred?: boolean } = {}) {
    return {
      replied: state.replied ?? false,
      deferred: state.deferred ?? false,
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
  }
  const longText = () => Array.from({ length: 5 }, (_, i) => `${i}`.repeat(900)).join('\n');

  it('replies with the first piece and follows up with the rest, each within 2000 characters', async () => {
    const interaction = target();
    await replyInChunks(interaction, longText(), { ephemeral: true });

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const sent = [
      ...interaction.reply.mock.calls.map(([o]) => o as { content: string; flags?: number }),
      ...interaction.followUp.mock.calls.map(([o]) => o as { content: string; flags?: number }),
    ];
    expect(sent.length).toBeGreaterThan(1);
    for (const message of sent) {
      expect(message.content.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
      expect(message.flags).toBe(MessageFlags.Ephemeral);
    }
    expect(sent.map((m) => m.content).join('\n')).toBe(longText());
  });

  it('edits the placeholder of a deferred reply, then follows up', async () => {
    const interaction = target({ deferred: true });
    await replyInChunks(interaction, longText());
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalled();
  });

  it('only follows up once a reply exists', async () => {
    const interaction = target({ replied: true });
    await replyInChunks(interaction, 'short');
    expect(interaction.followUp).toHaveBeenCalledWith({ content: 'short', flags: undefined });
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('sends a placeholder instead of an empty body, and waits for each piece in order', async () => {
    const interaction = target();
    await replyInChunks(interaction, '  \n ');
    expect(interaction.reply).toHaveBeenCalledWith({ content: '(empty)', flags: undefined });

    const order: string[] = [];
    const slow = target();
    slow.reply.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('reply');
    });
    slow.followUp.mockImplementation(() => {
      order.push('followUp');
      return Promise.resolve();
    });
    await replyInChunks(slow, longText());
    expect(order[0]).toBe('reply');
  });

  it('passes a fixed allowedMentions to every piece, and leaves the key out when none is given', async () => {
    const pinged = target({ deferred: true });
    await replyInChunks(pinged, longText(), { allowedMentions: { parse: [] } });
    const sent = [
      ...pinged.editReply.mock.calls.map(([o]) => o as object),
      ...pinged.followUp.mock.calls.map(([o]) => o as object),
    ];
    expect(sent.length).toBeGreaterThan(1);
    for (const message of sent) expect(message).toMatchObject({ allowedMentions: { parse: [] } });

    const plain = target();
    await replyInChunks(plain, 'short');
    expect(plain.reply.mock.calls[0]?.[0]).not.toHaveProperty('allowedMentions');
  });

  it('asks a function for the allowedMentions of each piece separately', async () => {
    const interaction = target({ replied: true });
    await replyInChunks(interaction, longText(), {
      allowedMentions: (chunk) => ({ users: [chunk.slice(0, 1)] }),
    });
    const users = interaction.followUp.mock.calls.map(
      ([o]) => (o as { allowedMentions: { users: string[] } }).allowedMentions.users[0],
    );
    expect(users.length).toBeGreaterThan(1);
    expect(users[0]).toBe('0');
    expect(users).not.toEqual(users.map(() => users[0]));
  });

  it('propagates a failed send so the caller sees it', async () => {
    const interaction = target();
    interaction.reply.mockRejectedValue(new Error('Missing Access'));
    await expect(replyInChunks(interaction, 'x')).rejects.toThrow('Missing Access');
  });
});

describe('Discord error codes', () => {
  it('reads a numeric code and recognises a dead interaction', () => {
    expect(discordErrorCode(Object.assign(new Error('x'), { code: 10062 }))).toBe(10062);
    expect(discordErrorCode(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBeUndefined();
    expect(discordErrorCode(null)).toBeUndefined();
    expect(isDeadInteractionError({ code: 10062 })).toBe(true);
    expect(isDeadInteractionError({ code: 40060 })).toBe(true);
    expect(isDeadInteractionError({ code: 50013 })).toBe(false);
    expect(isDeadInteractionError(new Error('x'))).toBe(false);
  });
});

describe('showModalFirst', () => {
  it('shows the modal as the first response', async () => {
    const showModal = vi.fn().mockResolvedValue(undefined);
    await showModalFirst({ replied: false, deferred: false, showModal }, 'modal');
    expect(showModal).toHaveBeenCalledWith('modal');
  });

  it.each([
    { replied: true, deferred: false },
    { replied: false, deferred: true },
  ])('refuses once the interaction is acknowledged (%o)', async (state) => {
    const showModal = vi.fn();
    await expect(showModalFirst({ ...state, showModal }, 'modal')).rejects.toThrow(
      'first response',
    );
    expect(showModal).not.toHaveBeenCalled();
  });
});

describe('buildMessageCopy', () => {
  const attachments = (...files: string[]) => new Map(files.map((f) => [f, { name: f }]));

  it('copies text and attachments', () => {
    expect(buildMessageCopy({ content: 'hello', attachments: attachments('a.png') })).toEqual({
      content: 'hello',
      files: [{ name: 'a.png' }],
    });
  });

  it('copies an attachment-only or a text-only message', () => {
    expect(
      buildMessageCopy({ content: '', attachments: attachments('a.png') })?.files,
    ).toHaveLength(1);
    expect(buildMessageCopy({ content: 'hello', attachments: attachments() })?.content).toBe(
      'hello',
    );
  });

  it('has nothing to copy from an empty message', () => {
    expect(buildMessageCopy({ content: '', attachments: attachments() })).toBeNull();
  });
});

describe('withAutocompleteBudget', () => {
  function interaction() {
    const respond = vi.fn().mockResolvedValue(undefined);
    return { respond, value: { respond } as unknown as AutocompleteInteraction };
  }
  const identity = (data: string[]) => data.map((name) => ({ name, value: name }));

  it('answers with an empty list when the load runs past the budget, and caches the late result', async () => {
    let finish: (data: string[]) => void = () => undefined;
    const load = vi.fn(() => new Promise<string[]>((resolve) => (finish = resolve)));
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => 'message:1',
      load,
      choices: identity,
      budgetMs: 20,
    });

    const first = interaction();
    await handler(first.value);
    expect(first.respond).toHaveBeenCalledWith([]);

    finish(['👍']);
    await new Promise((resolve) => setImmediate(resolve));
    const again = interaction();
    await handler(again.value);
    expect(again.respond).toHaveBeenCalledWith([{ name: '👍', value: '👍' }]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one load between keystrokes that arrive while it runs', async () => {
    let finish: (data: string[]) => void = () => undefined;
    const load = vi.fn(() => new Promise<string[]>((resolve) => (finish = resolve)));
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => 'message:1',
      load,
      choices: identity,
      budgetMs: 1000,
    });

    const first = interaction();
    const second = interaction();
    const answered = Promise.all([handler(first.value), handler(second.value)]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(load).toHaveBeenCalledTimes(1);

    finish(['a']);
    await answered;
    expect(first.respond).toHaveBeenCalledWith([{ name: 'a', value: 'a' }]);
    expect(second.respond).toHaveBeenCalledWith([{ name: 'a', value: 'a' }]);
  });

  it('joins a load that outlived the budget instead of starting another', async () => {
    let finish: (data: string[]) => void = () => undefined;
    const load = vi.fn(() => new Promise<string[]>((resolve) => (finish = resolve)));
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => 'message:1',
      load,
      choices: identity,
      budgetMs: 10,
    });
    await handler(interaction().value);
    await handler(interaction().value);
    expect(load).toHaveBeenCalledTimes(1);
    finish(['a']);
  });

  it('does not cache a failed load, and the next keystroke loads again', async () => {
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('Discord 500'))
      .mockResolvedValue(['a']);
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => 'message:1',
      load,
      choices: identity,
    });
    await expect(handler(interaction().value)).rejects.toThrow('Discord 500');

    const retry = interaction();
    await handler(retry.value);
    expect(load).toHaveBeenCalledTimes(2);
    expect(retry.respond).toHaveBeenCalledWith([{ name: 'a', value: 'a' }]);
  });

  it('survives a load that throws before returning a promise', async () => {
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockImplementationOnce(() => {
        throw new TypeError('sync failure');
      })
      .mockResolvedValue(['a']);
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => 'k',
      load,
      choices: identity,
    });
    await expect(handler(interaction().value)).rejects.toThrow('sync failure');
    await handler(interaction().value);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let a load that fails after the budget become an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let fail: (error: Error) => void = () => undefined;
      const handler = withAutocompleteBudget<string[]>({
        cacheKey: () => undefined,
        load: () => new Promise<string[]>((_, reject) => (fail = reject)),
        choices: identity,
        budgetMs: 10,
      });
      await handler(interaction().value);
      fail(new Error('late failure'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('serves a cache hit without loading again, per key', async () => {
    const load = vi.fn().mockResolvedValue(['a']);
    const key = { current: 'message:1' };
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => key.current,
      load,
      choices: identity,
    });
    await handler(interaction().value);
    await handler(interaction().value);
    expect(load).toHaveBeenCalledTimes(1);
    key.current = 'message:2';
    await handler(interaction().value);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache without a key', async () => {
    const load = vi.fn().mockResolvedValue(['a']);
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => undefined,
      load,
      choices: identity,
    });
    await handler(interaction().value);
    await handler(interaction().value);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('expires cached data after the TTL', async () => {
    const load = vi.fn().mockResolvedValue(['a']);
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => 'k',
      load,
      choices: identity,
      ttlMs: 15,
    });
    await handler(interaction().value);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await handler(interaction().value);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shows at most 25 choices', async () => {
    const handler = withAutocompleteBudget<string[]>({
      cacheKey: () => undefined,
      load: () => Promise.resolve(Array.from({ length: 60 }, (_, i) => String(i))),
      choices: identity,
    });
    const answered = interaction();
    await handler(answered.value);
    expect(answered.respond.mock.calls[0]?.[0]).toHaveLength(AUTOCOMPLETE_MAX_CHOICES);
  });

  it.each([10062, 40060])(
    'only logs when the interaction died (%i): resolves, no second reply',
    async (code) => {
      const handler = withAutocompleteBudget<string[]>({
        cacheKey: () => undefined,
        load: () => Promise.resolve(['a']),
        choices: identity,
      });
      const answered = interaction();
      answered.respond.mockRejectedValue(Object.assign(new Error('Unknown interaction'), { code }));
      await expect(handler(answered.value)).resolves.toBeUndefined();
      expect(answered.respond).toHaveBeenCalledTimes(1);
    },
  );

  it('lets any other failure reach the exception filter', async () => {
    const failingLoad = withAutocompleteBudget<string[]>({
      cacheKey: () => undefined,
      load: () => Promise.reject(new Error('database down')),
      choices: identity,
    });
    await expect(failingLoad(interaction().value)).rejects.toThrow('database down');

    const failingRespond = withAutocompleteBudget<string[]>({
      cacheKey: () => undefined,
      load: () => Promise.resolve(['a']),
      choices: identity,
    });
    const answered = interaction();
    answered.respond.mockRejectedValue(Object.assign(new Error('Missing Access'), { code: 50001 }));
    await expect(failingRespond(answered.value)).rejects.toThrow('Missing Access');
  });
});

describe('StandardSchemaOptionsPipe', () => {
  const Options = z.object({
    count: z.number().int().min(1).max(10),
    note: z.string().trim().default('none'),
  });
  const pipe = new StandardSchemaOptionsPipe(Options);
  const metadata = { type: 'custom', metatype: Object, data: undefined } as const;

  it('hands the handler the schema output: unknown fields stripped, defaults applied', async () => {
    await expect(pipe.transform({ count: 3, extra: 'dropped' }, metadata)).resolves.toEqual({
      count: 3,
      note: 'none',
    });
  });

  it('turns invalid input into VALIDATION_FAILED without exposing the issues', async () => {
    const failure: unknown = await pipe.transform({ count: 99, note: 'x' }, metadata).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ServiceError);
    expect((failure as ServiceError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect((failure as ServiceError).message).not.toContain('count');
  });
});
