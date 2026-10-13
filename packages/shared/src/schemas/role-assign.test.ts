import { describe, expect, it } from 'vitest';
import {
  ROLE_ASSIGN_MAX_USER_IDS,
  RoleAssignMembersInputSchema,
  RoleAssignReactorsInputSchema,
} from './role-assign.js';

// Built at runtime: a literal 18-digit id next to an id field trips the secret scanner.
const ID = '1234567890'.repeat(2).slice(0, 18);
const OTHER_ID = '9876543210'.repeat(2).slice(0, 18);

describe('RoleAssignMembersInputSchema', () => {
  it('needs a list of ids or a role to take the members from', () => {
    expect(RoleAssignMembersInputSchema.safeParse({ roleId: ID }).success).toBe(false);
    expect(RoleAssignMembersInputSchema.safeParse({ roleId: ID, userIds: [] }).success).toBe(false);
    expect(
      RoleAssignMembersInputSchema.safeParse({ roleId: ID, userIds: [OTHER_ID] }).success,
    ).toBe(true);
    expect(
      RoleAssignMembersInputSchema.safeParse({ roleId: ID, membersOfRoleId: OTHER_ID }).success,
    ).toBe(true);
  });

  it('gives a role rather than takes it unless told otherwise', () => {
    const parsed = RoleAssignMembersInputSchema.parse({ roleId: ID, userIds: [OTHER_ID] });
    expect(parsed.remove).toBe(false);
  });

  it('refuses a list longer than anyone types', () => {
    const userIds = Array.from({ length: ROLE_ASSIGN_MAX_USER_IDS + 1 }, () => OTHER_ID);
    expect(RoleAssignMembersInputSchema.safeParse({ roleId: ID, userIds }).success).toBe(false);
  });

  it('refuses a mention in place of an id', () => {
    expect(
      RoleAssignMembersInputSchema.safeParse({ roleId: ID, userIds: [`<@${OTHER_ID}>`] }).success,
    ).toBe(false);
  });
});

describe('RoleAssignReactorsInputSchema', () => {
  it('trims the emoji and defaults to giving the role', () => {
    const parsed = RoleAssignReactorsInputSchema.parse({
      roleId: ID,
      channelId: ID,
      messageId: OTHER_ID,
      emoji: ' ✅ ',
    });
    expect(parsed).toMatchObject({ emoji: '✅', remove: false });
  });

  it('rejects a blank emoji', () => {
    expect(
      RoleAssignReactorsInputSchema.safeParse({
        roleId: ID,
        channelId: ID,
        messageId: ID,
        emoji: ' ',
      }).success,
    ).toBe(false);
  });
});
