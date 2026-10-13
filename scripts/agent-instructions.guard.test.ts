// AGENTS.md at the repo root is the only agent-instruction file. Claude Code
// reads AGENTS.md only when no CLAUDE.md/CLAUDE.local.md exists in the working
// directory or its parents, so a stray CLAUDE.md anywhere silently disables the
// project rules for any session started there. Next.js 16.3+ `next dev` writes
// both files into the app directory unless `agentRules: false` is set.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'plans']);
const FORBIDDEN = /^CLAUDE(\.local)?\.md$/i;

function findForbiddenInstructionFiles(
  root: string,
  dir: string = root,
  out: string[] = [],
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) findForbiddenInstructionFiles(root, path, out);
    else if (FORBIDDEN.test(entry.name)) out.push(relative(root, path).replace(/\\/g, '/'));
  }
  return out;
}

describe('agent instruction files', () => {
  it('has no CLAUDE.md or CLAUDE.local.md anywhere in the repo', () => {
    expect(findForbiddenInstructionFiles(ROOT)).toEqual([]);
  });

  it('keeps AGENTS.md at the repo root', () => {
    expect(readdirSync(ROOT)).toContain('AGENTS.md');
  });

  // A guard that scans a clean tree and asserts `[]` can pass vacuously forever.
  it('recognises the forbidden file names', () => {
    expect(FORBIDDEN.test('CLAUDE.md')).toBe(true);
    expect(FORBIDDEN.test('CLAUDE.local.md')).toBe(true);
    expect(FORBIDDEN.test('AGENTS.md')).toBe(false);
  });

  // Runs the real scan over a throwaway tree, so a regression in the walk
  // itself (skip list, nesting, case handling) fails here and not silently.
  it('finds nested forbidden files and skips excluded directories', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sab-agent-instructions-'));
    try {
      mkdirSync(join(fixture, 'apps', 'web'), { recursive: true });
      mkdirSync(join(fixture, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(fixture, 'AGENTS.md'), '');
      writeFileSync(join(fixture, 'CLAUDE.md'), '');
      writeFileSync(join(fixture, 'apps', 'web', 'claude.local.md'), '');
      writeFileSync(join(fixture, 'node_modules', 'pkg', 'CLAUDE.md'), '');
      expect(findForbiddenInstructionFiles(fixture).sort()).toEqual([
        'CLAUDE.md',
        'apps/web/claude.local.md',
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
