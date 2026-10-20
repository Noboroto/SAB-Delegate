import { ROLES_MAX } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import type { RuleGroupType } from 'react-querybuilder';
import { conditionToQuery, queryToCondition } from './condition-query';
import {
  draftFromRule,
  newDraft,
  resolveDraft,
  testEmailAccess,
  toBuilderMode,
  toTextMode,
} from './rule-draft';

const ROLE = '5'.repeat(18);
const OTHER_ROLE = '6'.repeat(18);

const CONDITION = {
  combinator: 'or' as const,
  rules: [
    {
      combinator: 'and' as const,
      rules: [
        { field: 'domain' as const, operator: '=' as const, value: '*.edu' },
        { field: 'invite' as const, operator: '=' as const, value: 'k21' },
      ],
    },
    { field: 'list' as const, operator: '=' as const, value: 'staff' },
  ],
};

describe('condition <-> builder state', () => {
  it('maps a condition to the builder shape and back without loss', () => {
    const query = conditionToQuery(CONDITION);
    expect(query).toEqual({
      combinator: 'or',
      rules: [
        {
          combinator: 'and',
          rules: [
            { field: 'domain', operator: '=', value: '*.edu' },
            { field: 'invite', operator: '=', value: 'k21' },
          ],
        },
        { field: 'list', operator: '=', value: 'staff' },
      ],
    });
    expect(queryToCondition(query)).toEqual({ ok: true, condition: CONDITION });
  });

  it('strips the ids and other keys the builder adds, and normalises the values', () => {
    const query = {
      id: 'g-1',
      combinator: 'and',
      not: false,
      rules: [
        { id: 'r-1', field: 'domain', operator: '=', value: '@HCMUS.edu.vn', valueSource: 'value' },
        { id: 'r-2', field: 'invite', operator: '=', value: 'https://discord.gg/abc123' },
      ],
    } as RuleGroupType;
    const built = queryToCondition(query);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.condition).toEqual({
        combinator: 'and',
        rules: [
          { field: 'domain', operator: '=', value: 'hcmus.edu.vn' },
          { field: 'invite', operator: '=', value: 'abc123' },
        ],
      });
    }
  });

  it.each([
    [
      'an empty value',
      { combinator: 'and', rules: [{ field: 'domain', operator: '=', value: '' }] },
      'INVALID_VALUE',
    ],
    ['an empty group', { combinator: 'and', rules: [] }, 'EMPTY'],
    [
      'a value the field refuses',
      { combinator: 'or', rules: [{ field: 'list', operator: '=', value: 'No Spaces' }] },
      'INVALID_VALUE',
    ],
  ])('says why %s is not a condition', (_label, query, issue) => {
    expect(queryToCondition(query as RuleGroupType)).toEqual({ ok: false, issue });
  });

  it('refuses groups nested past the depth limit', () => {
    const leaf = { field: 'domain', operator: '=', value: 'a.com' };
    let query: unknown = { combinator: 'and', rules: [leaf] };
    for (let level = 0; level < 4; level += 1) query = { combinator: 'or', rules: [query] };
    expect(queryToCondition(query as RuleGroupType)).toEqual({ ok: false, issue: 'TOO_DEEP' });
  });
});

describe('rule drafts', () => {
  const draft = draftFromRule({ condition: CONDITION, roleIds: [ROLE] }, 1);

  it('shows the same rule in the builder and in the text form', () => {
    const text = toTextMode(draft);
    expect(text.mode).toBe('text');
    expect(text.text).toBe('domain:*.edu AND invite:k21 OR list:staff');
    const back = toBuilderMode(text);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(resolveDraft(back.draft)).toEqual({
        ok: true,
        rule: { condition: CONDITION, roleIds: [ROLE] },
      });
    }
  });

  it('stays in text, with the position of the mistake, when the text cannot be read', () => {
    const broken = { ...draft, mode: 'text' as const, text: 'domain:*.edu AND' };
    const result = toBuilderMode(broken);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ kind: 'text', code: 'EXPECTED_CONDITION' });
  });

  it('keeps the old text when the builder is incomplete', () => {
    const incomplete = { ...newDraft(2), text: 'list:old' };
    expect(toTextMode(incomplete).text).toBe('list:old');
  });

  it('resolves a text draft with the shared parser', () => {
    const resolved = resolveDraft({
      ...newDraft(3),
      mode: 'text',
      text: 'domain:*.edu OR email:*@a.com',
      roleIds: [OTHER_ROLE],
    });
    expect(resolved.ok).toBe(true);
  });
});

describe('testEmailAccess', () => {
  const rule = draftFromRule(
    {
      condition: { combinator: 'or', rules: [{ field: 'domain', operator: '=', value: '*.edu' }] },
      roleIds: [ROLE],
    },
    1,
  );
  const base = {
    drafts: [rule],
    invite: '',
    blockPatterns: ['*@mailinator.com'],
    defaultRoleIds: [OTHER_ROLE],
  };

  it('accepts a matching address and grants the default and the rule roles', () => {
    const { result } = testEmailAccess({ ...base, email: 'an@hcmus.edu' });
    expect(result.status).toBe('ACCEPTED');
    expect(new Set(result.roleIds)).toEqual(new Set([ROLE, OTHER_ROLE]));
  });

  it('refuses an address no rule holds for, a blocked one and a malformed one', () => {
    expect(testEmailAccess({ ...base, email: 'an@gmail.com' }).result.status).toBe('NOT_ACCEPTED');
    expect(testEmailAccess({ ...base, email: 'x@mailinator.com' }).result.status).toBe('BLOCKED');
    expect(testEmailAccess({ ...base, email: 'nope' }).result.status).toBe('INVALID');
  });

  it('leaves out a rule that has an error and says so', () => {
    const outcome = testEmailAccess({
      ...base,
      drafts: [rule, newDraft(9)],
      email: 'an@hcmus.edu',
    });
    expect(outcome.skipped).toBe(1);
    expect(outcome.result.status).toBe('ACCEPTED');
  });

  it('cannot know list membership, and flags it', () => {
    const listRule = draftFromRule(
      {
        condition: { combinator: 'and', rules: [{ field: 'list', operator: '=', value: 'k21' }] },
        roleIds: [],
      },
      4,
    );
    const outcome = testEmailAccess({ ...base, drafts: [listRule], email: 'an@hcmus.edu' });
    expect(outcome.usesLists).toBe(true);
    expect(outcome.result.status).toBe('NOT_ACCEPTED');
  });

  it('reads an invite link given as a link', () => {
    const inviteRule = draftFromRule(
      {
        condition: { combinator: 'and', rules: [{ field: 'invite', operator: '=', value: 'k21' }] },
        roleIds: [ROLE],
      },
      5,
    );
    const outcome = testEmailAccess({
      ...base,
      drafts: [inviteRule],
      email: 'an@gmail.com',
      invite: 'https://discord.gg/k21',
    });
    expect(outcome.result.status).toBe('ACCEPTED');
    expect(outcome.result.roleIds).toContain(ROLE);
  });
});

describe('resolveDraft roles', () => {
  it('refuses more roles than a rule may grant', () => {
    const draft = {
      ...newDraft(1),
      mode: 'text' as const,
      text: 'domain:*.edu',
      roleIds: Array.from({ length: ROLES_MAX + 1 }, () => ROLE),
    };
    expect(resolveDraft(draft)).toEqual({ ok: false, error: { kind: 'roles' } });
    expect(resolveDraft({ ...draft, roleIds: draft.roleIds.slice(0, ROLES_MAX) }).ok).toBe(true);
  });
});
