import { describe, expect, it } from 'vitest';
import { canManageGuild } from './can-manage-guild.js';

const MANAGE_GUILD = (1n << 5n).toString();
const ADMINISTRATOR = (1n << 3n).toString();
const SEND_MESSAGES = (1n << 11n).toString();
// Every permission bit up to 2^50 set, which is beyond Number.MAX_SAFE_INTEGER.
const ALL_BITS = ((1n << 51n) - 1n).toString();

describe('canManageGuild', () => {
  it('allows Manage Server', () => {
    expect(canManageGuild({ permissions: MANAGE_GUILD, isOwner: false })).toBe(true);
  });

  it('allows Administrator', () => {
    expect(canManageGuild({ permissions: ADMINISTRATOR, isOwner: false })).toBe(true);
  });

  it('allows the owner with no permission bits at all', () => {
    expect(canManageGuild({ permissions: '0', isOwner: true })).toBe(true);
  });

  it('refuses a member who can only send messages', () => {
    expect(canManageGuild({ permissions: SEND_MESSAGES, isOwner: false })).toBe(false);
  });

  it('refuses an empty permission set', () => {
    expect(canManageGuild({ permissions: '0', isOwner: false })).toBe(false);
  });

  it('reads bits above the safe integer range', () => {
    expect(canManageGuild({ permissions: ALL_BITS, isOwner: false })).toBe(true);
    const highOnly = (1n << 50n).toString();
    expect(canManageGuild({ permissions: highOnly, isOwner: false })).toBe(false);
    const highPlusManage = ((1n << 50n) | (1n << 5n)).toString();
    expect(canManageGuild({ permissions: highPlusManage, isOwner: false })).toBe(true);
  });

  it('fails closed on values that are not a decimal permission string', () => {
    for (const permissions of ['', '-1', '0x20', '32.5', ' 32', 'abc', '9'.repeat(30)]) {
      expect(canManageGuild({ permissions, isOwner: false }), permissions).toBe(false);
      expect(canManageGuild({ permissions, isOwner: true }), permissions).toBe(false);
    }
  });
});
