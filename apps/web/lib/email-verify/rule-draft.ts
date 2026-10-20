import type { RuleGroupType } from 'react-querybuilder';
import {
  evaluateEmailAccess,
  collectListNames,
  normalizeTermValue,
  parseCondition,
  serializeCondition,
  type AccessRule,
  type AccessRuleInput,
  type ConditionParseErrorCode,
  ROLES_MAX,
  type EmailAccessResult,
} from '@sab/shared';
import {
  conditionToQuery,
  emptyQuery,
  queryToCondition,
  type BuilderIssue,
} from './condition-query';

/** One rule while it is being edited: the builder's state or the text, whichever is open, and its roles. */
export interface RuleDraft {
  /** Identifies the card across reorders; never sent to the server. */
  key: number;
  mode: 'builder' | 'text';
  query: RuleGroupType;
  text: string;
  roleIds: string[];
}

export type DraftError =
  | { kind: 'builder'; issue: BuilderIssue }
  | { kind: 'text'; code: ConditionParseErrorCode; position: number }
  | { kind: 'roles' };

export type DraftResult = { ok: true; rule: AccessRule } | { ok: false; error: DraftError };

export function newDraft(key: number): RuleDraft {
  return { key, mode: 'builder', query: emptyQuery(), text: '', roleIds: [] };
}

/** A draft from a rule the server returned; `text` is the server's own serialisation. */
export function draftFromRule(rule: AccessRule & { text?: string }, key: number): RuleDraft {
  return {
    key,
    mode: 'builder',
    query: conditionToQuery(rule.condition),
    text: rule.text ?? serializeCondition(rule.condition),
    roleIds: [...rule.roleIds],
  };
}

/** The rule a draft stands for, or what is wrong with it. */
export function resolveDraft(draft: RuleDraft): DraftResult {
  if (draft.roleIds.length > ROLES_MAX) return { ok: false, error: { kind: 'roles' } };
  if (draft.mode === 'text') {
    const parsed = parseCondition(draft.text);
    return parsed.ok
      ? { ok: true, rule: { condition: parsed.condition, roleIds: draft.roleIds } }
      : {
          ok: false,
          error: { kind: 'text', code: parsed.error.code, position: parsed.error.position },
        };
  }
  const built = queryToCondition(draft.query);
  return built.ok
    ? { ok: true, rule: { condition: built.condition, roleIds: draft.roleIds } }
    : { ok: false, error: { kind: 'builder', issue: built.issue } };
}

/** Opens the text form: what the builder says now, or the last text when the builder is incomplete. */
export function toTextMode(draft: RuleDraft): RuleDraft {
  const built = queryToCondition(draft.query);
  return {
    ...draft,
    mode: 'text',
    text: built.ok ? serializeCondition(built.condition) : draft.text,
  };
}

/** Opens the builder from the text; stays in text (with the reason) when the text cannot be read. */
export function toBuilderMode(
  draft: RuleDraft,
): { ok: true; draft: RuleDraft } | { ok: false; error: DraftError } {
  const parsed = parseCondition(draft.text);
  if (!parsed.ok) {
    return {
      ok: false,
      error: { kind: 'text', code: parsed.error.code, position: parsed.error.position },
    };
  }
  return {
    ok: true,
    draft: { ...draft, mode: 'builder', query: conditionToQuery(parsed.condition) },
  };
}

export interface TesterOutcome {
  result: EmailAccessResult;
  /** Rules that were left out because they are not valid yet. */
  skipped: number;
  /** Whether some rule names a list; membership is the server's to know. */
  usesLists: boolean;
}

/**
 * Judges an address against the rules as edited, with the shared matcher the
 * bot uses. List membership cannot be known here (the lists keep only hashes),
 * so a list condition never holds in this preview.
 */
export function testEmailAccess(input: {
  drafts: readonly RuleDraft[];
  email: string;
  invite: string;
  blockPatterns: readonly string[];
  defaultRoleIds: readonly string[];
}): TesterOutcome {
  const rules: AccessRuleInput[] = [];
  let skipped = 0;
  for (const draft of input.drafts) {
    const resolved = resolveDraft(draft);
    if (resolved.ok) rules.push(resolved.rule);
    else skipped += 1;
  }
  const invite = input.invite.trim() === '' ? null : normalizeTermValue('invite', input.invite);
  const result = evaluateEmailAccess({
    email: input.email,
    inviteCode: invite,
    listHits: new Set(),
    blockPatterns: input.blockPatterns,
    rules,
    defaultRoleIds: input.defaultRoleIds,
  });
  return {
    result,
    skipped,
    usesLists: rules.some((rule) => collectListNames(rule.condition).length > 0),
  };
}
