import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Unknown keys must be stripped, never rejected or passed through: `.strict()`
// breaks the day the server adds a field, `.passthrough()` leaks data nobody
// validated. Read from the AST so a comment or test title that merely names a
// toggle is not mistaken for a call. Generated Zod output is scanned too.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts']);
const SKIPPED_SEGMENTS = new Set(['node_modules', 'dist', '.next']);

const BANNED_METHODS = new Set([
  'strict',
  'passthrough',
  'loose',
  'strictObject',
  'looseObject',
  'catchall',
]);
const BANNED_BARE_FUNCTIONS = new Set(['strictObject', 'looseObject']);

function calleeName(callee: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return undefined;
}

function callsBannedToggle(source: string): boolean {
  const sourceFile = ts.createSourceFile('scanned.tsx', source, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (
        (name !== undefined && BANNED_METHODS.has(name)) ||
        (ts.isIdentifier(node.expression) && BANNED_BARE_FUNCTIONS.has(node.expression.text))
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function sourceRoots(): string[] {
  return ['apps', 'packages'].flatMap((group) => {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) return [];
    return readdirSync(groupDir).map((name) => join(groupDir, name, 'src'));
  });
}

function scannedFiles(): string[] {
  return sourceRoots()
    .filter((root) => existsSync(root))
    .flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((rel) => SOURCE_EXTENSIONS.has(extname(rel)))
        .filter((rel) => !rel.split(/[\\/]/).some((segment) => SKIPPED_SEGMENTS.has(segment)))
        .map((rel) => join(root, rel)),
    );
}

describe('zod object-mode toggles', () => {
  it('scans real source files', () => {
    expect(scannedFiles().length).toBeGreaterThan(0);
  });

  it('no source file calls strict, passthrough, loose, strictObject, looseObject or catchall', () => {
    const offenders = scannedFiles()
      .filter((file) => callsBannedToggle(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO_ROOT, file));
    expect(offenders, `banned zod toggle in:\n${offenders.join('\n')}`).toEqual([]);
  });

  it.each([
    ['method call', 'const S = z.object({ a: z.string() }).strict();'],
    ['top-level function', 'const S = z.looseObject({ a: z.string() });'],
    ['bracket access', "const S = z.object({})['passthrough']();"],
    ['optional chaining', 'const S = maybe?.catchall(z.string());'],
    ['bare named import', "import { strictObject } from 'zod';\nconst S = strictObject({});"],
    ['tsx source', 'const S = z.object({}).loose();\nexport const C = () => <div />;'],
  ])('detects the %s form', (_label, source) => {
    expect(callsBannedToggle(source)).toBe(true);
  });

  it('ignores comments, strings and a same-named property that is not called', () => {
    expect(callsBannedToggle('// never call .strict() here\nconst S = z.object({});')).toBe(false);
    expect(callsBannedToggle("const note = '.passthrough()';")).toBe(false);
    expect(callsBannedToggle('const mode = config.strict;')).toBe(false);
  });
});
