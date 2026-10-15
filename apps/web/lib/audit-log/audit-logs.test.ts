import { AUDIT_ACTIONS } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_KEYS, auditLogsQueryString, parseAuditLogsFilter } from './audit-logs';

const CURSOR = '0199c0a8-1111-7222-8333-444455556666';

describe('parseAuditLogsFilter', () => {
  it('keeps a known action and a well-formed cursor', () => {
    expect(parseAuditLogsFilter({ action: 'note.upsert', cursor: CURSOR })).toEqual({
      action: 'note.upsert',
      cursor: CURSOR,
    });
  });

  it('keeps a known source and drops an unknown one', () => {
    expect(parseAuditLogsFilter({ source: 'MCP' })).toEqual({ source: 'MCP' });
    expect(parseAuditLogsFilter({ source: 'ROOT' })).toEqual({});
  });

  it('drops values the server would refuse', () => {
    expect(parseAuditLogsFilter({ action: 'rm -rf', cursor: 'abc' })).toEqual({});
    expect(parseAuditLogsFilter({ action: ['note.upsert', 'x'] })).toEqual({});
    expect(parseAuditLogsFilter({})).toEqual({});
  });
});

describe('auditLogsQueryString', () => {
  it('is empty without a filter and encodes the rest', () => {
    expect(auditLogsQueryString({})).toBe('');
    expect(auditLogsQueryString({ action: 'note.upsert', cursor: CURSOR })).toBe(
      `?action=note.upsert&cursor=${CURSOR}`,
    );
    expect(auditLogsQueryString({ source: 'HTTP' })).toBe('?source=HTTP');
  });
});

describe('AUDIT_ACTION_KEYS', () => {
  it('maps every stored action to its catalog key', () => {
    for (const [key, value] of Object.entries(AUDIT_ACTIONS)) {
      expect(AUDIT_ACTION_KEYS[value]).toBe(key);
    }
  });
});
