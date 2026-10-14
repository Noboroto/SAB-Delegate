import { describe, expect, it } from 'vitest';
import {
  FixtureService,
  spiedFixtureService,
  HARNESS_GUILD,
  fixtureRows,
  startMcp,
  type HarnessServices,
} from './mcp.test-harness.js';
import { annotationsFor, toolGuard } from './tool-guard.js';

function stubs() {
  const fixture = spiedFixtureService();
  const services: HarnessServices = new Map([[FixtureService, fixture.service]]);
  return { services, fixture };
}

describe('toolGuard', () => {
  const read = { mode: 'READ' } as never;
  const write = { mode: 'WRITE' } as never;

  it('shows reads to both kinds of key and writes to a WRITE key only', () => {
    expect(toolGuard(read, 'R').visible).toBe(true);
    for (const toolClass of ['W', 'C', 'CC'] as const) {
      expect(toolGuard(read, toolClass).visible).toBe(false);
      expect(toolGuard(write, toolClass).visible).toBe(true);
    }
  });

  it('refuses a write for a READ key whatever was visible', () => {
    expect(() => toolGuard(read, 'C').require()).toThrow();
    expect(() => toolGuard(read, 'R').require()).not.toThrow();
    expect(() => toolGuard(write, 'CC').require()).not.toThrow();
  });
});

describe('annotationsFor', () => {
  it('marks reads read-only and only confirm classes destructive', () => {
    expect(annotationsFor('R')).toEqual({ readOnlyHint: true });
    expect(annotationsFor('W')).toEqual({ readOnlyHint: false, destructiveHint: false });
    expect(annotationsFor('C')).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(annotationsFor('CC')).toEqual({ readOnlyHint: false, destructiveHint: true });
  });
});

describe('tools/list for each kind of key', () => {
  it('shows a READ key the read tools only', async () => {
    const { services } = stubs();
    const mcp = await startMcp({ rows: fixtureRows(), mode: 'READ', services });
    try {
      expect([...mcp.registeredTools].sort()).toEqual(['fixture_list', 'fixture_status']);
      for (const tool of mcp.tools) expect(tool.annotations?.readOnlyHint).toBe(true);
    } finally {
      await mcp.close();
    }
  });

  it('shows a WRITE key every tool with the annotations of its class', async () => {
    const { services } = stubs();
    const rows = fixtureRows();
    const mcp = await startMcp({ rows, mode: 'WRITE', services });
    try {
      expect([...mcp.registeredTools].sort()).toEqual(rows.map((row) => row.name).sort());
      for (const row of rows) {
        const tool = mcp.tools.find((candidate) => candidate.name === row.name);
        expect(tool?.annotations).toMatchObject(annotationsFor(row.class));
      }
    } finally {
      await mcp.close();
    }
  });
});

describe('a handler still refuses what the filter would have hidden', () => {
  it('refuses a write tool called by a key that is READ at call time, without touching the service', async () => {
    const { services, fixture } = stubs();
    const mcp = await startMcp({ rows: fixtureRows(), mode: 'WRITE', services });
    try {
      mcp.caller.mode = 'READ';
      for (const [name, args] of [
        ['fixture_add', { guildId: HARNESS_GUILD, name: 'x' }],
        ['fixture_remove', { guildId: HARNESS_GUILD, id: 1, dryRun: true }],
        ['fixture_wipe', { guildId: HARNESS_GUILD, dryRun: true }],
      ] as const) {
        const reply = await mcp.call(name, args);
        expect(reply.failed).toBe(true);
        expect(reply.text).toContain('AUTH_API_KEY_READ_ONLY');
      }
      expect(fixture.add).not.toHaveBeenCalled();
      expect(fixture.remove).not.toHaveBeenCalled();
      expect(fixture.wipe).not.toHaveBeenCalled();
      expect(mcp.assertManageGuild).not.toHaveBeenCalled();
    } finally {
      await mcp.close();
    }
  });
});
