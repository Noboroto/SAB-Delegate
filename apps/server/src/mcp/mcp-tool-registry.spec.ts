import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { z } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import { AuditService } from '../common/audit/audit.service.js';
import { GuildActionLimiter } from '../common/limiter/guild-action.limiter.js';
import { DISCORD_FEATURE_MODULES } from '../modules/feature-modules.js';
import { FixtureService, HARNESS_GUILD, fixtureRows, startMcp } from './mcp.test-harness.js';
import { checkToolRow, defineTool, type AnyToolRow } from './tool-definition.js';
import { annotationsFor } from './tool-guard.js';
import { DOMAIN_TOOL_TABLES, TOOL_REGISTRY } from './tool-registry.js';
import { toolInputSchema } from './write-guard.js';

/** Every provider class of the application, by name: what a row's `service` can point at. */
function applicationServices(): Map<string, Type> {
  const classes = new Map<string, Type>();
  for (const module of DISCORD_FEATURE_MODULES) {
    const providers = (Reflect.getMetadata('providers', module) ?? []) as unknown[];
    for (const provider of providers) {
      if (typeof provider === 'function') classes.set(provider.name, provider as Type);
    }
  }
  classes.set(GuildActionLimiter.name, GuildActionLimiter);
  // Provided by `AuditModule`, which the feature modules import rather than list.
  classes.set(AuditService.name, AuditService);
  return classes;
}

const services = applicationServices();
const fixtureServices = new Map<string, Type>([...services, [FixtureService.name, FixtureService]]);

const snowflake = z.string().regex(/^\d{17,20}$/);
const GOOD_DESCRIPTION = 'Adds a fixture item. Can be undone with fixture_remove.';

function withRow(overrides: Partial<AnyToolRow>): AnyToolRow {
  const base = fixtureRows().find((row) => row.name === 'fixture_add');
  if (base === undefined) throw new Error('fixture_add is missing');
  return { ...base, ...overrides };
}

