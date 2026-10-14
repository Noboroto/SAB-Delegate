import { ErrorCode } from '@sab/shared';
import { ServiceError } from '../common/errors/service-error.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_TOKEN_TTL_MS, ConfirmTokenService } from './confirm-token.service.js';
import {
  FixtureService,
  spiedFixtureService,
  HARNESS_GUILD,
  HARNESS_GUILD_NAME,
  HARNESS_KEY,
  HARNESS_USER,
  fixtureRows,
  startMcp,
} from './mcp.test-harness.js';
import { ok } from './tool-result.js';

const OTHER_GUILD = '444444444444444442';
const UNKNOWN_GUILD = '444444444444444443';

type Mcp = Awaited<ReturnType<typeof startMcp>>;

describe('tool runner', () => {
  let fixture: ReturnType<typeof spiedFixtureService>;
  let mcp: Mcp;
  let tokens: ConfirmTokenService;

  beforeEach(async () => {
    fixture = spiedFixtureService();
    tokens = new ConfirmTokenService();
    mcp = await startMcp({
      rows: fixtureRows(),
      services: new Map([[FixtureService, fixture.service]]),
      guilds: { [HARNESS_GUILD]: HARNESS_GUILD_NAME, [OTHER_GUILD]: 'Other' },
      tokens,
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await mcp.close();
  });

  const args = (extra: Record<string, unknown> = {}) => ({
    guildId: HARNESS_GUILD,
    id: 7,
    ...extra,
  });

  describe('reads', () => {
    it('check Manage Server with a cacheable answer and name the deployment and server in the result', async () => {
      const reply = await mcp.call('fixture_list', { guildId: HARNESS_GUILD });
      expect(reply.failed).toBe(false);
      expect(mcp.assertManageGuild).toHaveBeenCalledWith(HARNESS_USER, HARNESS_GUILD, {
        fresh: false,
      });
      expect(reply.json()).toMatchObject({
        deployment: 'bot.example.test [production]',
        guild: { id: HARNESS_GUILD, name: HARNESS_GUILD_NAME },
      });
    });

    it('wrap member-written text as untrusted and leave the rest alone', async () => {
      const reply = await mcp.call('fixture_list', { guildId: HARNESS_GUILD });
      expect(reply.json()).toMatchObject({
        data: {
          items: [{ id: 1, count: 2, text: { untrusted: true, text: 'hello <b>world</b>' } }],
        },
      });
    });

    it('run a tool without a server and skip the access check', async () => {
      const reply = await mcp.call('fixture_status');
      expect(reply.failed).toBe(false);
      expect(mcp.assertManageGuild).not.toHaveBeenCalled();
    });

    it('answer a server the person cannot manage and one the bot is not in with the same text, calling no service', async () => {
      const refused = await mcp.call('fixture_list', { guildId: UNKNOWN_GUILD });
      const refusedAgain = await mcp.call('fixture_list', { guildId: '444444444444444499' });
      expect(refused.failed).toBe(true);
      expect(refused.text).toBe(refusedAgain.text);
      expect(refused.text).toContain('GUILD_NOT_FOUND');
      expect(fixture.list).not.toHaveBeenCalled();
    });
  });

  describe('W tools', () => {
    it('ask Discord again, run without a token, and pass the MCP actor to the service', async () => {
      const reply = await mcp.call('fixture_add', { guildId: HARNESS_GUILD, name: 'a' });
      expect(reply.failed).toBe(false);
      expect(mcp.assertManageGuild).toHaveBeenCalledWith(HARNESS_USER, HARNESS_GUILD, {
        fresh: true,
      });
      expect(fixture.add).toHaveBeenCalledWith({ name: 'a' }, false);
    });

    it('preview with dryRun, tell the service so, and issue no token', async () => {
      const reply = await mcp.call('fixture_add', {
        guildId: HARNESS_GUILD,
        name: 'a',
        dryRun: true,
      });
      expect(fixture.add).toHaveBeenCalledWith({ name: 'a' }, true);
      expect(reply.json()).toMatchObject({ data: { dryRun: true, preview: { added: true } } });
      expect(reply.text).not.toContain('confirmToken');
      expect(tokens.size).toBe(0);
    });

    it('refuse a server the person cannot manage before the service is reached', async () => {
      const reply = await mcp.call('fixture_add', { guildId: UNKNOWN_GUILD, name: 'a' });
      expect(reply.failed).toBe(true);
      expect(fixture.add).not.toHaveBeenCalled();
    });
  });

  describe('C tools', () => {
    it('refuse without a token and say where the call would land', async () => {
      const reply = await mcp.call('fixture_remove', args());
      expect(reply.failed).toBe(true);
      expect(reply.text).toContain('bot.example.test [production]');
      expect(reply.text).toContain(`"${HARNESS_GUILD_NAME}" (${HARNESS_GUILD})`);
      expect(reply.text).toContain('dryRun');
      expect(fixture.remove).not.toHaveBeenCalled();
    });

    it('preview with dryRun, return a token, and write nothing itself', async () => {
      const reply = await mcp.call('fixture_remove', args({ dryRun: true }));
      expect(fixture.remove).toHaveBeenCalledWith({ id: 7 }, true);
      const body = reply.json() as { data: { confirmToken: string; expiresInSeconds: number } };
      expect(body.data.confirmToken).toMatch(/^ct_/);
      expect(body.data.expiresInSeconds).toBe(300);
    });

    it('perform with the token, once', async () => {
      const preview = (await mcp.call('fixture_remove', args({ dryRun: true }))).json() as {
        data: { confirmToken: string };
      };
      const confirmToken = preview.data.confirmToken;

      const done = await mcp.call('fixture_remove', args({ confirmToken }));
      expect(done.failed).toBe(false);
      expect(fixture.remove).toHaveBeenLastCalledWith({ id: 7 }, false);

      const again = await mcp.call('fixture_remove', args({ confirmToken }));
      expect(again.failed).toBe(true);
      expect(fixture.remove).toHaveBeenCalledTimes(2);
    });

    it('refuse a token issued for other arguments, another tool, or another key', async () => {
      const elsewhere = tokens.issue(HARNESS_KEY, 'fixture_remove', {
        guildId: HARNESS_GUILD,
        id: 8,
      });
      const otherTool = tokens.issue(HARNESS_KEY, 'fixture_wipe', args());
      const otherKey = tokens.issue(
        '0190a000-0000-7000-8000-0000000000ff',
        'fixture_remove',
        args(),
      );
      for (const { token } of [elsewhere, otherTool, otherKey]) {
        const reply = await mcp.call('fixture_remove', args({ confirmToken: token }));
        expect(reply.failed).toBe(true);
      }
      expect(fixture.remove).not.toHaveBeenCalled();
    });

    it('refuse a token after five minutes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { token } = tokens.issue(HARNESS_KEY, 'fixture_remove', args());
      vi.advanceTimersByTime(CONFIRM_TOKEN_TTL_MS + 1);
      expect((await mcp.call('fixture_remove', args({ confirmToken: token }))).failed).toBe(true);
      expect(fixture.remove).not.toHaveBeenCalled();
    });

    it('give the token back when the server action budget refuses, and only then', async () => {
      const { token } = tokens.issue(HARNESS_KEY, 'fixture_remove', args());
      fixture.remove.mockImplementationOnce(() => {
        throw new ServiceError(ErrorCode.RATE_LIMITED);
      });
      const refused = await mcp.call('fixture_remove', args({ confirmToken: token }));
      expect(refused.failed).toBe(true);
      expect(refused.text).toContain('RATE_LIMITED');
      expect(tokens.size).toBe(1);

      const retried = await mcp.call('fixture_remove', args({ confirmToken: token }));
      expect(retried.failed).toBe(false);
      expect(tokens.size).toBe(0);

      const other = tokens.issue(HARNESS_KEY, 'fixture_remove', args());
      fixture.remove.mockImplementationOnce(() => {
        throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      });
      await mcp.call('fixture_remove', args({ confirmToken: other.token }));
      expect(tokens.size).toBe(0);
    });

    it('treat the guard fields as outside the bound arguments', async () => {
      const { token } = tokens.issue(HARNESS_KEY, 'fixture_remove', args());
      const reply = await mcp.call('fixture_remove', args({ confirmToken: token, dryRun: false }));
      expect(reply.failed).toBe(false);
    });
  });

  describe('CC tools', () => {
    const issue = () => tokens.issue(HARNESS_KEY, 'fixture_wipe', { guildId: HARNESS_GUILD }).token;

    it('refuse a missing or wrong server name without spending the token, then accept the exact one', async () => {
      const confirmToken = issue();
      const missing = await mcp.call('fixture_wipe', { guildId: HARNESS_GUILD, confirmToken });
      const wrong = await mcp.call('fixture_wipe', {
        guildId: HARNESS_GUILD,
        confirmToken,
        confirmGuildName: 'study group',
      });
      expect(missing.failed).toBe(true);
      expect(wrong.failed).toBe(true);
      expect(wrong.text).toContain('confirmGuildName');
      expect(fixture.wipe).not.toHaveBeenCalled();

      const done = await mcp.call('fixture_wipe', {
        guildId: HARNESS_GUILD,
        confirmToken,
        confirmGuildName: HARNESS_GUILD_NAME,
      });
      expect(done.failed).toBe(false);
      expect(fixture.wipe).toHaveBeenCalledWith(HARNESS_GUILD, false);
    });
  });

  it('hide the message of an unexpected error and keep the arguments out of it', async () => {
    fixture.list.mockImplementationOnce(() => {
      throw new Error('relation "Birthday" does not exist, password=hunter2');
    });
    const reply = await mcp.call('fixture_list', { guildId: HARNESS_GUILD });
    expect(reply.failed).toBe(true);
    expect(reply.text).toContain('INTERNAL');
    expect(reply.text).not.toContain('relation');
    expect(reply.text).not.toContain('hunter2');
  });

  it('turn a bad input into a tool error before any handler runs', async () => {
    const reply = await mcp.call('fixture_add', { guildId: 'not-a-snowflake', name: 'a' });
    expect(reply.failed).toBe(true);
    expect(fixture.add).not.toHaveBeenCalled();
    expect(mcp.assertManageGuild).not.toHaveBeenCalled();
  });
});

describe('ok', () => {
  it('serialises without a target and marks nested untrusted text through arrays and wildcards', () => {
    const result = ok(
      {
        rows: [
          { note: 'a', n: 1 },
          { note: 'b', n: 2 },
        ],
        by: { x: { name: 'z' } },
      },
      { untrusted: ['rows.note', 'by.*.name'] },
    );
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({
      rows: [
        { note: { untrusted: true, text: 'a' }, n: 1 },
        { note: { untrusted: true, text: 'b' }, n: 2 },
      ],
      by: { x: { name: { untrusted: true, text: 'z' } } },
    });
  });

  it('leaves null and missing fields alone', () => {
    const result = ok({ rows: [{ note: null }, {}] }, { untrusted: ['rows.note'] });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ rows: [{ note: null }, {}] });
  });
});
