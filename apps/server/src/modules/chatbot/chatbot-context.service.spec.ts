import 'reflect-metadata';
import { CHATBOT_CONTEXT_LINE_MAX_CHARS, CHATBOT_CONTEXT_MESSAGES } from '@sab/shared';
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatbotContextService } from './chatbot-context.service.js';

const BOT = '900000000000000001';
const ANNA = '400000000000000001';
const BINH = '400000000000000002';
const GONE = '400000000000000003';
const OTHER_BOT = '900000000000000002';

type Collect = Parameters<ChatbotContextService['collectFrom']>[0];
type Source = Awaited<ReturnType<Collect['fetchReference']>>;

function user(id: string, displayName: string, bot = false) {
  return { id, bot, displayName };
}

const USERS = {
  [ANNA]: user(ANNA, 'anna_global'),
  [BINH]: user(BINH, 'binh_global'),
  [GONE]: user(GONE, 'gone_global'),
  [OTHER_BOT]: user(OTHER_BOT, 'OtherBot', true),
  [BOT]: user(BOT, 'Sabi', true),
};

let counter = 0;

function msg(
  authorId: keyof typeof USERS,
  text: string,
  options: {
    minute?: number;
    attachments?: { name: string; contentType: string }[];
    id?: string;
    member?: string;
  } = {},
): Source {
  counter += 1;
  return {
    id: options.id ?? `5000000000000000${String(counter).padStart(2, '0')}`,
    cleanContent: text,
    createdAt: new Date(Date.UTC(2026, 9, 16, 7, options.minute ?? counter)),
    author: USERS[authorId],
    member: options.member === undefined ? null : { displayName: options.member },
    attachments: {
      values: () =>
        (options.attachments ?? []).map((a) => ({
          ...a,
          url: `https://cdn.discordapp.com/attachments/1/2/${a.name}`,
          size: 5,
        })),
    },
  };
}

type World = {
  history?: Source[] | Error;
  replied?: Source | Error;
  cache?: Record<string, string>;
  fetched?: Record<string, string> | Error;
  botNick?: string | null;
  text?: string;
  attachments?: { name: string; contentType: string }[];
  referenceId?: string;
};

function world(w: World = {}) {
  const historyFetch = vi.fn(() => {
    if (w.history instanceof Error) return Promise.reject(w.history);
    const list = w.history ?? [];
    return Promise.resolve({ values: () => list });
  });
  const memberFetch = vi.fn((_options: { user: string[]; time: number }) => {
    if (w.fetched instanceof Error) return Promise.reject(w.fetched);
    const found: Record<string, string> = w.fetched ?? {};
    return Promise.resolve({
      values: () => Object.entries(found).map(([id, displayName]) => ({ id, displayName })),
    });
  });
  const trigger = msg(ANNA, w.text ?? '@Sabi xin chào', {
    id: '500000000000009999',
    minute: 59,
    ...(w.attachments === undefined ? {} : { attachments: w.attachments }),
  });
  const message: Collect = {
    ...trigger,
    reference: w.referenceId === undefined ? null : { messageId: w.referenceId },
    fetchReference: vi.fn(() =>
      w.replied === undefined || w.replied instanceof Error
        ? Promise.reject(w.replied ?? new Error('no reference'))
        : Promise.resolve(w.replied),
    ),
    guild: {
      name: 'Nhà SAB',
      members: {
        cache: {
          get: (id) => {
            const displayName = w.cache?.[id];
            return displayName === undefined ? undefined : { displayName };
          },
        },
        me: w.botNick === null ? null : { displayName: w.botNick ?? 'Sabi' },
        fetch: memberFetch,
      },
    },
    channel: { name: 'chat', messages: { fetch: historyFetch } },
    client: { user: { id: BOT, displayName: 'SabiGlobal' } },
  };
  return { message, historyFetch, memberFetch };
}

function discordError(code: number) {
  return Object.assign(new Error('Discord'), { code });
}

