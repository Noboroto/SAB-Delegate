import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  evaluateEmailAccess,
  evaluateJoin,
  type AccessFacts,
} from './condition-eval.js';
import { parseCondition } from './condition-text.js';

function cond(text: string) {
  const result = parseCondition(text);
  if (!result.ok) throw new Error(text);
  return result.condition;
}

const EMPTY = new Set<string>();
const facts = (over: Partial<AccessFacts> = {}): AccessFacts => ({
  email: 'ann@hcmus.edu.vn',
  listHits: EMPTY,
  inviteCode: null,
  ...over,
});

describe('evaluateCondition', () => {
  it('matches a domain wildcard on the part after the @', () => {
    expect(evaluateCondition(cond('domain:*.edu.vn'), facts())).toBe(true);
    expect(evaluateCondition(cond('domain:edu.vn'), facts())).toBe(false);
    expect(evaluateCondition(cond('domain:ann*'), facts())).toBe(false);
  });

  it('matches an email wildcard on the whole address', () => {
    expect(evaluateCondition(cond('email:ann@*'), facts())).toBe(true);
    expect(evaluateCondition(cond('email:*@hcmus.edu.vn'), facts())).toBe(true);
    expect(evaluateCondition(cond('email:bob@*'), facts())).toBe(false);
  });

  it('looks lists up by name and invites by exact code', () => {
    expect(evaluateCondition(cond('list:k21'), facts({ listHits: new Set(['k21']) }))).toBe(true);
    expect(evaluateCondition(cond('list:k21'), facts())).toBe(false);
    expect(evaluateCondition(cond('invite:AbC12'), facts({ inviteCode: 'AbC12' }))).toBe(true);
    expect(evaluateCondition(cond('invite:AbC12'), facts({ inviteCode: 'abc12' }))).toBe(false);
  });

  it('is false for a term whose fact is missing, and combines with AND and OR', () => {
    const none = facts({ email: null, listHits: new Set(['k21']) });
    expect(evaluateCondition(cond('domain:*'), none)).toBe(false);
    expect(evaluateCondition(cond('list:k21'), none)).toBe(false);
    const c = cond('(domain:*.edu.vn AND invite:abc12) OR list:staff');
    expect(evaluateCondition(c, facts())).toBe(false);
    expect(evaluateCondition(c, facts({ inviteCode: 'abc12' }))).toBe(true);
    expect(evaluateCondition(c, facts({ listHits: new Set(['staff']) }))).toBe(true);
  });
});

const rule = (text: string, roleIds: string[]) => ({ roleIds, condition: cond(text) });
const base = {
  inviteCode: null,
  listHits: EMPTY,
  blockPatterns: [] as string[],
  defaultRoleIds: ['d1'],
};

describe('evaluateEmailAccess', () => {
  it('refuses an invalid address and a blocked one', () => {
    expect(evaluateEmailAccess({ ...base, email: 'nope', rules: [] }).status).toBe('INVALID');
    const blocked = evaluateEmailAccess({
      ...base,
      email: 'Spam@Temp.com',
      blockPatterns: ['*@temp.com'],
      rules: [],
    });
    expect(blocked).toEqual({ status: 'BLOCKED', roleIds: [], matchedRules: [] });
  });

  it('accepts any address with the default roles when no rule looks at an address', () => {
    expect(evaluateEmailAccess({ ...base, email: 'a@b.com', rules: [] })).toEqual({
      status: 'ACCEPTED',
      roleIds: ['d1'],
      matchedRules: [],
    });
    const invites = [rule('invite:abc12', ['r1'])];
    expect(evaluateEmailAccess({ ...base, email: 'a@b.com', rules: invites })).toEqual({
      status: 'ACCEPTED',
      roleIds: ['d1'],
      matchedRules: [],
    });
    expect(
      evaluateEmailAccess({ ...base, email: 'a@b.com', inviteCode: 'abc12', rules: invites }),
    ).toEqual({ status: 'ACCEPTED', roleIds: ['d1', 'r1'], matchedRules: [0] });
  });

  it('accepts only when a rule that looks at an address holds', () => {
    const rules = [
      rule('domain:*.edu.vn', ['r1', 'd1']),
      rule('list:k21', ['r2']),
      rule('invite:abc12', ['r3']),
    ];
    expect(evaluateEmailAccess({ ...base, email: 'a@gmail.com', rules }).status).toBe(
      'NOT_ACCEPTED',
    );
    // An invite-only rule holding does not accept an address nothing else accepts.
    expect(
      evaluateEmailAccess({ ...base, email: 'a@gmail.com', inviteCode: 'abc12', rules }),
    ).toEqual({ status: 'NOT_ACCEPTED', roleIds: [], matchedRules: [] });
    expect(
      evaluateEmailAccess({
        ...base,
        email: 'a@hcmus.edu.vn',
        listHits: new Set(['k21']),
        inviteCode: 'abc12',
        rules,
      }),
    ).toEqual({ status: 'ACCEPTED', roleIds: ['d1', 'r1', 'r2', 'r3'], matchedRules: [0, 1, 2] });
  });
});

describe('evaluateJoin', () => {
  const rules = [
    rule('invite:abc12', ['r1']),
    rule('domain:*.edu OR invite:abc12', ['r2']),
    rule('domain:*.edu AND invite:abc12', ['r3']),
    rule('invite:zzz99', ['r4']),
  ];

  it('grants the roles of every rule that holds for the invite alone', () => {
    expect(evaluateJoin({ inviteCode: 'abc12', rules })).toEqual({
      roleIds: ['r1', 'r2'],
      matchedRules: [0, 1],
    });
  });

  it('grants nothing without a known invite', () => {
    expect(evaluateJoin({ inviteCode: null, rules })).toEqual({ roleIds: [], matchedRules: [] });
  });
});
