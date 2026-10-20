import { describe, expect, it } from 'vitest';
import {
  AccessConditionSchema,
  collectListNames,
  conditionDepth,
  conditionTermCount,
  hasEmailTerm,
  normalizeTermValue,
} from './condition.js';
import { parseCondition, serializeCondition } from './condition-text.js';

function parsed(text: string) {
  const result = parseCondition(text);
  if (!result.ok) throw new Error(`${text}: ${JSON.stringify(result.error)}`);
  return result.condition;
}

function errorOf(text: string) {
  const result = parseCondition(text);
  return result.ok ? null : result.error;
}

describe('normalizeTermValue', () => {
  it('lower-cases a domain and drops the leading @', () => {
    expect(normalizeTermValue('domain', '@HCMUS.edu.vn')).toBe('hcmus.edu.vn');
    expect(normalizeTermValue('domain', '*.edu')).toBe('*.edu');
    expect(normalizeTermValue('domain', 'bad domain')).toBeNull();
    expect(normalizeTermValue('domain', '')).toBeNull();
  });

  it('wants an @ in an email pattern', () => {
    expect(normalizeTermValue('email', '*@HCMUS.edu.vn')).toBe('*@hcmus.edu.vn');
    expect(normalizeTermValue('email', 'hcmus.edu.vn')).toBeNull();
    expect(normalizeTermValue('email', 'a(b)@x.com')).toBeNull();
  });

  it('restricts a list to a name', () => {
    expect(normalizeTermValue('list', 'K21')).toBe('k21');
    expect(normalizeTermValue('list', 'a b')).toBeNull();
    expect(normalizeTermValue('list', 'x'.repeat(33))).toBeNull();
  });

  it('takes the code out of an invite link and keeps its case', () => {
    for (const link of [
      'AbC-12',
      'discord.gg/AbC-12',
      'https://discord.gg/AbC-12',
      'https://www.discord.com/invite/AbC-12/',
      'discord.com/invite/AbC-12',
      'https://discord.gg/AbC-12?event=123456789012345678',
      'discord.gg/AbC-12/?utm_source=copy#top',
    ]) {
      expect(normalizeTermValue('invite', link), link).toBe('AbC-12');
    }
    expect(normalizeTermValue('invite', 'a')).toBeNull();
    expect(normalizeTermValue('invite', 'https://evil.example/abc12')).toBeNull();
  });
});

describe('AccessConditionSchema', () => {
  it('normalises values, strips extra keys and defaults the operator', () => {
    const condition = AccessConditionSchema.parse({
      id: 'g',
      combinator: 'or',
      rules: [
        { id: 'r', field: 'domain', operator: '=', value: '@Hcmus.edu.vn' },
        { field: 'invite', value: 'https://discord.gg/abc12' },
      ],
    });
    expect(condition).toEqual({
      combinator: 'or',
      rules: [
        { field: 'domain', operator: '=', value: 'hcmus.edu.vn' },
        { field: 'invite', operator: '=', value: 'abc12' },
      ],
    });
  });

  it('refuses an empty group, a bad value, a negation and an unknown field', () => {
    expect(AccessConditionSchema.safeParse({ combinator: 'and', rules: [] }).success).toBe(false);
    const bad = { combinator: 'and', rules: [{ field: 'list', value: 'a b' }] };
    expect(AccessConditionSchema.safeParse(bad).success).toBe(false);
    const negated = { combinator: 'and', not: true, rules: [{ field: 'list', value: 'a' }] };
    expect(AccessConditionSchema.safeParse(negated).success).toBe(false);
    const unknown = { combinator: 'and', rules: [{ field: 'name', value: 'a' }] };
    expect(AccessConditionSchema.safeParse(unknown).success).toBe(false);
  });

  it('enforces the depth and term limits on the whole condition', () => {
    const leaf = { field: 'list', value: 'a' };
    let deep: unknown = { combinator: 'and', rules: [leaf] };
    for (let i = 0; i < 3; i += 1) deep = { combinator: 'or', rules: [deep, leaf] };
    expect(AccessConditionSchema.safeParse(deep).success).toBe(true);
    deep = { combinator: 'and', rules: [deep, leaf] };
    expect(AccessConditionSchema.safeParse(deep).success).toBe(false);

    const many = (n: number) => ({
      combinator: 'or',
      rules: Array.from({ length: n }, (_, i) => ({ field: 'list', value: `l${i}` })),
    });
    expect(AccessConditionSchema.safeParse(many(20)).success).toBe(true);
    expect(AccessConditionSchema.safeParse(many(21)).success).toBe(false);
  });

  it('refuses hostile nesting as a validation error, not a stack overflow', () => {
    let deep: unknown = { combinator: 'and', rules: [{ field: 'list', value: 'a' }] };
    for (let i = 0; i < 200_000; i += 1) deep = { combinator: 'or', rules: [deep] };
    const result = AccessConditionSchema.safeParse(deep);
    expect(result.success).toBe(false);
  });
});

describe('condition helpers', () => {
  it('measures depth and terms and reports what a condition looks at', () => {
    const condition = parsed('(domain:a.com AND invite:abc12) OR list:k21 OR list:k21');
    expect(conditionDepth(condition)).toBe(2);
    expect(conditionTermCount(condition)).toBe(4);
    expect(collectListNames(condition)).toEqual(['k21']);
    expect(hasEmailTerm(condition)).toBe(true);
    expect(hasEmailTerm(parsed('invite:abc12 OR invite:xyz99'))).toBe(false);
  });
});

