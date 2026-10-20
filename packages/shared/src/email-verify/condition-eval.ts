import { z } from 'zod';
import { hasEmailTerm, isAccessGroup, type AccessGroup, type AccessTerm } from './condition.js';
import { emailDomain, normalizeEmail } from './normalize-email.js';
import { wildcardMatch } from './wildcard-match.js';

/** What is known about a member when a condition is judged. */
export const AccessFactsSchema = z.object({
  /** The member's normalised address, null before one is given. */
  email: z.string().nullable(),
  /** Names of the lists that hold the address. */
  listHits: z.custom<ReadonlySet<string>>(),
  /** Code of the invite the member joined with, null when unknown. */
  inviteCode: z.string().nullable(),
});

export type AccessFacts = z.infer<typeof AccessFactsSchema>;

function termHolds(term: AccessTerm, facts: AccessFacts): boolean {
  switch (term.field) {
    case 'domain':
      return facts.email !== null && wildcardMatch(term.value, emailDomain(facts.email));
    case 'email':
      return facts.email !== null && wildcardMatch(term.value, facts.email);
    case 'list':
      return facts.email !== null && facts.listHits.has(term.value);
    case 'invite':
      return facts.inviteCode !== null && facts.inviteCode === term.value;
  }
}

/** Whether a condition holds for the facts; a condition whose fact is missing is false. */
export function evaluateCondition(group: AccessGroup, facts: AccessFacts): boolean {
  const holds = (node: AccessGroup['rules'][number]) =>
    isAccessGroup(node) ? evaluateCondition(node, facts) : termHolds(node, facts);
  return group.combinator === 'and' ? group.rules.every(holds) : group.rules.some(holds);
}

export const AccessRuleInputSchema = z.object({
  roleIds: z.array(z.string()),
  condition: z.custom<AccessGroup>(),
});

export type AccessRuleInput = z.infer<typeof AccessRuleInputSchema>;

const EmailAccessResultSchema = z.object({
  status: z.enum(['INVALID', 'BLOCKED', 'NOT_ACCEPTED', 'ACCEPTED']),
  /** The default roles and the roles of every matching rule; empty unless accepted. */
  roleIds: z.array(z.string()),
  /** Indexes into the `rules` given, of the rules that hold. */
  matchedRules: z.array(z.number().int().min(0)),
});

export type EmailAccessResult = z.infer<typeof EmailAccessResultSchema>;
export type EmailAccessStatus = EmailAccessResult['status'];

/** What a member is granted on joining, from the invite alone. */
export const JoinGrantSchema = EmailAccessResultSchema.pick({ roleIds: true, matchedRules: true });

export type JoinGrant = z.infer<typeof JoinGrantSchema>;

const REFUSED = (status: EmailAccessStatus): EmailAccessResult => ({
  status,
  roleIds: [],
  matchedRules: [],
});

function grants(
  rules: readonly AccessRuleInput[],
  facts: AccessFacts,
  base: readonly string[],
): JoinGrant {
  const roleIds = new Set(base);
  const matchedRules: number[] = [];
  rules.forEach((rule, index) => {
    if (!evaluateCondition(rule.condition, facts)) return;
    matchedRules.push(index);
    for (const roleId of rule.roleIds) roleIds.add(roleId);
  });
  return { roleIds: [...roleIds], matchedRules };
}

/**
 * Judges an address a member typed. Refused when it is not an address or a
 * block pattern matches it. Accepted when no rule looks at an address, or when
 * some rule that does holds; the roles are the defaults plus those of every rule
 * that holds, an invite-only rule included.
 */
export function evaluateEmailAccess(input: {
  email: string;
  inviteCode: string | null;
  /** Names of the lists that hold the address, resolved by the caller. */
  listHits: ReadonlySet<string>;
  blockPatterns: readonly string[];
  rules: readonly AccessRuleInput[];
  defaultRoleIds: readonly string[];
}): EmailAccessResult {
  const email = normalizeEmail(input.email);
  if (email === null) return REFUSED('INVALID');
  if (input.blockPatterns.some((pattern) => wildcardMatch(pattern, email))) {
    return REFUSED('BLOCKED');
  }
  const facts: AccessFacts = { email, listHits: input.listHits, inviteCode: input.inviteCode };
  const { roleIds, matchedRules } = grants(input.rules, facts, input.defaultRoleIds);
  const emailRules = input.rules.filter((rule) => hasEmailTerm(rule.condition));
  const accepted =
    emailRules.length === 0 ||
    matchedRules.some((index) => hasEmailTerm((input.rules[index] as AccessRuleInput).condition));
  return accepted ? { status: 'ACCEPTED', roleIds, matchedRules } : REFUSED('NOT_ACCEPTED');
}

/**
 * The roles a member gets on joining, before any address is known: those of
 * every rule that already holds for the invite alone, such as an invite-only
 * rule or an OR branch on the invite.
 */
export function evaluateJoin(input: {
  inviteCode: string | null;
  rules: readonly AccessRuleInput[];
}): JoinGrant {
  return grants(
    input.rules,
    { email: null, listHits: new Set(), inviteCode: input.inviteCode },
    [],
  );
}
