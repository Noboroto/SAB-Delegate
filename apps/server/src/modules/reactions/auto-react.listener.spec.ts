import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoReactListener } from './auto-react.listener.js';
import { ReactionDictionary } from './reaction-dictionary.js';

const CUSTOM_ID = '123456789012345678';
const party = { id: CUSTOM_ID, name: 'party' };

afterEach(() => {
  vi.restoreAllMocks();
});

function discordError(code: number): Error {
  return Object.assign(new Error(`Discord error ${code}`), {
    code,
    name: `DiscordAPIError[${code}]`,
  });
}

function message(content: string | null, options: { guild?: boolean; bot?: boolean } = {}) {
  return {
    content,
    partial: false,
    author: { bot: options.bot ?? false },
    guild:
      options.guild === false
        ? null
        : { emojis: { cache: { find: (p: (e: { name: string }) => boolean) => [party].find(p) } } },
    react: vi.fn().mockResolvedValue(undefined),
  };
}

function build() {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return { listener: new AutoReactListener(new ReactionDictionary()), warn };
}

describe('AutoReactListener on a new message', () => {
  it('reacts with every emoji the text asks for, in order', async () => {
    const { listener } = build();
    const created = message('react 🎉 and react ok');
    await listener.onMessageCreate([created] as never);
    expect(created.react.mock.calls.map((call: unknown[]) => call[0])).toEqual(['🎉', '👌']);
  });

  it('resolves a word to the custom emoji of the server by name', async () => {
    const { listener } = build();
    const created = message('react yes no');
    await listener.onMessageCreate([created] as never);
    expect(created.react.mock.calls.map((call: unknown[]) => call[0])).toEqual(['yes', 'no']);

    const withParty = message('react party');
    await listener.onMessageCreate([withParty] as never);
    // "react party" is no dictionary phrase and "party" is no emoji: nothing to do.
    expect(withParty.react).not.toHaveBeenCalled();
  });

  it('reacts with the custom emoji object when a dictionary word names one', async () => {
    const { listener } = build();
    const created = message('react yes');
    created.guild = {
      emojis: {
        cache: {
          find: (p: (e: { name: string }) => boolean) => [{ name: 'yes', id: '9' }].find(p),
        },
      },
    };
    await listener.onMessageCreate([created] as never);
    expect(created.react).toHaveBeenCalledWith({ name: 'yes', id: '9' });
  });

  it('also reacts to the messages of bots', async () => {
    const { listener } = build();
    const created = message('react ok', { bot: true });
    await listener.onMessageCreate([created] as never);
    expect(created.react).toHaveBeenCalledWith('👌');
  });

  it('works in a direct message, where there is no server', async () => {
    const { listener } = build();
    const created = message('react ok', { guild: false });
    await listener.onMessageCreate([created] as never);
    expect(created.react).toHaveBeenCalledWith('👌');
  });

  it('does nothing for an empty message', async () => {
    const { listener } = build();
    const created = message('');
    await listener.onMessageCreate([created] as never);
    expect(created.react).not.toHaveBeenCalled();
  });

  it('swallows a failed reaction with a warning and still tries the rest', async () => {
    const { listener, warn } = build();
    const created = message('react yes no');
    created.react.mockRejectedValueOnce(discordError(50013));
    await expect(listener.onMessageCreate([created] as never)).resolves.toBeUndefined();

    expect(created.react).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('50013');
  });

  it('swallows a failure that is not a Discord error', async () => {
    const { listener, warn } = build();
    const created = message('react ok');
    created.react.mockRejectedValue(new TypeError('socket closed'));
    await expect(listener.onMessageCreate([created] as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('gives up on a message that was deleted meanwhile', async () => {
    const { listener } = build();
    const created = message('react yes no');
    created.react.mockRejectedValue(discordError(10008));
    await expect(listener.onMessageCreate([created] as never)).resolves.toBeUndefined();
    expect(created.react).toHaveBeenCalledTimes(1);
  });

  it('never puts the message text in a warning', async () => {
    const { listener, warn } = build();
    const created = message('react 🎉 secret words');
    created.react.mockRejectedValue(discordError(50013));
    await listener.onMessageCreate([created] as never);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret words');
  });
});

describe('AutoReactListener on an edited message', () => {
  it('reacts again to the new text', async () => {
    const { listener } = build();
    const before = message('hello');
    const after = message('react ok');
    await listener.onMessageUpdate([before, after] as never);
    expect(after.react).toHaveBeenCalledWith('👌');
  });

  it('reads a message that arrived without its text before reacting', async () => {
    const { listener } = build();
    const full = message('react ok');
    const partial = { partial: true, content: null, fetch: vi.fn().mockResolvedValue(full) };
    await listener.onMessageUpdate([partial, partial] as never);
    expect(partial.fetch).toHaveBeenCalledTimes(1);
    expect(full.react).toHaveBeenCalledWith('👌');
  });

  it('does not throw when the partial message cannot be read', async () => {
    const { listener, warn } = build();
    const partial = {
      partial: true,
      content: null,
      fetch: vi.fn().mockRejectedValue(discordError(10008)),
    };
    await expect(listener.onMessageUpdate([partial, partial] as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an edit that left no text', async () => {
    const { listener } = build();
    const after = message('');
    await listener.onMessageUpdate([message('x'), after] as never);
    expect(after.react).not.toHaveBeenCalled();
  });

  it('survives a reaction that fails', async () => {
    const { listener, warn } = build();
    const after = message('react ok');
    after.react.mockRejectedValue(discordError(50013));
    await expect(listener.onMessageUpdate([message('x'), after] as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
