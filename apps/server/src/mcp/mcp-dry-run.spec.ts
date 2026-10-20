import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { z } from '@sab/shared';
import {
  FixtureService,
  HARNESS_GUILD,
  startMcp,
  type HarnessServices,
} from './mcp.test-harness.js';
import { defineTool, type AnyToolRow } from './tool-definition.js';
import { isWriteClass } from './tool-guard.js';
import { TOOL_REGISTRY } from './tool-registry.js';
import { toolInputSchema } from './write-guard.js';

const CHANNEL = '555555555555555551';
const MESSAGE = '555555555555555552';
const USER = '555555555555555553';
const LIST = '0190a000-0000-7000-8000-000000000001';

/** Valid arguments of every tool that writes; a new write tool fails the coverage test until it has a line here. */
const DRY_RUN_ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  birthday_add: { studentId: 'S1', name: 'An', discordId: USER, month: 3, day: 14 },
  birthday_remove: { studentId: 'S1' },
  birthday_import: {
    rows: [{ studentId: 'S1', name: 'An', discordId: USER, month: 3, day: 14 }],
  },
  note_upsert: { roleId: CHANNEL, topic: 'Rules', content: 'text' },
  note_delete: { roleId: CHANNEL, topic: 'Rules' },
  guild_config_set: { logChannelId: CHANNEL },
  bot_profile_set: { nick: 'Sabi' },
  wordgame_config_set: { maxWords: 300 },
  wordgame_reset: {},
  message_send: { channelId: CHANNEL, content: 'hello' },
  message_edit: { channelId: CHANNEL, messageId: MESSAGE, content: 'hello' },
  poll_create: { channelId: CHANNEL, choices: 3 },
  schedule_create: { channelId: CHANNEL, content: 'hello', runAt: '2099-01-01T00:00:00Z' },
  schedule_cancel: { seq: 3 },
  chatbot_config_set: { enabled: true },
  chatbot_channel_add: { channelId: CHANNEL },
  chatbot_channel_remove: { channelId: CHANNEL },
  chatbot_quota_set: { userId: USER, limit: 500 },
  chatbot_quota_grant: { userId: USER, tokens: 100 },
  chatbot_quota_reset: { userId: USER },
  chatbot_memory_clear: { scope: 'all' },
  chatbot_turn_delete: { scope: 'all' },
  email_verify_config_set: { enabled: true },
  email_verify_rules_set: {
    rules: [
      {
        condition: {
          combinator: 'and',
          rules: [{ field: 'domain', operator: '=', value: 'example.edu' }],
        },
        roleIds: [CHANNEL],
      },
    ],
  },
  email_verify_blocklist_set: { patterns: ['*@mailinator.com'] },
  email_list_create: { name: 'k21' },
  email_list_delete: { listId: LIST },
  email_list_entries_add: { listId: LIST, emails: ['an@example.edu'] },
  email_list_entries_remove: { listId: LIST, emails: ['an@example.edu'] },
  email_verify_member_verify: { userId: USER, email: 'an@example.edu' },
  email_verify_member_revoke: { userId: USER },
};

type Call = { target: string; args: unknown[] };

/** An answer that tolerates whatever a handler does with it afterwards (`result.runAt.toISOString()`). */
function anything(): unknown {
  const target = (): unknown => undefined;
  return new Proxy(target, {
    get: (_t, key) => {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      if (key === 'toJSON') return () => null;
      if (key === 'runAt') return new Date(0);
      return anything();
    },
    apply: () => anything(),
  });
}

/** Services that record every method called on them and answer with {@link anything}. */
function recordingServices(calls: Call[]): HarnessServices {
  return {
    has: () => true,
    get: (token: { name: string }) =>
      new Proxy(
        {},
        {
          get: (_t, method) =>
            typeof method === 'symbol'
              ? undefined
              : (...args: unknown[]) => {
                  calls.push({ target: `${token.name}.${method}`, args });
                  return Promise.resolve(anything());
                },
        },
      ),
  } as unknown as HarnessServices;
}

const hasDryRun = (args: unknown[]): boolean =>
  args.some(
    (arg) =>
      arg === true ||
      (typeof arg === 'object' && arg !== null && (arg as { dryRun?: unknown }).dryRun === true),
  );

/** What is wrong with a dry-run call of each row: the service not reached with `dryRun`, or something else called. */
async function dryRunProblems(rows: readonly AnyToolRow[], args: (row: AnyToolRow) => object) {
  const problems: string[] = [];
  for (const row of rows) {
    const calls: Call[] = [];
    const mcp = await startMcp({ rows: [row], mode: 'WRITE', services: recordingServices(calls) });
    try {
      await mcp.call(row.name, { guildId: HARNESS_GUILD, ...args(row), dryRun: true });
    } finally {
      await mcp.close();
    }
    const own = calls.filter((call) => call.target === row.service);
    if (own.length === 0) problems.push(`${row.name}: ${row.service} was not called`);
    else if (!own.some((call) => hasDryRun(call.args))) {
      problems.push(`${row.name}: ${row.service} was not told dryRun`);
    }
    const others = calls.filter((call) => call.target !== row.service).map((call) => call.target);
    if (others.length > 0) problems.push(`${row.name}: also called ${others.join(', ')}`);
  }
  return problems;
}

describe('dryRun reaches the service of every write tool', () => {
  const writeRows = TOOL_REGISTRY.filter((row) => isWriteClass(row.class));

  it('has valid sample arguments for exactly the write tools', () => {
    expect(Object.keys(DRY_RUN_ARGS).sort()).toEqual(writeRows.map((row) => row.name).sort());
    for (const row of writeRows) {
      const parsed = row.inputSchema.safeParse({
        guildId: HARNESS_GUILD,
        ...DRY_RUN_ARGS[row.name],
        dryRun: true,
      });
      expect(parsed.success, `${row.name}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('calls only the tool service, with dryRun: true, for every W, C and CC row', async () => {
    expect(await dryRunProblems(writeRows, (row) => DRY_RUN_ARGS[row.name] ?? {})).toEqual([]);
  });

  describe('the check itself', () => {
    const defect = (handler: AnyToolRow['handler']): AnyToolRow =>
      defineTool({
        name: 'fixture_add',
        class: 'W',
        service: 'FixtureService.add',
        inputSchema: toolInputSchema('W', { guildId: z.string() }),
        description: 'Adds a fixture item. Can be undone with fixture_remove.',
        audit: 'birthday.add',
        handler,
      });

    it('flags a handler that forgets dryRun and one that calls another method', async () => {
      const forgetful = defect(({ service }) =>
        Promise.resolve(service(FixtureService).add({ name: 'x' }, false)),
      );
      expect(await dryRunProblems([forgetful], () => ({}))).toEqual([
        'fixture_add: FixtureService.add was not told dryRun',
      ]);
      const wanders = defect(({ dryRun, service }) => {
        service(FixtureService).remove({ id: 1 }, false);
        return Promise.resolve(service(FixtureService).add({ name: 'x' }, dryRun));
      });
      expect(await dryRunProblems([wanders], () => ({}))).toEqual([
        'fixture_add: also called FixtureService.remove',
      ]);
    });
  });
});
