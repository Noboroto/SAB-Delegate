import { describe, expect, it } from 'vitest';
import { ActorContextSchema } from './actor.js';
import { AUDIT_ACTIONS, AuditActionSchema } from './audit-actions.js';

const USER = '123456789012345678';

describe('ActorContextSchema', () => {
  it('accepts a person acting through each door', () => {
    for (const source of ['DISCORD', 'HTTP', 'MCP'] as const) {
      expect(ActorContextSchema.safeParse({ source, userId: USER }).success).toBe(true);
    }
  });

  it('accepts background work with no person', () => {
    expect(ActorContextSchema.safeParse({ source: 'SYSTEM' }).success).toBe(true);
  });

  it('requires a person for every source but SYSTEM', () => {
    const result = ActorContextSchema.safeParse({ source: 'MCP' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['userId']);
  });

  it('keeps the api key, address and agent, and strips anything else', () => {
    const apiKeyId = '0190a0a0-0000-7000-8000-000000000000';
    expect(
      ActorContextSchema.parse({
        source: 'MCP',
        userId: USER,
        apiKeyId,
        ip: '203.0.113.7',
        ua: 'agent/1',
        extra: 'dropped',
      }),
    ).toEqual({ source: 'MCP', userId: USER, apiKeyId, ip: '203.0.113.7', ua: 'agent/1' });
  });

  it('rejects an id that is not a snowflake or an api key that is not a uuid', () => {
    expect(ActorContextSchema.safeParse({ source: 'DISCORD', userId: '<@123>' }).success).toBe(
      false,
    );
    expect(
      ActorContextSchema.safeParse({ source: 'MCP', userId: USER, apiKeyId: 'key' }).success,
    ).toBe(false);
  });
});

describe('AUDIT_ACTIONS', () => {
  const values = Object.values(AUDIT_ACTIONS);

  it('has no two keys sharing a stored value', () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it('spells every value as lower_snake `area.verb`, since the strings are stored', () => {
    for (const value of values) expect(value).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('validates through its schema', () => {
    expect(AuditActionSchema.safeParse(AUDIT_ACTIONS.guildConfigUpdate).success).toBe(true);
    expect(AuditActionSchema.safeParse('guild_config.rename').success).toBe(false);
  });
});
