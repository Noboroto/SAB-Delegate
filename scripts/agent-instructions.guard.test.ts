// AGENTS.md at the repo root is the only agent-instruction file. Claude Code
// reads AGENTS.md only when no CLAUDE.md/CLAUDE.local.md exists in the working
// directory or its parents, so a stray CLAUDE.md anywhere silently disables the
// project rules for any session started there. Next.js 16.3+ `next dev` writes
// both files into the app directory unless `agentRules: false` is set.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'plans']);
const FORBIDDEN = /^CLAUDE(\.local)?\.md$/i;

function findForbiddenInstructionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) findForbiddenInstructionFiles(path, out);
    else if (FORBIDDEN.test(entry.name)) out.push(relative(ROOT, path).replace(/\\/g, '/'));
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
});
