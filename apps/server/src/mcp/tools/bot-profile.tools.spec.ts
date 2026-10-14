import 'reflect-metadata';
import { ErrorCode } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotProfileService } from '../../modules/guild-config/bot-profile.js';
import { HARNESS_GUILD, HARNESS_KEY, HARNESS_USER, startMcp } from '../mcp.test-harness.js';
import { checkToolRow } from '../tool-definition.js';
import { BOT_PROFILE_TOOLS } from './bot-profile.tools.js';

const UNKNOWN_GUILD = '444444444444444443';
const PROFILE = { nick: 'Sabi', avatarUrl: null };

/** The first bytes of a PNG, which is all the format check reads. */
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString(
  'base64',
);

type Mcp = Awaited<ReturnType<typeof startMcp>>;

describe('bot profile tools', () => {
  let service: {
    getBotProfile: ReturnType<typeof vi.fn>;
    setBotProfile: ReturnType<typeof vi.fn>;
  };
  let mcp: Mcp;

  const start = async (mode: 'READ' | 'WRITE' = 'WRITE', instance: unknown = service) => {
    mcp = await startMcp({
      rows: BOT_PROFILE_TOOLS,
      mode,
      services: new Map<never, unknown>([[BotProfileService as never, instance]]),
    });
  };

  beforeEach(() => {
    service = {
      getBotProfile: vi.fn(() => Promise.resolve(PROFILE)),
      setBotProfile: vi.fn((_g: string, input: { nick?: string }, _a: unknown, opts: unknown) =>
        Promise.resolve({
          dryRun: (opts as { dryRun: boolean }).dryRun,
          changes: Object.keys(input),
          profile: PROFILE,
        }),
      ),
    };
  });
  afterEach(async () => {
    await mcp.close();
  });

  const dryRun = async (extra: Record<string, unknown>) =>
    mcp.call('bot_profile_set', { guildId: HARNESS_GUILD, dryRun: true, ...extra });

  it('show only the read tool to a READ key', async () => {
    await start('READ');
    expect([...mcp.registeredTools]).toEqual(['bot_profile_get']);
  });

  it('read the profile of the named server and refuse a server the person cannot manage', async () => {
    await start();
    const reply = await mcp.call('bot_profile_get', { guildId: HARNESS_GUILD });
    // The nickname is text a person set, so it comes back marked as untrusted.
    expect(reply.json()).toMatchObject({
      data: { ...PROFILE, nick: { untrusted: true, text: PROFILE.nick } },
    });
    const other = await mcp.call('bot_profile_get', { guildId: UNKNOWN_GUILD });
    expect(other.failed).toBe(true);
    expect(service.getBotProfile).toHaveBeenCalledTimes(1);
  });

  it('preview a nickname and avatar change, then apply it with the token under the MCP actor', async () => {
    await start();
    const preview = await dryRun({ nick: 'Sabi 2', avatarBase64: PNG_BASE64 });
    const { confirmToken } = (preview.json() as { data: { confirmToken: string } }).data;
    expect(service.setBotProfile).toHaveBeenCalledWith(
      HARNESS_GUILD,
      { nick: 'Sabi 2', avatar: PNG_BASE64 },
      expect.objectContaining({ source: 'MCP', userId: HARNESS_USER, apiKeyId: HARNESS_KEY }),
      { dryRun: true },
    );

    const done = await mcp.call('bot_profile_set', {
      guildId: HARNESS_GUILD,
      nick: 'Sabi 2',
      avatarBase64: PNG_BASE64,
      confirmToken,
    });
    expect(done.failed).toBe(false);
    expect(service.setBotProfile).toHaveBeenLastCalledWith(
      HARNESS_GUILD,
      { nick: 'Sabi 2', avatar: PNG_BASE64 },
      expect.anything(),
      { dryRun: false },
    );
  });

  it('refuse to change anything without a token', async () => {
    await start();
    const reply = await mcp.call('bot_profile_set', { guildId: HARNESS_GUILD, nick: 'Sabi 2' });
    expect(reply.failed).toBe(true);
    expect(service.setBotProfile).not.toHaveBeenCalled();
  });

  it('turn resetAvatar into a null avatar and null nick into clearing the nickname', async () => {
    await start();
    await dryRun({ resetAvatar: true });
    expect(service.setBotProfile).toHaveBeenLastCalledWith(
      HARNESS_GUILD,
      { avatar: null },
      expect.anything(),
      { dryRun: true },
    );
    await dryRun({ nick: null });
    expect(service.setBotProfile).toHaveBeenLastCalledWith(
      HARNESS_GUILD,
      { nick: null },
      expect.anything(),
      { dryRun: true },
    );
  });

  it('refuse a picture and a reset in the same call', async () => {
    await start();
    const reply = await dryRun({ avatarBase64: PNG_BASE64, resetAvatar: true });
    expect(reply.failed).toBe(true);
    expect(reply.text).toContain(ErrorCode.VALIDATION_FAILED);
    expect(service.setBotProfile).not.toHaveBeenCalled();
  });

  it('refuse a URL, a data URI and a picture over 256 KiB before the service is reached', async () => {
    await start();
    for (const avatarBase64 of [
      'https://cdn.example.test/a.png',
      `data:image/png;base64,${PNG_BASE64}`,
      'A'.repeat(Math.ceil((256 * 1024) / 3) * 4 + 4),
    ]) {
      expect((await dryRun({ avatarBase64 })).failed).toBe(true);
    }
    expect(service.setBotProfile).not.toHaveBeenCalled();
  });

  it('refuse bytes that are not a PNG, JPEG or GIF, using the real service', async () => {
    const audit = { record: vi.fn() };
    // Judged from the bytes before any Discord call, so no client is needed.
    await start('WRITE', new BotProfileService({} as never, audit as never));
    const notAnImage = Buffer.from('plain text, not a picture').toString('base64');
    const reply = await dryRun({ avatarBase64: notAnImage });
    expect(reply.failed).toBe(true);
    expect(reply.text).toContain(ErrorCode.VALIDATION_FAILED);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('bot profile tools registry rows', () => {
  it('pass the registry row checks', () => {
    const classes = new Map<string, { prototype: object }>([
      [BotProfileService.name, BotProfileService],
    ]);
    expect(BOT_PROFILE_TOOLS.flatMap((row) => checkToolRow(row, classes))).toEqual([]);
  });
});
