import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A request, response or DB shape declared as an exported interface (or an
// exported object-literal type) is a second source of truth next to its Zod
// schema, and drifts silently. Derive it with `z.infer` instead.
//
// Two shapes are legitimately not Zod-derivable: augmentations of a
// third-party type (`declare module` / `declare global`) and structural
// utility types with no schema equivalent. The first is exempt by structure;
// the second must be listed in ALLOWED as `<repo-relative path>:<TypeName>`
// with the reason, so an exception is a visible, reviewed decision.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const ALLOWED = new Map<string, string>();

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts']);
const SKIPPED_SEGMENTS = new Set(['node_modules', 'dist', '.next', 'generated']);
const TEST_FILE = /\.(test|spec)\.tsx?$/;

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function findExportedShapes(source: string): string[] {
  const sourceFile = ts.createSourceFile('scanned.tsx', source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  // Only top-level statements: anything inside `declare module/global` is an
  // augmentation and never reaches this loop.
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isInterfaceDeclaration(statement)) names.push(statement.name.text);
    if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
      names.push(statement.name.text);
    }
  }
  return names;
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
        .filter((rel) => SOURCE_EXTENSIONS.has(extname(rel)) && !TEST_FILE.test(rel))
        .filter((rel) => !rel.split(/[\\/]/).some((segment) => SKIPPED_SEGMENTS.has(segment)))
        .map((rel) => join(root, rel)),
    );
}

describe('exported shapes come from Zod', () => {
  it('scans real source files', () => {
    expect(scannedFiles().length).toBeGreaterThan(0);
  });

  it('no source file exports an interface or object-literal type outside ALLOWED', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const rel = relative(REPO_ROOT, file).split(/[\\/]/).join('/');
      for (const name of findExportedShapes(readFileSync(file, 'utf8'))) {
        if (!ALLOWED.has(`${rel}:${name}`)) offenders.push(`${rel}: ${name}`);
      }
    }
    expect(offenders, `derive these from a Zod schema:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('flags an exported interface and an exported object-literal type', () => {
    expect(findExportedShapes('export interface A { id: string }')).toEqual(['A']);
    expect(findExportedShapes('export type B = { id: string };')).toEqual(['B']);
  });

  it('accepts z.infer aliases, unexported shapes and third-party augmentations', () => {
    expect(findExportedShapes('export type A = z.infer<typeof ASchema>;')).toEqual([]);
    expect(findExportedShapes('interface A { id: string }\ntype B = { id: string };')).toEqual([]);
    expect(
      findExportedShapes("declare module 'fastify' { interface FastifyRequest { id: string } }"),
    ).toEqual([]);
    expect(findExportedShapes('declare global { interface Window { id: string } }')).toEqual([]);
  });
});