describe('the tool registry', () => {
  it('is the concatenation of the domain tables and nothing else', () => {
    expect(TOOL_REGISTRY).toEqual(DOMAIN_TOOL_TABLES.flat());
  });

  it('has unique snake_case names', () => {
    const names = TOOL_REGISTRY.map((row) => row.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('passes every row through the checker', () => {
    expect(TOOL_REGISTRY.flatMap((row) => checkToolRow(row, services))).toEqual([]);
  });

  it('registers exactly the rows for a WRITE key, each with the annotations of its class', async () => {
    const mcp = await startMcp({ rows: TOOL_REGISTRY, mode: 'WRITE' });
    try {
      expect([...mcp.registeredTools].sort()).toEqual(TOOL_REGISTRY.map((row) => row.name).sort());
      for (const row of TOOL_REGISTRY) {
        const tool = mcp.tools.find((candidate) => candidate.name === row.name);
        expect(tool?.annotations).toMatchObject(annotationsFor(row.class));
        expect(tool?.inputSchema).toBeDefined();
      }
    } finally {
      await mcp.close();
    }
  });

  it('shows a READ key no tool that writes', async () => {
    const mcp = await startMcp({ rows: TOOL_REGISTRY, mode: 'READ' });
    try {
      const classes = new Map(TOOL_REGISTRY.map((row) => [row.name, row.class]));
      for (const name of mcp.registeredTools) expect(classes.get(name)).toBe('R');
    } finally {
      await mcp.close();
    }
  });
});

describe('the row checker', () => {
  it('accepts the fixture rows of every class', () => {
    for (const row of fixtureRows()) expect(checkToolRow(row, fixtureServices)).toEqual([]);
  });

  it('fails a row without an input schema', () => {
    const row = Object.assign(withRow({}), { inputSchema: undefined });
    expect(checkToolRow(row, fixtureServices)).toContain('fixture_add: no input schema');
  });

  it('fails a service that is not a provider, and a method that does not exist', () => {
    expect(
      checkToolRow(withRow({ service: 'NoSuchService.add' }), fixtureServices).join(),
    ).toContain('is not a provider');
    expect(
      checkToolRow(withRow({ service: 'FixtureService.nothing' }), fixtureServices).join(),
    ).toContain('is not a method');
  });

  it.each(['W', 'C', 'CC'] as const)(
    'fails a %s tool built without its guard fields',
    (toolClass) => {
      const row = withRow({
        class: toolClass,
        inputSchema: z.object({ guildId: snowflake, name: z.string() }),
      });
      const problems = checkToolRow(row, fixtureServices).join();
      expect(problems).toContain('lacks the guard field dryRun');
      if (toolClass !== 'W') expect(problems).toContain('confirmToken');
      if (toolClass === 'CC') expect(problems).toContain('confirmGuildName');
    },
  );

  it('fails a read tool that carries guard fields, and a W tool that asks for a token', () => {
    const read = withRow({
      class: 'R',
      audit: undefined,
      inputSchema: toolInputSchema('W', { guildId: snowflake }),
    });
    expect(checkToolRow(read, fixtureServices).join()).toContain('must not take dryRun');
    const write = withRow({ inputSchema: toolInputSchema('C', { guildId: snowflake }) });
    expect(checkToolRow(write, fixtureServices).join()).toContain('must not take confirmToken');
  });

  it('fails a write tool without an audit action, an unknown one, and a read tool with one', () => {
    expect(checkToolRow(withRow({ audit: undefined }), fixtureServices).join()).toContain(
      'no audit action',
    );
    expect(checkToolRow(withRow({ audit: 'made.up' as never }), fixtureServices).join()).toContain(
      'unknown audit action',
    );
    const read = fixtureRows().find((row) => row.name === 'fixture_list');
    expect(
      checkToolRow({ ...(read as AnyToolRow), audit: 'birthday.add' }, fixtureServices).join(),
    ).toContain('read tool must not name an audit action');
  });

  it('fails a confirm-class tool that takes no guildId', () => {
    const row = withRow({
      class: 'C',
      audit: 'birthday.remove',
      inputSchema: toolInputSchema('C', {}),
    });
    expect(checkToolRow(row, fixtureServices).join()).toContain('must take guildId');
  });

  it('fails descriptions that hide the undo story or the untrusted text', () => {
    expect(
      checkToolRow(
        withRow({ description: 'Adds one item to the server list.' }),
        fixtureServices,
      ).join(),
    ).toContain('undone');
    const read = fixtureRows().find((row) => row.name === 'fixture_list') as AnyToolRow;
    expect(
      checkToolRow(
        { ...read, description: 'Lists the fixture items of a server.' },
        fixtureServices,
      ).join(),
    ).toContain('untrusted');
  });

  it.each([
    'Removes a fixture item. Cannot be undone.',
    'Removes it. Use dryRun to preview. Cannot be undone.',
  ])(
    'fails a confirm-class description that does not send the caller to dryRun for a confirmToken: %s',
    (description) => {
      const remove = fixtureRows().find((row) => row.name === 'fixture_remove') as AnyToolRow;
      expect(checkToolRow({ ...remove, description }, fixtureServices).join()).toContain(
        'call dryRun first',
      );
    },
  );

  it('fails a name that is not noun_verb snake case', () => {
    expect(checkToolRow(withRow({ name: 'AddThing' }), fixtureServices).join()).toContain(
      'snake_case',
    );
  });

  it('stays green when a valid tool is added as one more row', async () => {
    const extra = defineTool({
      name: 'fixture_touch',
      class: 'W',
      service: 'FixtureService.add',
      inputSchema: toolInputSchema('W', { guildId: snowflake }),
      description: GOOD_DESCRIPTION,
      audit: 'birthday.add',
      handler: ({ service }) => Promise.resolve(service(FixtureService).add({ name: 'x' }, false)),
    });
    expect(checkToolRow(extra, fixtureServices)).toEqual([]);
    const rows = [...fixtureRows(), extra];
    const mcp = await startMcp({
      rows,
      services: new Map([[FixtureService, new FixtureService()]]),
    });
    try {
      expect(mcp.registeredTools.has('fixture_touch')).toBe(true);
      const reply = await mcp.call('fixture_touch', { guildId: HARNESS_GUILD });
      expect(reply.failed).toBe(false);
    } finally {
      await mcp.close();
    }
  });
});
