import { z } from 'zod';
import {
  AccessFieldSchema,
  conditionLimitIssue,
  isAccessGroup,
  normalizeTermValue,
  type AccessCondition,
  type AccessGroup,
  type AccessNode,
  type AccessTerm,
} from './condition.js';
import { ACCESS_CONDITION_TEXT_MAX } from './constants.js';

export const ConditionParseErrorCodeSchema = z.enum([
  'EMPTY',
  'TOO_LONG',
  'UNEXPECTED_TOKEN',
  'EXPECTED_CONDITION',
  'UNKNOWN_FIELD',
  'INVALID_VALUE',
  'UNBALANCED_PARENTHESIS',
  'TOO_DEEP',
  'TOO_MANY_TERMS',
]);

export type ConditionParseErrorCode = z.infer<typeof ConditionParseErrorCodeSchema>;

export const ConditionParseResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), condition: z.custom<AccessCondition>() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: ConditionParseErrorCodeSchema,
      /** Offset in the text where the problem starts. */
      position: z.number().int().min(0),
      /** The offending piece of text, when the error is about one condition. */
      term: z.string().optional(),
    }),
  }),
]);

export type ConditionParseResult = z.infer<typeof ConditionParseResultSchema>;

type Token =
  | { kind: 'open' | 'close' | 'and' | 'or'; position: number }
  | { kind: 'word'; position: number; text: string };

// Parentheses nested deeper than this cannot fit the depth limit anyway; stopping
// here keeps the recursive descent shallow for hostile input.
const PAREN_DEPTH_MAX = 8;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '(') {
      tokens.push({ kind: 'open', position: i });
      i += 1;
    } else if (ch === ')') {
      tokens.push({ kind: 'close', position: i });
      i += 1;
    } else if (ch === '|' || ch === '&') {
      tokens.push({ kind: ch === '|' ? 'or' : 'and', position: i });
      i += text[i + 1] === ch ? 2 : 1;
    } else {
      const start = i;
      while (i < text.length && !/[\s()|&]/.test(text[i] ?? '')) i += 1;
      const word = text.slice(start, i);
      const lower = word.toLowerCase();
      if (lower === 'and' || lower === 'or') tokens.push({ kind: lower, position: start });
      else tokens.push({ kind: 'word', position: start, text: word });
    }
  }
  return tokens;
}

class ParseFailure extends Error {
  constructor(
    readonly code: ConditionParseErrorCode,
    readonly position: number,
    readonly term?: string,
  ) {
    super(code);
  }
}

/** Joins nodes with one combinator; a nested group of the same combinator is spliced in, which does not change its meaning. */
function join(combinator: 'and' | 'or', nodes: AccessNode[]): AccessNode {
  if (nodes.length === 1) return nodes[0] as AccessNode;
  const rules: AccessNode[] = [];
  for (const node of nodes) {
    if (isAccessGroup(node) && node.combinator === combinator) rules.push(...node.rules);
    else rules.push(node);
  }
  return { combinator, rules };
}

function parseTerm(token: Extract<Token, { kind: 'word' }>): AccessTerm {
  const colon = token.text.indexOf(':');
  const field = AccessFieldSchema.safeParse(
    colon === -1 ? '' : token.text.slice(0, colon).toLowerCase(),
  );
  if (!field.success) throw new ParseFailure('UNKNOWN_FIELD', token.position, token.text);
  const value = normalizeTermValue(field.data, token.text.slice(colon + 1));
  if (value === null) {
    throw new ParseFailure('INVALID_VALUE', token.position + colon + 1, token.text);
  }
  return { field: field.data, operator: '=', value };
}

/**
 * Recursive descent over `or := and (OR and)*`, `and := atom (AND atom)*`,
 * `atom := ( or ) | field:value`; AND binds tighter than OR.
 */
class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): AccessNode {
    const node = this.parseOr(0);
    const rest = this.tokens[this.index];
    if (rest) {
      throw new ParseFailure(
        rest.kind === 'close' ? 'UNBALANCED_PARENTHESIS' : 'UNEXPECTED_TOKEN',
        rest.position,
      );
    }
    return node;
  }

  private parseOr(depth: number): AccessNode {
    const nodes = [this.parseAnd(depth)];
    while (this.tokens[this.index]?.kind === 'or') {
      this.index += 1;
      nodes.push(this.parseAnd(depth));
    }
    return join('or', nodes);
  }

  private parseAnd(depth: number): AccessNode {
    const nodes = [this.parseAtom(depth)];
    while (this.tokens[this.index]?.kind === 'and') {
      this.index += 1;
      nodes.push(this.parseAtom(depth));
    }
    return join('and', nodes);
  }

  private parseAtom(depth: number): AccessNode {
    const token = this.tokens[this.index];
    if (!token) {
      throw new ParseFailure('EXPECTED_CONDITION', this.tokens.at(-1)?.position ?? 0);
    }
    if (token.kind === 'open') {
      if (depth >= PAREN_DEPTH_MAX) throw new ParseFailure('TOO_DEEP', token.position);
      this.index += 1;
      const node = this.parseOr(depth + 1);
      const close = this.tokens[this.index];
      if (close?.kind !== 'close') throw new ParseFailure('UNBALANCED_PARENTHESIS', token.position);
      this.index += 1;
      return node;
    }
    if (token.kind === 'word') {
      this.index += 1;
      return parseTerm(token);
    }
    throw new ParseFailure(
      token.kind === 'close' ? 'EXPECTED_CONDITION' : 'UNEXPECTED_TOKEN',
      token.position,
    );
  }
}

/**
 * Reads one rule's condition from text: `domain:*.edu AND (list:k21 OR invite:abc12)`.
 * Fields are `domain`, `email`, `list` and `invite`; AND (or `&`) binds tighter
 * than OR (or `|`), parentheses group, keywords are case-insensitive.
 */
export function parseCondition(text: string): ConditionParseResult {
  if (text.length > ACCESS_CONDITION_TEXT_MAX) {
    return { ok: false, error: { code: 'TOO_LONG', position: ACCESS_CONDITION_TEXT_MAX } };
  }
  const tokens = tokenize(text);
  if (tokens.length === 0) return { ok: false, error: { code: 'EMPTY', position: 0 } };
  try {
    const node = new Parser(tokens).parse();
    const condition: AccessGroup = isAccessGroup(node)
      ? node
      : { combinator: 'and', rules: [node] };
    const issue = conditionLimitIssue(condition);
    if (issue !== null) return { ok: false, error: { code: issue, position: 0 } };
    return { ok: true, condition };
  } catch (error) {
    if (!(error instanceof ParseFailure)) throw error;
    return {
      ok: false,
      error: {
        code: error.code,
        position: error.position,
        ...(error.term === undefined ? {} : { term: error.term }),
      },
    };
  }
}

function serializeNode(node: AccessNode, parent: AccessGroup['combinator'] | null): string {
  if (!isAccessGroup(node)) return `${node.field}:${node.value}`;
  if (node.rules.length === 1) return serializeNode(node.rules[0] as AccessNode, parent);
  const text = node.rules
    .map((child) => serializeNode(child, node.combinator))
    .join(node.combinator === 'and' ? ' AND ' : ' OR ');
  // Only an OR inside an AND needs parentheses: AND binds tighter, and a
  // same-combinator child reads the same without them.
  return parent === 'and' && node.combinator === 'or' ? `(${text})` : text;
}

/** The text form of a condition, with the fewest parentheses that keep its meaning. */
export function serializeCondition(condition: AccessGroup): string {
  return serializeNode(condition, null);
}
