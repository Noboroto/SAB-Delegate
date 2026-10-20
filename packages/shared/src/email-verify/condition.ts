import { z } from 'zod';
import {
  ACCESS_CONDITION_DEPTH_MAX,
  ACCESS_RULE_TERMS_MAX,
  EMAIL_ADDRESS_MAX,
} from './constants.js';

/** What one condition looks at. */
export const AccessFieldSchema = z.enum(['domain', 'email', 'list', 'invite']);

export type AccessField = z.infer<typeof AccessFieldSchema>;

export const LIST_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
const DOMAIN_PATTERN = /^[a-z0-9.*-]{1,253}$/;
// A character set that keeps the text form unambiguous: no space, parenthesis, `|` or `&`.
const EMAIL_PATTERN = /^[a-z0-9._%+*'-]+@[a-z0-9.*-]+$/;
const INVITE_CODE_PATTERN = /^[A-Za-z0-9-]{2,32}$/;
// A copied link often carries a query string or fragment (`?event=...`); it is not part of the code.
const INVITE_LINK_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)\/?(?:[?#]\S*)?$/i;

/**
 * The stored form of a condition's value, or null when it is not valid for the
 * field. Domain: lower-case wildcard, a leading `@` dropped. Email: lower-case
 * wildcard with an `@`. List: the list's name. Invite: the code, taken out of a
 * full invite link when one is given; codes are case-sensitive.
 */
export function normalizeTermValue(field: AccessField, raw: string): string | null {
  const text = raw.trim();
  switch (field) {
    case 'domain': {
      const domain = text.replace(/^@/, '').toLowerCase();
      return DOMAIN_PATTERN.test(domain) ? domain : null;
    }
    case 'email': {
      const email = text.toLowerCase();
      return email.length <= EMAIL_ADDRESS_MAX && EMAIL_PATTERN.test(email) ? email : null;
    }
    case 'list': {
      const name = text.toLowerCase();
      return LIST_NAME_PATTERN.test(name) ? name : null;
    }
    case 'invite': {
      const code = INVITE_LINK_PATTERN.exec(text)?.[1] ?? text;
      return INVITE_CODE_PATTERN.test(code) ? code : null;
    }
  }
}

/**
 * One condition, in the shape react-querybuilder produces (`id` and other keys
 * are stripped). The value is normalised on parse, so what is stored matches
 * what the matcher compares against.
 */
export const AccessTermSchema = z
  .object({
    field: AccessFieldSchema,
    operator: z.literal('=').default('='),
    value: z.string().max(300),
  })
  .transform((term, ctx) => {
    const value = normalizeTermValue(term.field, term.value);
    if (value === null) {
      ctx.addIssue({ code: 'custom', message: `invalid ${term.field} value`, path: ['value'] });
      return z.NEVER;
    }
    return { field: term.field, operator: '=' as const, value };
  });

export type AccessTerm = z.infer<typeof AccessTermSchema>;
type AccessTermInput = z.input<typeof AccessTermSchema>;

/** Rules in a group, before the limits on the whole condition. */
const GROUP_RULES_MAX = ACCESS_RULE_TERMS_MAX;

/**
 * A group of conditions joined by AND or OR; a member of a group is a condition
 * or another group. `not` is only accepted as false: a negated group stripped to
 * its rules would silently mean the opposite.
 */
// Spelled out because inference cannot follow a recursive schema whose members
// transform their input (nested groups would type as unknown records); the
// element types still come from the schemas above.
export type AccessGroup = {
  combinator: 'and' | 'or';
  not?: false;
  rules: (AccessTerm | AccessGroup)[];
};
/** What a client may send: values before normalisation, `operator` optional. */
export type AccessGroupInput = {
  combinator: 'and' | 'or';
  not?: false;
  rules: (AccessTermInput | AccessGroupInput)[];
};

/**
 * A group where only a condition may stand: it is refused as nested too deep,
 * not as a generic "invalid". It looks no further inside than its own rules, so
 * the cost does not grow with the depth of the input. A custom schema would
 * make the tool schema impossible to list (no JSON Schema form), hence an object.
 * The cast keeps the declared input of a member: this schema only ever refuses.
 */
const NoGroupSchema = z
  .object({ combinator: z.enum(['and', 'or']), rules: z.array(z.unknown()) })
  .transform((_group, ctx) => {
    ctx.addIssue({ code: 'custom', message: 'TOO_DEEP', path: ['rules'] });
    return z.NEVER;
  }) as unknown as z.ZodType<never, AccessTermInput>;

/**
 * One level of the schema per allowed level of nesting, instead of one
 * recursive schema: a body nested thousands of levels deep is then refused
 * after `ACCESS_CONDITION_DEPTH_MAX` steps (a validation error) rather than
 * recursing until the call stack overflows.
 */
function groupSchema(levels: number): z.ZodType<AccessGroup, AccessGroupInput> {
  const members =
    levels > 1
      ? z.union([AccessTermSchema, groupSchema(levels - 1)])
      : z.union([AccessTermSchema, NoGroupSchema]);
  return z.object({
    combinator: z.enum(['and', 'or']),
    not: z.literal(false).optional(),
    rules: z.array(members).min(1).max(GROUP_RULES_MAX),
  });
}

export const AccessGroupSchema: z.ZodType<AccessGroup, AccessGroupInput> = groupSchema(
  ACCESS_CONDITION_DEPTH_MAX,
);

/** A member of a group: a condition or a nested group. */
export type AccessNode = AccessTerm | AccessGroup;

export function isAccessGroup(node: AccessNode): node is AccessGroup {
  return 'combinator' in node;
}

/** Levels of groups, the outermost counted as one. */
export function conditionDepth(group: AccessGroup): number {
  let deepest = 0;
  for (const node of group.rules) {
    if (isAccessGroup(node)) deepest = Math.max(deepest, conditionDepth(node));
  }
  return deepest + 1;
}

/** Conditions in a group and its nested groups. */
export function conditionTermCount(group: AccessGroup): number {
  let count = 0;
  for (const node of group.rules) count += isAccessGroup(node) ? conditionTermCount(node) : 1;
  return count;
}

/** Which limit a condition breaks, if any. */
export function conditionLimitIssue(group: AccessGroup): 'TOO_DEEP' | 'TOO_MANY_TERMS' | null {
  if (conditionDepth(group) > ACCESS_CONDITION_DEPTH_MAX) return 'TOO_DEEP';
  if (conditionTermCount(group) > ACCESS_RULE_TERMS_MAX) return 'TOO_MANY_TERMS';
  return null;
}

/**
 * The condition of one access rule: a group, nested up to
 * `ACCESS_CONDITION_DEPTH_MAX` levels, with at most `ACCESS_RULE_TERMS_MAX`
 * conditions in all. Parse the stored Json column with it, never cast.
 */
export const AccessConditionSchema = AccessGroupSchema.superRefine((group, ctx) => {
  const issue = conditionLimitIssue(group);
  if (issue !== null) ctx.addIssue({ code: 'custom', message: issue });
});

export type AccessCondition = z.infer<typeof AccessConditionSchema>;

function collect(group: AccessGroup, visit: (term: AccessTerm) => void): void {
  for (const node of group.rules) {
    if (isAccessGroup(node)) collect(node, visit);
    else visit(node);
  }
}

/** Whether the condition looks at an address (anything but an invite). */
export function hasEmailTerm(group: AccessGroup): boolean {
  let found = false;
  collect(group, (term) => {
    if (term.field !== 'invite') found = true;
  });
  return found;
}

/** The names of the lists a condition refers to, once each. */
export function collectListNames(group: AccessGroup): string[] {
  const names = new Set<string>();
  collect(group, (term) => {
    if (term.field === 'list') names.add(term.value);
  });
  return [...names];
}
