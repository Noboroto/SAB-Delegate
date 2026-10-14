import { ErrorCode, type ActorContext } from '@sab/shared';
import { DiscordAPIError, type Client } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import {
  GUILD,
  HTTP_ACTOR,
  asUser,
  createRestApp,
  expectGuarded,
  expectInvalid,
  snowflake,
  type RestTestApp,
} from '../../common/rest/rest-test-app.js';
import { BotProfileService } from './bot-profile.js';
import { GuildConfigController } from './guild-config.controller.js';
import { GuildConfigService } from './guild-config.service.js';

const config = { get: vi.fn(), patch: vi.fn() };
const profiles = { getBotProfile: vi.fn(), setBotProfile: vi.fn() };
const SETTINGS = {
  introChannelId: null,
  logChannelId: snowflake(11),
  birthdayChannelId: null,
  activityCategoryId: null,
  wordChannelId: null,
  wordMaxWords: 1500,
  locale: 'vi',
};
const PROFILE = { nick: 'Sabi', avatarUrl: null };
const base = `/api/guilds/${GUILD}`;
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [GuildConfigController],
    [
      { provide: GuildConfigService, useValue: config },
      { provide: BotProfileService, useValue: profiles },
    ],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  config.get.mockResolvedValue({ ...SETTINGS, internal: 'x' });
  config.patch.mockImplementation((_g, _p, _a, opts: { dryRun: boolean }) =>
    Promise.resolve(opts.dryRun ? { before: SETTINGS, after: SETTINGS } : SETTINGS),
  );
  profiles.getBotProfile.mockResolvedValue(PROFILE);
  profiles.setBotProfile.mockImplementation((_g, _c, _a, opts: { dryRun: boolean }) =>
    Promise.resolve({ dryRun: opts.dryRun, changes: ['nick'], profile: PROFILE }),
  );
});

describe('settings', () => {
  it('GET is guarded and answers the settings view', async () => {
    await expectGuarded(test, { method: 'GET', url: `${base}/settings` });
    const response = await test.app.inject({
      method: 'GET',
      url: `${base}/settings`,
      headers: asUser(),
    });
    expect(response.json()).toEqual(SETTINGS);
    expect(config.get).toHaveBeenCalledWith(GUILD);
  });

  it('PATCH sends only the fields named: absent fields keep their value, defaults are not applied', async () => {
    await expectGuarded(test, {
      method: 'PATCH',
      url: `${base}/settings`,
      payload: { locale: 'en' },
    });
    await test.app.inject({
      method: 'PATCH',
      url: `${base}/settings`,
      headers: asUser(),
      payload: { locale: 'en', unknown: 1 },
    });
    expect(config.patch).toHaveBeenCalledWith(GUILD, { locale: 'en' }, HTTP_ACTOR, {
      dryRun: false,
    });
  });

  it('PATCH rejects a channel that is not an id and a limit under the minimum', async () => {
    const call = (payload: object) => ({
      method: 'PATCH' as const,
      url: `${base}/settings`,
      payload,
    });
    await expectInvalid(test, call({ logChannelId: 'general' }), 'logChannelId');
    await expectInvalid(test, call({ wordMaxWords: 5 }), 'wordMaxWords');
    expect(config.patch).not.toHaveBeenCalled();
  });

  it('PATCH previews with before and after', async () => {
    const response = await test.app.inject({
      method: 'PATCH',
      url: `${base}/settings`,
      headers: asUser(),
      payload: { logChannelId: null, dryRun: true },
    });
    expect(response.json()).toEqual({ before: SETTINGS, after: SETTINGS });
    expect(config.patch).toHaveBeenCalledWith(GUILD, { logChannelId: null }, HTTP_ACTOR, {
      dryRun: true,
    });
  });
});

describe('bot-profile routes', () => {
  const url = `${base}/bot-profile`;

  it('GET is guarded and reads the profile of the path server', async () => {
    await expectGuarded(test, { method: 'GET', url });
    const response = await test.app.inject({ method: 'GET', url, headers: asUser() });
    expect(response.json()).toEqual(PROFILE);
    expect(profiles.getBotProfile).toHaveBeenCalledWith(GUILD);
  });

  it('PATCH validates nick and avatar, refusing a URL and a nick over 32 characters', async () => {
    const call = (payload: object) => ({ method: 'PATCH' as const, url, payload });
    await expectGuarded(test, call({ nick: 'Sabi' }));
    await expectInvalid(test, call({ nick: 'x'.repeat(33) }), 'nick');
    await expectInvalid(test, call({ avatar: 'https://example.test/a.png' }), 'avatar');
    await expectInvalid(test, call({}), 'nick');
    expect(profiles.setBotProfile).not.toHaveBeenCalled();
  });

  it('PATCH hands the change and the preview flag to the service as the HTTP actor', async () => {
    const response = await test.app.inject({
      method: 'PATCH',
      url,
      headers: asUser(),
      payload: { nick: 'Sabi', dryRun: true },
    });
    expect(response.statusCode).toBe(200);
    expect(profiles.setBotProfile).toHaveBeenCalledWith(GUILD, { nick: 'Sabi' }, HTTP_ACTOR, {
      dryRun: true,
    });
  });
});

