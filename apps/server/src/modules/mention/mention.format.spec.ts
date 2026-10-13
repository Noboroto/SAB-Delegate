import { MESSAGE_MAX_LENGTH } from '@sab/shared';
import type { Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { allowedMentionsFor, postAsReply, renderMentionList } from './mention.format.js';

const base = 100000000000000000n;
const idOf = (n: number): string => String(base + BigInt(n));

describe('allowedMentionsFor', () => {
  it('names the users and roles in the text and nobody else', () => {
    const text = `<@${idOf(1)}>, <@!${idOf(2)}> and <@&${idOf(3)}> @everyone @here`;
    expect(allowedMentionsFor(text)).toEqual({
      users: [idOf(1), idOf(2)],
      roles: [idOf(3)],
    });
  });

  it('never allows @everyone or @here to ping', () => {
    expect(allowedMentionsFor('@everyone @here')).toEqual({ users: [], roles: [] });
  });

  it('lists a user once however often it is mentioned', () => {
    expect(allowedMentionsFor(`<@${idOf(1)}> <@${idOf(1)}>`).users).toEqual([idOf(1)]);
  });

  it('stays within the 100 Discord accepts', () => {
    const text = Array.from({ length: 150 }, (_, n) => `<@${idOf(n)}>`).join(' ');
    expect(allowedMentionsFor(text).users).toHaveLength(100);
  });

  it('ignores digit runs that are not a user id', () => {
    expect(allowedMentionsFor('<@123> <@1234567890123456789012345>').users).toEqual([]);
  });
});

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
    const mentioned = chunks.flatMap((chunk) => allowedMentionsFor(chunk).users ?? []);
    expect(mentioned).toEqual(userIds);
  });

  it('keeps each chunk within 100 mentions', () => {
    const userIds = Array.from({ length: 400 }, (_, n) => idOf(n + 10));
    for (const chunk of renderMentionList({ ...input, userIds })) {
      expect(allowedMentionsFor(chunk).users?.length ?? 0).toBeLessThanOrEqual(100);
    }
  });
});

describe('postAsReply', () => {
  function target(sendable = true) {
    const send = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const message = { reply, channel: { isSendable: () => sendable, send } };
    return { message: message as unknown as Message, reply, send };
  }

  it('replies with the first piece and sends the rest to the channel, each pinging whom it names', async () => {
    const { message, reply, send } = target();
    await postAsReply(message, [`<@${idOf(1)}>`, `<@${idOf(2)}>`]);

    expect(reply).toHaveBeenCalledWith({
      content: `<@${idOf(1)}>`,
      allowedMentions: { users: [idOf(1)], roles: [], repliedUser: true },
    });
    expect(send).toHaveBeenCalledWith({
      content: `<@${idOf(2)}>`,
      allowedMentions: { users: [idOf(2)], roles: [] },
    });
  });

  it('does nothing for an empty list', async () => {
    const { message, reply } = target();
    await postAsReply(message, []);
    expect(reply).not.toHaveBeenCalled();
  });

  it('treats a channel that cannot be written to as a bug once more than the reply is needed', async () => {
    const { message } = target(false);
    await expect(postAsReply(message, ['a', 'b'])).rejects.toThrow(RangeError);
  });
});
