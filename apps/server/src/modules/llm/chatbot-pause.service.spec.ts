import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { CHATBOT_PROVIDER_PAUSE_MS } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatbotPauseService, pauseKeyOf } from './chatbot-pause.service.js';

const GUILD = '100000000000000001';
const OTHER_GUILD = '100000000000000002';
const ADMIN = '700000000000000001';
const BASE = 'https://llm.example/v1';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T08:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pauseKeyOf', () => {
  it('tells servers, models and keys apart but ignores a trailing slash', () => {
    const key = pauseKeyOf(GUILD, BASE, 'm', 'abcd');
    expect(pauseKeyOf(GUILD, `${BASE}/`, 'm', 'abcd')).toBe(key);
    expect(pauseKeyOf(OTHER_GUILD, BASE, 'm', 'abcd')).not.toBe(key);
    expect(pauseKeyOf(null, BASE, 'm', 'abcd')).not.toBe(key);
    expect(pauseKeyOf(GUILD, BASE, 'n', 'abcd')).not.toBe(key);
    expect(pauseKeyOf(GUILD, BASE, 'm', 'wxyz')).not.toBe(key);
  });
});

describe('ChatbotPauseService: the pause window', () => {
  const key = pauseKeyOf(null, BASE, 'm', 'abcd');

  it('lets everything through until a refusal, then holds calls back for the window', () => {
    const pause = new ChatbotPauseService();
    expect(pause.admit(key)).toBe(0);
    const { started, until } = pause.trip(key, null, 0);
    expect(started).toBe(true);
    expect(until.getTime()).toBe(Date.now() + CHATBOT_PROVIDER_PAUSE_MS);
    expect(pause.admit(key)).toBeNull();
    expect(pause.pausedUntil(key)).toEqual(until);
    vi.advanceTimersByTime(CHATBOT_PROVIDER_PAUSE_MS - 1);
    expect(pause.admit(key)).toBeNull();
  });

  it('counts a second refusal inside the window as the same outage', () => {
    const pause = new ChatbotPauseService();
    const first = pause.trip(key, null, 0);
    vi.advanceTimersByTime(60_000);
    const second = pause.trip(key, null, 0);
    expect(second.started).toBe(false);
    expect(second.until).toEqual(first.until);
  });

  it('lets one probe through after the window, and a working probe ends the outage', () => {
    const pause = new ChatbotPauseService();
    pause.trip(key, null, 0);
    vi.advanceTimersByTime(CHATBOT_PROVIDER_PAUSE_MS);
    expect(pause.pausedUntil(key)).toBeNull();
    const probe = pause.admit(key);
    expect(probe).toBeGreaterThan(0);
    // The probe is still out: nobody else goes through.
    expect(pause.admit(key)).toBeNull();
    pause.succeed(key, probe ?? 0);
    expect(pause.admit(key)).toBe(0);
    expect(pause.admit(key)).toBe(0);
  });

  it('renews the window without a new alert when the probe is refused again', () => {
    const pause = new ChatbotPauseService();
    pause.trip(key, null, 0);
    vi.advanceTimersByTime(CHATBOT_PROVIDER_PAUSE_MS);
    const probe = pause.admit(key) ?? 0;
    const again = pause.trip(key, null, probe);
    expect(again.started).toBe(false);
    expect(again.until.getTime()).toBe(Date.now() + CHATBOT_PROVIDER_PAUSE_MS);
    expect(pause.admit(key)).toBeNull();
  });

  it('frees the probe slot when the probe fails for another reason', () => {
    const pause = new ChatbotPauseService();
    pause.trip(key, null, 0);
    vi.advanceTimersByTime(CHATBOT_PROVIDER_PAUSE_MS);
    const probe = pause.admit(key) ?? 0;
    pause.release(key, probe);
    expect(pause.admit(key)).toBeGreaterThan(probe);
  });

  it('ignores a call admitted before the outage that ends after it', () => {
    const pause = new ChatbotPauseService();
    const early = pause.admit(key) ?? -1;
    const slow = pause.admit(key) ?? -1;
    expect(pause.trip(key, null, early).started).toBe(true);

    // A success from before the outage does not end it.
    pause.succeed(key, slow);
    expect(pause.pausedUntil(key)).not.toBeNull();

    // After the window it cannot free the slot of the probe, or renew the window, either.
    vi.advanceTimersByTime(CHATBOT_PROVIDER_PAUSE_MS);
    const probe = pause.admit(key) ?? 0;
    expect(probe).toBeGreaterThan(0);
    pause.release(key, slow);
    expect(pause.admit(key)).toBeNull();
    const stale = pause.trip(key, null, slow);
    expect(stale.started).toBe(false);
    expect(pause.admit(key)).toBeNull();
    expect(pause.pausedUntil(key)).toBeNull();

    // Only the probe itself decides.
    pause.succeed(key, probe);
    expect(pause.admit(key)).toBe(0);
  });

  it('keeps a server apart from the shared model, both ways', () => {
    const pause = new ChatbotPauseService();
    const own = pauseKeyOf(GUILD, BASE, 'm', 'abcd');
    pause.trip(own, GUILD, 0);
    expect(pause.admit(own)).toBeNull();
    expect(pause.admit(key)).toBe(0);
    expect(pause.admit(pauseKeyOf(OTHER_GUILD, BASE, 'm', 'abcd'))).toBe(0);

    pause.clear(own);
    pause.trip(key, null, 0);
    expect(pause.admit(key)).toBeNull();
    expect(pause.admit(own)).toBe(0);
  });

  it('forgets a server or the shared model when its settings change', () => {
    const pause = new ChatbotPauseService();
    const own = pauseKeyOf(GUILD, BASE, 'm', 'abcd');
    const other = pauseKeyOf(OTHER_GUILD, BASE, 'm', 'abcd');
    pause.trip(own, GUILD, 0);
    pause.trip(other, OTHER_GUILD, 0);
    pause.trip(key, null, 0);

    pause.clearGuild(GUILD);
    expect(pause.pausedUntil(own)).toBeNull();
    expect(pause.pausedUntil(other)).not.toBeNull();
    expect(pause.pausedUntil(key)).not.toBeNull();

    pause.clearGlobal();
    expect(pause.pausedUntil(key)).toBeNull();
    expect(pause.pausedUntil(other)).not.toBeNull();
  });
});