describe('BotProfileService', () => {
  const ACTOR: ActorContext = { source: 'HTTP', userId: snowflake(900) };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const b64 = (bytes: Buffer) => bytes.toString('base64');

  function build() {
    const me = {
      nickname: 'Sabi',
      avatarURL: vi.fn().mockReturnValue('https://cdn.example.test/a.png'),
    };
    const members = {
      editMe: vi.fn().mockResolvedValue(undefined),
      fetchMe: vi.fn().mockResolvedValue(me),
    };
    const client = { guilds: { fetch: vi.fn().mockResolvedValue({ members }) } };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new BotProfileService(
      client as unknown as Client,
      audit as unknown as AuditService,
    );
    return { service, members, audit, client };
  }

  it('sets the nickname once, reads the profile back and records the change', async () => {
    const { service, members, audit } = build();
    const result = await service.setBotProfile(GUILD, { nick: 'Sabi' }, ACTOR);
    expect(members.editMe).toHaveBeenCalledTimes(1);
    expect(members.editMe).toHaveBeenCalledWith({ nick: 'Sabi' });
    expect(members.fetchMe).toHaveBeenCalled();
    expect(result).toEqual({
      dryRun: false,
      changes: ['nick'],
      profile: { nick: 'Sabi', avatarUrl: 'https://cdn.example.test/a.png' },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('sends nickname and avatar as two separate requests, with the type read from the bytes', async () => {
    const { service, members } = build();
    await service.setBotProfile(GUILD, { nick: 'Sabi', avatar: b64(png) }, ACTOR);
    expect(members.editMe).toHaveBeenCalledTimes(2);
    expect(members.editMe).toHaveBeenNthCalledWith(1, { nick: 'Sabi' });
    expect(members.editMe).toHaveBeenNthCalledWith(2, {
      avatar: `data:image/png;base64,${b64(png)}`,
    });
  });

  it('does not write on a preview', async () => {
    const { service, members, audit } = build();
    const result = await service.setBotProfile(GUILD, { nick: 'Sabi' }, ACTOR, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(members.editMe).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses bytes that are not PNG, JPEG or GIF, an empty picture and one over 256 KiB', async () => {
    const { service, members } = build();
    const text = b64(Buffer.from('<svg></svg>'));
    const big = b64(Buffer.concat([png, Buffer.alloc(256 * 1024)]));
    for (const avatar of [text, big]) {
      await expect(service.setBotProfile(GUILD, { avatar }, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
    }
    await expect(
      service.setBotProfile(GUILD, { nick: 'x'.repeat(33) }, ACTOR),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(members.editMe).not.toHaveBeenCalled();
  });

  it('maps the avatar rate limit to RATE_LIMITED and then waits before asking again', async () => {
    const { service, members } = build();
    members.editMe.mockRejectedValueOnce(
      new DiscordAPIError(
        {
          code: 50035,
          message: 'Invalid Form Body',
          errors: { avatar: { _errors: [{ code: 'AVATAR_RATE_LIMIT', message: 'x' }] } },
        },
        50035,
        400,
        'PATCH',
        '/x',
        {},
      ),
    );
    await expect(service.setBotProfile(GUILD, { avatar: b64(png) }, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
    });
    members.editMe.mockClear();
    await expect(service.setBotProfile(GUILD, { avatar: b64(png) }, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
    });
    expect(members.editMe).not.toHaveBeenCalled();
  });

  it('reports a server the bot is not in', async () => {
    const { service, client } = build();
    client.guilds.fetch.mockRejectedValue(
      new DiscordAPIError({ code: 10004, message: 'Unknown Guild' }, 10004, 404, 'GET', '/x', {}),
    );
    await expect(service.getBotProfile(GUILD)).rejects.toMatchObject({
      code: ErrorCode.GUILD_BOT_MISSING,
    });
  });
});
