import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { GuildConfigService } from './guild-config.service.js';
import { GuildSyncListener } from './guild-sync.listener.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const guild = (id: string, name = `Guild ${id}`, available = true) => ({ id, name, available });

function build(ensureGuild = vi.fn().mockResolvedValue({}), stopping = () => false) {
  const listener = new GuildSyncListener(
    { ensureGuild } as unknown as GuildConfigService,
    { isStopping: stopping } as unknown as DiscordReadyService,
  );
  return { listener, ensureGuild };
}

describe('GuildSyncListener', () => {
  it('records every cached guild with its name when the client is ready', async () => {
    const { listener, ensureGuild } = build();
    const client = {
      guilds: {
        cache: new Map([
          ['1', guild('1')],
          ['2', guild('2')],
        ]),
      },
    };
    await listener.onClientReady([client] as never);
    expect(ensureGuild).toHaveBeenCalledTimes(2);
    expect(ensureGuild).toHaveBeenCalledWith('1', 'Guild 1');
    expect(ensureGuild).toHaveBeenCalledWith('2', 'Guild 2');
  });

  it('stops recording servers once shutdown began', async () => {
    let stopping = false;
    const ensureGuild = vi.fn().mockImplementation(() => {
      stopping = true;
      return Promise.resolve({});
    });
    const { listener } = build(ensureGuild, () => stopping);
    const client = {
      guilds: {
        cache: new Map([
          ['1', guild('1')],
          ['2', guild('2')],
        ]),
      },
    };
    await listener.onClientReady([client] as never);
    expect(ensureGuild).toHaveBeenCalledTimes(1);

    await listener.onGuildCreate([guild('3')] as never);
    expect(ensureGuild).toHaveBeenCalledTimes(1);
  });

  it('does not store the placeholder name of an unavailable guild', async () => {
    const { listener, ensureGuild } = build();
    await listener.onGuildCreate([guild('3', 'stub', false)] as never);
    expect(ensureGuild).toHaveBeenCalledWith('3', undefined);
  });

  it('records a guild the bot joins and follows a rename', async () => {
    const { listener, ensureGuild } = build();
    await listener.onGuildCreate([guild('4', 'Joined')] as never);
    await listener.onGuildUpdate([guild('4', 'Joined'), guild('4', 'Renamed')] as never);
    expect(ensureGuild).toHaveBeenNthCalledWith(1, '4', 'Joined');
    expect(ensureGuild).toHaveBeenNthCalledWith(2, '4', 'Renamed');
  });

  it('keeps going when one guild cannot be recorded, and logs only the error name', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const ensureGuild = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('postgres://user:secret@db/app'))
      .mockResolvedValue({});
    const { listener } = build(ensureGuild);
    const client = {
      guilds: {
        cache: new Map([
          ['1', guild('1')],
          ['2', guild('2')],
        ]),
      },
    };

    await expect(listener.onClientReady([client] as never)).resolves.toBeUndefined();

    expect(ensureGuild).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    const logged = String(error.mock.calls[0]?.[0]);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('secret');
  });

  it('has no handler that removes a guild when the bot loses it', () => {
    expect(Object.getOwnPropertyNames(GuildSyncListener.prototype)).not.toContain('onGuildDelete');
  });
});
