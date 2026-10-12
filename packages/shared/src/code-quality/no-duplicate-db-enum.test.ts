import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// A hand-written `z.enum([...])` (or an `as const` string list) that repeats
// the values of a Prisma enum is a second copy of the value set: add a value
// to the schema and the copy silently rejects it. Import the generated enum
// schema instead. The schema folder may not exist yet; the scan is then empty
// but the detectors below stay under test.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PRISMA_SCHEMA_DIR = join(REPO_ROOT, 'apps', 'server', 'prisma', 'schema');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts']);
const SKIPPED_SEGMENTS = new Set(['node_modules', 'dist', '.next', 'generated']);
const TEST_FILE = /\.(test|spec)\.tsx?$/;

const STRING_LITERAL = String.raw`(?:'[^']*'|"[^"]*")`;
const Z_ENUM_ARRAY = /z\.enum\(\s*(\[[^\]]*])\s*(?:as const\s*)?\)/g;
const AS_CONST_STRING_ARRAY = new RegExp(
  String.raw`\[\s*${STRING_LITERAL}(?:\s*,\s*${STRING_LITERAL})*\s*,?\s*]\s*as\s+const`,
  'g',
);

function parsePrismaEnums(schema: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  for (const match of schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)}/gm)) {
    const values = (match[2] ?? '')
      .split('\n')
      // `@map("x")` and `//` comments follow the value name on the same line.
      .map((line) => /^\s*([A-Za-z_]\w*)/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined);
    enums.set(match[1] ?? '', values);
  }
  return enums;
}

function findEnumLiterals(source: string): string[][] {
  const byStart = new Map<number, string>();
  for (const match of source.matchAll(Z_ENUM_ARRAY)) {
    byStart.set(match.index + match[0].indexOf('['), match[1] ?? '');
  }
  for (const match of source.matchAll(AS_CONST_STRING_ARRAY)) byStart.set(match.index, match[0]);
  return [...byStart.values()]
    .map((text) => [...text.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? ''))
    .filter((values) => values.length > 0);
}

// Two shared values: one is a coincidence ('pending' in an unrelated enum), two
// in the same list is a copy. A UI list may drop a value on purpose, so equal
// size alone would miss it.
function repeatsEnum(literal: readonly string[], enumValues: readonly string[]): boolean {
  const known = new Set(enumValues.map((value) => value.toLowerCase()));
  return literal.filter((value) => known.has(value.toLowerCase())).length >= 2;
}

function sourceFiles(): string[] {
  return ['apps', 'packages'].flatMap((group) => {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) return [];
    return readdirSync(groupDir)
      .map((name) => join(groupDir, name, 'src'))
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        readdirSync(root, { recursive: true, encoding: 'utf8' })
          .filter((rel) => SOURCE_EXTENSIONS.has(extname(rel)) && !TEST_FILE.test(rel))
          .filter((rel) => !rel.split(/[\\/]/).some((segment) => SKIPPED_SEGMENTS.has(segment)))
          .map((rel) => join(root, rel)),
      );
  });
}

function databaseEnums(): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  if (!existsSync(PRISMA_SCHEMA_DIR)) return enums;
  for (const name of readdirSync(PRISMA_SCHEMA_DIR).filter((n) => n.endsWith('.prisma'))) {
    const schema = readFileSync(join(PRISMA_SCHEMA_DIR, name), 'utf8');
    for (const [enumName, values] of parsePrismaEnums(schema)) enums.set(enumName, values);
  }
  return enums;
}

describe('hand-written enums do not repeat a database enum', () => {
  it('scans real source files', () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it('no z.enum or as-const list repeats the values of a Prisma enum', () => {
    const enums = databaseEnums();
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const literal of findEnumLiterals(source)) {
        for (const [enumName, values] of enums) {
          if (repeatsEnum(literal, values)) {
            offenders.push(
              `${relative(REPO_ROOT, file)}: [${literal.join(', ')}] repeats ${enumName}`,
            );
          }
        }
      }
    }
    expect(offenders, `import the generated enum schema instead:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('reads enum values from a Prisma schema', () => {
    const schema = [
      'enum Mode {',
      '  IN',
      '  OUT @map("out")',
      '  // note',
      '}',
      'model Row { id String @id }',
    ].join('\n');
    expect(parsePrismaEnums(schema)).toEqual(new Map([['Mode', ['IN', 'OUT']]]));
  });

  it('extracts z.enum literals and standalone as-const string lists', () => {
    expect(findEnumLiterals("const S = z.enum(['a', 'b']);")).toEqual([['a', 'b']]);
    expect(findEnumLiterals("const S = z.enum(['a', 'b'] as const);")).toEqual([['a', 'b']]);
    expect(findEnumLiterals("const M = ['in', 'out'] as const;")).toEqual([['in', 'out']]);
    expect(findEnumLiterals('const N = [1, 2] as const;')).toEqual([]);
  });

  it('flags a copy of two or more values and ignores a single shared value', () => {
    const dbValues = ['PENDING', 'ACCEPTED', 'REVOKED'];
    expect(repeatsEnum(['pending', 'accepted'], dbValues)).toBe(true);
    expect(repeatsEnum(['pending'], dbValues)).toBe(false);
    expect(repeatsEnum(['open', 'closed'], dbValues)).toBe(false);
  });
});