describe('ChatbotContextService.collectFrom', () => {
  const service = new ChatbotContextService();

  beforeEach(() => {
    counter = 0;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('reads the window before the trigger and lists it oldest first', async () => {
    const { message, historyFetch } = world({
      history: [msg(BINH, 'second', { minute: 10 }), msg(ANNA, 'first', { minute: 5 })],
      cache: { [ANNA]: 'Anna', [BINH]: 'Bình' },
    });
    const context = await service.collectFrom(message);
    expect(historyFetch).toHaveBeenCalledWith({
      limit: CHATBOT_CONTEXT_MESSAGES,
      before: '500000000000009999',
    });
    expect(context.messages.map((line) => [line.authorName, line.text])).toEqual([
      ['Anna', 'first'],
      ['Bình', 'second'],
    ]);
    expect(context.speaker).toEqual({ id: ANNA, name: 'Anna' });
    expect(context.guildName).toBe('Nhà SAB');
    expect(context.channelName).toBe('chat');
  });

  it('uses the bot guild nickname, else its global name', async () => {
    expect((await service.collectFrom(world({ botNick: 'Tí Sứ' }).message)).botName).toBe('Tí Sứ');
    expect((await service.collectFrom(world({ botNick: null }).message)).botName).toBe(
      'SabiGlobal',
    );
  });

  it('looks up uncached authors in one batch and falls back to the global name when it fails', async () => {
    const authors = [msg(ANNA, 'a'), msg(BINH, 'b'), msg(GONE, 'c'), msg(ANNA, 'd')];
    const batched = world({
      history: authors,
      cache: { [ANNA]: 'Anna' },
      fetched: { [BINH]: 'Bình' },
    });
    const context = await service.collectFrom(batched.message);
    expect(batched.memberFetch).toHaveBeenCalledTimes(1);
    expect(batched.memberFetch.mock.calls[0]?.[0]).toMatchObject({ user: [BINH, GONE] });
    expect(context.messages.map((line) => line.authorName)).toEqual([
      'Anna',
      'Bình',
      'gone_global',
      'Anna',
    ]);

    const failing = world({ history: authors, fetched: discordError(10007) });
    const fallback = await service.collectFrom(failing.message);
    expect(fallback.messages.map((line) => line.authorName)).toEqual([
      'anna_global',
      'binh_global',
      'gone_global',
      'anna_global',
    ]);
    expect(fallback.speaker.name).toBe('anna_global');
  });

  it('prefers the guild nickname a message carries over the global name', async () => {
    const world1 = world({
      history: [msg(BINH, 'hi', { member: 'Bình Nick' })],
      cache: { [ANNA]: 'Anna Cached', [BINH]: 'Bình Cached' },
    });
    const context = await service.collectFrom(world1.message);
    expect(context.messages[0]?.authorName).toBe('Bình Nick');
    expect(world1.memberFetch).not.toHaveBeenCalled();

    const trigger = world({ cache: { [ANNA]: 'Anna Cached' } });
    expect(
      (await service.collectFrom({ ...trigger.message, member: { displayName: 'Anna Nick' } }))
        .speaker.name,
    ).toBe('Anna Nick');
  });

  it('logs a non-Discord failure by class only, never its message', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failure = Object.assign(new TypeError('secret channel text'), { status: 503 });
    await service.collectFrom(world({ history: failure, fetched: failure }).message);
    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines.join('\n')).toContain('TypeError status=503');
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('reads the history and the replied-to message at the same time', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { message, historyFetch } = world({ referenceId: '1', replied: msg(ANNA, 'cũ') });
    const started: string[] = [];
    historyFetch.mockImplementation(async () => {
      started.push('history');
      await gate;
      return { values: () => [] };
    });
    const original = message.fetchReference.bind(message);
    message.fetchReference = () => {
      started.push('replied');
      release?.();
      return original();
    };
    await service.collectFrom(message);
    expect(started).toEqual(['history', 'replied']);
  });

  it('asks nobody when every name is known', async () => {
    const { message, memberFetch } = world({
      history: [msg(BINH, 'hi')],
      cache: { [ANNA]: 'Anna', [BINH]: 'Bình' },
    });
    await service.collectFrom(message);
    expect(memberFetch).not.toHaveBeenCalled();
  });

  it('omits empty messages but keeps a file-only one, and labels bots', async () => {
    const { message } = world({
      cache: { [ANNA]: 'Anna' },
      history: [
        msg(ANNA, '   '),
        msg(ANNA, '', { attachments: [{ name: 'pic.png', contentType: 'image/png' }] }),
        msg(OTHER_BOT, 'beep'),
        msg(BOT, 'earlier answer'),
        msg(ANNA, 'see', { attachments: [{ name: 'a.txt', contentType: 'text/plain' }] }),
      ],
      fetched: { [OTHER_BOT]: 'OtherBot' },
    });
    const context = await service.collectFrom(message);
    expect(context.messages.map((line) => [line.role, line.authorName, line.text])).toEqual([
      ['member', 'Anna', '[ảnh: pic.png]'],
      ['bot', 'OtherBot', 'beep'],
      ['self', 'Sabi', 'earlier answer'],
      ['member', 'Anna', 'see [tệp: a.txt]'],
    ]);
  });

  it('collapses whitespace and cuts a long line', async () => {
    const { message } = world({
      cache: { [ANNA]: 'Anna' },
      history: [msg(ANNA, `a\n\n  b${'x'.repeat(CHATBOT_CONTEXT_LINE_MAX_CHARS)}`)],
    });
    const [line] = (await service.collectFrom(message)).messages;
    expect(line?.text).toHaveLength(CHATBOT_CONTEXT_LINE_MAX_CHARS);
    expect(line?.text.startsWith('a b')).toBe(true);
    expect(line?.text.endsWith('…')).toBe(true);
  });

  it('removes the bot mention from the question and names an empty one', async () => {
    expect(
      (await service.collectFrom(world({ text: '@Sabi  giúp mình với @Sabi' }).message))
        .triggerText,
    ).toBe('giúp mình với');
    expect((await service.collectFrom(world({ text: '@Sabi' }).message)).triggerText).toBe(
      '(không có nội dung)',
    );
  });

  it('includes the replied-to message even when it is outside the window, and its files', async () => {
    const replied = msg(BINH, 'câu hỏi cũ', {
      attachments: [{ name: 'old.png', contentType: 'image/png' }],
    });
    const { message } = world({
      cache: { [ANNA]: 'Anna', [BINH]: 'Bình' },
      referenceId: replied.id,
      replied,
      attachments: [{ name: 'new.png', contentType: 'image/png' }],
    });
    const context = await service.collectFrom(message);
    expect(context.replied).toMatchObject({ id: replied.id, authorName: 'Bình' });
    expect(context.attachments.map((attachment) => attachment.name)).toEqual([
      'new.png',
      'old.png',
    ]);
  });

  it('answers without the replied-to message when it was deleted (10008)', async () => {
    const { message } = world({ referenceId: '1', replied: discordError(10008) });
    const context = await service.collectFrom(message);
    expect(context.replied).toBeNull();
  });

  it.each([50001, 10003])('does not throw when the history read fails with %s', async (code) => {
    const { message } = world({ history: discordError(code) });
    await expect(service.collectFrom(message)).resolves.toMatchObject({ messages: [] });
  });
});
