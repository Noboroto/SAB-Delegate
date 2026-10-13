import { COMMAND_DESCRIPTION_MAX_LENGTH } from '@sab/shared';
import type { CommandPayload } from './command-hash.js';

const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
const NAME_MAX_LENGTH = 32;
const MAX_ROOT_COMMANDS = 100;
const MAX_CHILDREN = 25;
const CHAT_INPUT = 1;

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function localeTexts(value: unknown): Array<[string, string]> {
  return isNode(value)
    ? Object.entries(value).flatMap(([locale, text]) =>
        typeof text === 'string' ? [[locale, text] as [string, string]] : [],
      )
    : [];
}

/**
 * Checks what Discord would reject, before it does: names, description and
 * localisation lengths, and the child limits. Returns one line per problem
 * (empty when the set is valid), each naming the offender by its path, e.g.
 * `/birthday list: description is empty`. Works on the REST body, so the same
 * check serves the declared metadata and whatever the registry builds later.
 */
export function validateCommandMetadata(commands: readonly CommandPayload[]): string[] {
  const problems: string[] = [];

  if (commands.length > MAX_ROOT_COMMANDS) {
    problems.push(`${commands.length} root commands; Discord allows ${MAX_ROOT_COMMANDS}`);
  }

  const seen = new Set<string>();
  for (const command of commands as unknown as readonly Node[]) {
    const name = typeof command['name'] === 'string' ? command['name'] : '';
    if (seen.has(name)) problems.push(`/${name}: declared more than once`);
    seen.add(name);
    const isChatInput = command['type'] === undefined || command['type'] === CHAT_INPUT;
    checkNode(command, `/${name}`, isChatInput, problems);
  }
  return problems;
}

function checkNode(node: Node, path: string, needsDescription: boolean, problems: string[]): void {
  const name = node['name'];
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    problems.push(`${path}: name must match ${String(NAME_PATTERN)}`);
  }
  for (const [locale, text] of localeTexts(node['name_localizations'])) {
    if (text.length < 1 || text.length > NAME_MAX_LENGTH) {
      problems.push(
        `${path}: name localisation ${locale} must be 1..${NAME_MAX_LENGTH} characters`,
      );
    }
  }

  if (needsDescription) {
    const description = node['description'];
    if (typeof description !== 'string' || description.trim() === '') {
      problems.push(`${path}: description is empty`);
    } else if (description.length > COMMAND_DESCRIPTION_MAX_LENGTH) {
      problems.push(`${path}: description is longer than ${COMMAND_DESCRIPTION_MAX_LENGTH}`);
    }
  }
  for (const [locale, text] of localeTexts(node['description_localizations'])) {
    if (text.trim() === '' || text.length > COMMAND_DESCRIPTION_MAX_LENGTH) {
      problems.push(
        `${path}: description localisation ${locale} must be 1..${COMMAND_DESCRIPTION_MAX_LENGTH} characters`,
      );
    }
  }

  const options = Array.isArray(node['options']) ? (node['options'] as unknown[]) : [];
  if (options.length > MAX_CHILDREN) {
    problems.push(
      `${path}: ${options.length} options or subcommands; Discord allows ${MAX_CHILDREN}`,
    );
  }
  const children = new Set<string>();
  for (const option of options) {
    if (!isNode(option)) continue;
    const childName = typeof option['name'] === 'string' ? option['name'] : '';
    const childPath = `${path} ${childName}`;
    if (children.has(childName)) problems.push(`${childPath}: declared more than once`);
    children.add(childName);
    // Subcommands, groups and plain options all need a description.
    checkNode(option, childPath, true, problems);
  }
}