describe('parseCondition', () => {
  it('lets AND bind tighter than OR', () => {
    expect(parsed('domain:a.com OR list:x AND invite:abc12')).toEqual({
      combinator: 'or',
      rules: [
        { field: 'domain', operator: '=', value: 'a.com' },
        {
          combinator: 'and',
          rules: [
            { field: 'list', operator: '=', value: 'x' },
            { field: 'invite', operator: '=', value: 'abc12' },
          ],
        },
      ],
    });
  });

  it('honours parentheses, symbols and any case of the keywords', () => {
    expect(parsed('(domain:a.com Or list:x) && invite:abc12')).toEqual({
      combinator: 'and',
      rules: [
        {
          combinator: 'or',
          rules: [
            { field: 'domain', operator: '=', value: 'a.com' },
            { field: 'list', operator: '=', value: 'x' },
          ],
        },
        { field: 'invite', operator: '=', value: 'abc12' },
      ],
    });
    expect(parsed('domain:a.com | domain:b.com').combinator).toBe('or');
    expect(parsed('DOMAIN:*.EDU').rules).toEqual([
      { field: 'domain', operator: '=', value: '*.edu' },
    ]);
  });

  it('wraps a lone condition in a group and splices same-combinator nesting', () => {
    expect(parsed('list:x')).toEqual({
      combinator: 'and',
      rules: [{ field: 'list', operator: '=', value: 'x' }],
    });
    expect(parsed('(list:a OR list:b) OR list:c').rules).toHaveLength(3);
  });

  it('accepts an invite link as a value', () => {
    expect(parsed('invite:https://discord.gg/abc12').rules).toEqual([
      { field: 'invite', operator: '=', value: 'abc12' },
    ]);
  });

  it('reports what is wrong and where', () => {
    expect(errorOf('   ')).toEqual({ code: 'EMPTY', position: 0 });
    expect(errorOf('domain:a.com OR')?.code).toBe('EXPECTED_CONDITION');
    expect(errorOf('OR domain:a.com')).toEqual({ code: 'UNEXPECTED_TOKEN', position: 0 });
    expect(errorOf('name:bob')).toEqual({ code: 'UNKNOWN_FIELD', position: 0, term: 'name:bob' });
    expect(errorOf('abc')?.code).toBe('UNKNOWN_FIELD');
    expect(errorOf('domain:a.com OR list:a b')).toEqual({ code: 'UNEXPECTED_TOKEN', position: 23 });
    expect(errorOf('email:nobody')).toEqual({
      code: 'INVALID_VALUE',
      position: 6,
      term: 'email:nobody',
    });
    expect(errorOf('(domain:a.com')).toEqual({ code: 'UNBALANCED_PARENTHESIS', position: 0 });
    expect(errorOf('domain:a.com)')).toEqual({ code: 'UNBALANCED_PARENTHESIS', position: 12 });
    expect(errorOf('()')?.code).toBe('EXPECTED_CONDITION');
    expect(errorOf('x'.repeat(2001))?.code).toBe('TOO_LONG');
  });

  it('refuses a condition that breaks a limit', () => {
    const terms = Array.from({ length: 21 }, (_, i) => `list:l${i}`).join(' OR ');
    expect(errorOf(terms)).toEqual({ code: 'TOO_MANY_TERMS', position: 0 });
    const deep = '(list:a AND (list:b OR (list:c AND (list:d OR (list:e AND list:f)))))';
    expect(errorOf(deep)).toEqual({ code: 'TOO_DEEP', position: 0 });
    expect(parseCondition('('.repeat(100) + 'list:a' + ')'.repeat(100)).ok).toBe(false);
  });
});

describe('serializeCondition', () => {
  it('writes the fewest parentheses that keep the meaning', () => {
    expect(serializeCondition(parsed('domain:a.com OR list:x AND invite:abc12'))).toBe(
      'domain:a.com OR list:x AND invite:abc12',
    );
    expect(serializeCondition(parsed('(domain:a.com OR list:x) AND invite:abc12'))).toBe(
      '(domain:a.com OR list:x) AND invite:abc12',
    );
    expect(serializeCondition(parsed('list:x'))).toBe('list:x');
  });

  it('round-trips through the parser', () => {
    for (const text of [
      'domain:*.edu',
      'domain:*.edu OR list:k21 OR email:*@hcmus.edu.vn',
      '(domain:*.edu AND invite:k21) OR list:staff',
      'domain:a.com AND (list:x OR (invite:abc12 AND email:*@a.com))',
    ]) {
      const condition = parsed(text);
      expect(parsed(serializeCondition(condition)), text).toEqual(condition);
    }
  });

  it('writes a group a client built with one member as that member', () => {
    expect(
      serializeCondition({
        combinator: 'or',
        rules: [
          { combinator: 'and', rules: [{ field: 'list', operator: '=', value: 'a' }] },
          { field: 'domain', operator: '=', value: 'b.com' },
        ],
      }),
    ).toBe('list:a OR domain:b.com');
  });
});
