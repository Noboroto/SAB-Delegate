import type { RuleGroupType, RuleType } from 'react-querybuilder';
import { AccessConditionSchema, type AccessCondition, type AccessGroup, type z } from '@sab/shared';

/** Why a builder's state is not a condition yet. */
export type BuilderIssue = 'EMPTY' | 'INVALID_VALUE' | 'TOO_DEEP' | 'TOO_MANY_TERMS';

export type QueryToCondition =
  { ok: true; condition: AccessCondition } | { ok: false; issue: BuilderIssue };

/** What a rule starts as: one empty domain condition, so the first thing to do is type it. */
export function emptyQuery(): RuleGroupType {
  return { combinator: 'or', rules: [{ field: 'domain', operator: '=', value: '' }] };
}

/**
 * A node of a condition the shared schema already accepted. The schema's
 * recursive type loses the shape of nested groups, so the node is read by its
 * keys instead of by type.
 */
function nodeToQuery(node: unknown): RuleType | RuleGroupType {
  if (typeof node === 'object' && node !== null && 'combinator' in node) {
    return groupToQuery(node as { combinator: 'and' | 'or'; rules: unknown[] });
  }
  const term = node as { field: string; value: string };
  return { field: term.field, operator: '=', value: term.value };
}

function groupToQuery(group: {
  combinator: 'and' | 'or';
  rules: readonly unknown[];
}): RuleGroupType {
  return { combinator: group.combinator, rules: group.rules.map(nodeToQuery) };
}

/** The builder's state for a condition; react-querybuilder gives every node an id when it loads. */
export function conditionToQuery(group: AccessGroup): RuleGroupType {
  return groupToQuery(group);
}

function stripNode(node: unknown): unknown {
  if (typeof node !== 'object' || node === null) return undefined;
  if ('rules' in node) {
    const group = node as { combinator?: unknown; rules: unknown };
    return {
      combinator: group.combinator,
      rules: Array.isArray(group.rules) ? (group.rules as unknown[]).map(stripNode) : [],
    };
  }
  const rule = node as { field?: unknown; operator?: unknown; value?: unknown };
  return {
    field: rule.field,
    operator: rule.operator,
    value: typeof rule.value === 'string' ? rule.value : '',
  };
}

type Issue = z.ZodError['issues'][number];

/** Whether an issue, or any option of a failed union inside it, carries the message. */
function hasMessage(issues: readonly Issue[], message: string): boolean {
  return issues.some(
    (issue) =>
      issue.message === message ||
      (issue.code === 'invalid_union' &&
        issue.errors.some((option) => hasMessage(option, message))),
  );
}

/**
 * The condition a builder state stands for, with ids and other builder keys
 * stripped and every value normalised by the shared schema (a pasted invite
 * link becomes its code). A state that is not valid yet says why.
 */
export function queryToCondition(query: RuleGroupType): QueryToCondition {
  const parsed = AccessConditionSchema.safeParse(stripNode(query));
  if (parsed.success) return { ok: true, condition: parsed.data };
  const issues = parsed.error.issues;
  if (hasMessage(issues, 'TOO_DEEP')) return { ok: false, issue: 'TOO_DEEP' };
  if (hasMessage(issues, 'TOO_MANY_TERMS')) {
    return { ok: false, issue: 'TOO_MANY_TERMS' };
  }
  const emptyGroup = issues.some(
    (issue) => issue.code === 'too_small' && issue.path[issue.path.length - 1] === 'rules',
  );
  return { ok: false, issue: emptyGroup ? 'EMPTY' : 'INVALID_VALUE' };
}
