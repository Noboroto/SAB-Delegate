import 'reflect-metadata';
import { MESSAGES } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { SystemCommands } from './system.commands.js';
import type { SystemService } from './system.service.js';

const MINUTE = 60_000;

function run(options: {
  locale: 'vi' | 'en';
  uptimeMs: number;
  wsPing: number;
  withMessage?: boolean;
}) {
  const reply = vi.fn(() =>
    Promise.resolve({
      resource: options.withMessage === false ? null : { message: { createdTimestamp: 1_250 } },
    }),
  );
  const editReply = vi.fn((_options: { content: string }) => Promise.resolve());
  const interaction = { guildId: '1', createdTimestamp: 1_000, reply, editReply };
  const system = {
    getStatus: () => ({ uptimeMs: options.uptimeMs, wsPing: options.wsPing, guildCount: 1 }),
  } as unknown as SystemService;
  const locales = {
    resolve: () => Promise.resolve(options.locale),
  } as unknown as GuildLocaleService;
  const commands = new SystemCommands(system, locales);
  return { done: commands.ping([interaction] as never), reply, editReply };
}

describe('/ping', () => {
  it('answers first, then edits in uptime, heartbeat and roundtrip', async () => {
    const { done, reply, editReply } = run({
      locale: 'en',
      uptimeMs: 26 * 60 * MINUTE + 5 * MINUTE,
      wsPing: 42,
    });
    await done;
    expect(reply).toHaveBeenCalledWith({
      content: MESSAGES.en.system.ping.pinging,
      withResponse: true,
    });
    const content = editReply.mock.calls[0]?.[0].content ?? '';
    expect(content).toContain('1d 2h 5m');
    expect(content).toContain('Websocket heartbeat: 42 ms');
    expect(content).toContain('Roundtrip latency: 250 ms');
  });

  it('speaks Vietnamese for a Vietnamese guild', async () => {
    const { done, editReply } = run({ locale: 'vi', uptimeMs: 3 * MINUTE, wsPing: 10 });
    await done;
    expect(editReply.mock.calls[0]?.[0].content).toContain('0 ngày 0 giờ 3 phút');
  });

  it('says "not measured yet" instead of a negative heartbeat or a missing roundtrip', async () => {
    const { done, editReply } = run({ locale: 'en', uptimeMs: 0, wsPing: -1, withMessage: false });
    await done;
    const content = editReply.mock.calls[0]?.[0].content ?? '';
    expect(content).toContain('Websocket heartbeat: not measured yet');
    expect(content).toContain('Roundtrip latency: not measured yet');
  });
});