function adminClient() {
  const send = vi.fn((_options: { embeds: Array<{ fields: Array<{ value: string }> }> }) =>
    Promise.resolve(undefined),
  );
  const channel = { name: 'bot-log', isTextBased: () => true, send };
  const client = {
    guilds: {
      cache: {
        get: (id: string) =>
          id === ADMIN
            ? { name: 'Admin', channels: { cache: { find: () => channel } } }
            : id === GUILD
              ? { name: 'Máy chủ thử' }
              : undefined,
      },
    },
  };
  return { client, send };
}

describe('ChatbotPauseService.announce', () => {
  const until = new Date('2026-10-16T08:15:00.000Z');

  it('names the source, model, host and the end of the pause in business time', async () => {
    const { client, send } = adminClient();
    await new ChatbotPauseService().announce(client, ADMIN, {
      guildId: GUILD,
      baseUrl: `${BASE}?x=1`,
      model: 'model-x',
      until,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const options = send.mock.calls[0]?.[0] as {
      embeds: Array<{ fields: Array<{ value: string }> }>;
    };
    const values = options.embeds[0]?.fields.map((field) => field.value);
    expect(values).toEqual([
      `Server key: Máy chủ thử (${GUILD})`,
      'model-x',
      'llm.example',
      '15:15 (Asia/Ho_Chi_Minh)',
    ]);
    expect(options).toMatchObject({ allowedMentions: { parse: [] } });
  });

  it('calls the shared model by that name', async () => {
    const { client, send } = adminClient();
    await new ChatbotPauseService().announce(client, ADMIN, {
      guildId: null,
      baseUrl: BASE,
      model: 'm',
      until,
    });
    const fields = (send.mock.calls[0]?.[0].embeds[0]?.fields ?? []).map((f) => f.value);
    expect(fields[0]).toBe('Shared key');
  });

  it('never throws when #bot-log is missing or refuses the post', async () => {
    const missing = { guilds: { cache: { get: () => undefined } } };
    const outage = { guildId: null, baseUrl: BASE, model: 'm', until };
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { client, send } = adminClient();
    send.mockRejectedValueOnce(new Error(`Missing Access ${randomBytes(6).toString('hex')}`));
    const pause = new ChatbotPauseService();
    await expect(pause.announce(missing, ADMIN, outage)).resolves.toBeUndefined();
    await expect(pause.announce(client, ADMIN, outage)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
