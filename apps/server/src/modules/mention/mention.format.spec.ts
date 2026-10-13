import { MESSAGE_MAX_LENGTH } from '@sab/shared';
import type { Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { userMentionsIn } from '../../discord/helpers/allowed-mentions.js';
import { postAsReply, renderMentionList } from './mention.format.js';

const base = 100000000000000000n;
const idOf = (n: number): string => String(base + BigInt(n));

describe('renderMentionList', () => {
  const input = {
    header: 'Header:',
    requesterId: idOf(2),
    authorLabel: '(author)',
    content: undefined as string | undefined,
  };

  it('writes the header, then one line per member, marking the person who asked', () => {
    const [text] = renderMentionList({ ...input, userIds: [idOf(1), idOf(2)] });
    expect(text).toBe(`Header:\n<@${idOf(1)}>,\n<@${idOf(2)}> (author),`);
  });

  it('adds the free text after the list', () => {
    const [text] = renderMentionList({ ...input, userIds: [idOf(1)], content: 'Please react' });
    expect(text?.endsWith('\n\nPlease react')).toBe(true);
  });

  it('splits a long list into messages that each fit, losing nobody', () => {
    const userIds = Array.from({ length: 400 }, (_, n) => idOf(n + 10));
    const chunks = renderMentionList({ ...input, userIds });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
    const mentioned = chunks.flatMap(
      (chunk) => userMentionsIn(chunk, new Set(userIds)).users ?? [],
    );
    expect(mentioned).toEqual(userIds);
  });

  it('keeps each chunk within 100 mentions', () => {
    const userIds = Array.from({ length: 400 }, (_, n) => idOf(n + 10));
    for (const chunk of renderMentionList({ ...input, userIds })) {
      expect(chunk.match(/<@\d+>/g)?.length ?? 0).toBeLessThanOrEqual(100);
    }
  });
});

describe('postAsReply', () => {
  const policy: Parameters<typeof postAsReply>[2] = {
    mentions: { parse: ['users', 'roles', 'everyone'] },
    pingAuthor: true,
  };

  function target(sendable = true) {
    const send = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const message = { reply, channel: { isSendable: () => sendable, send } };
    return { message: message as unknown as Message, reply, send };
  }

  it('replies with the first piece and sends the rest to the channel, with the same mention policy', async () => {
    const { message, reply, send } = target();
    const outcome = await postAsReply(message, [`<@${idOf(1)}>`, `<@${idOf(2)}>`], policy);

    expect(outcome).toEqual({ posted: 2 });
    expect(reply).toHaveBeenCalledWith({
      content: `<@${idOf(1)}>`,
      allowedMentions: { parse: ['users', 'roles', 'everyone'], repliedUser: true },
    });
    expect(send).toHaveBeenCalledWith({
      content: `<@${idOf(2)}>`,
      allowedMentions: { parse: ['users', 'roles', 'everyone'] },
    });
  });

  it('does not notify the author of the target when the policy says not to', async () => {
    const { message, reply } = target();
    await postAsReply(message, ['a'], { mentions: { parse: [] }, pingAuthor: false });
    expect(reply).toHaveBeenCalledWith({
      content: 'a',
      allowedMentions: { parse: [], repliedUser: false },
    });
  });

  it('does nothing for an empty list', async () => {
    const { message, reply } = target();
    expect(await postAsReply(message, [], policy)).toEqual({ posted: 0 });
    expect(reply).not.toHaveBeenCalled();
  });

  it('counts the pieces that went out when a later one is refused', async () => {
    const { message, send } = target();
    const refusal = new Error('Missing Permissions');
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(refusal);

    const outcome = await postAsReply(message, ['a', 'b', 'c', 'd'], policy);
    expect(outcome).toEqual({ posted: 2, error: refusal });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports nothing posted when the reply itself is refused', async () => {
    const { message, reply, send } = target();
    const refusal = new Error('Missing Access');
    reply.mockRejectedValue(refusal);

    expect(await postAsReply(message, ['a', 'b'], policy)).toEqual({ posted: 0, error: refusal });
    expect(send).not.toHaveBeenCalled();
  });

  it('treats a channel that cannot be written to as a bug once more than the reply is needed', async () => {
    const { message } = target(false);
    const outcome = await postAsReply(message, ['a', 'b'], policy);
    expect(outcome.posted).toBe(1);
    expect(outcome.error).toBeInstanceOf(RangeError);
  });
});
