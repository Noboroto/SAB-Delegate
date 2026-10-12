// A reader who only has the repo (human or AI) must be able to follow every
// reference in tracked code, comments, docs and memories: no links into the
// gitignored plans/ tree, no machine-local paths, and every cited docs/ file
// must itself be tracked.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.pdf',
  '.zip',
  '.db',
  '.sqlite',
]);

interface Violation {
  reason: string;
  test: (line: string) => boolean;
}

const VIOLATIONS: Violation[] = [
  {
    reason: 'reference to gitignored plans/ directory',
    test: (line) => /\bplans\//.test(line),
  },
  {
    reason: 'local machine path',
    test: (line) => /\/(Users|home)\//.test(line),
  },
  {
    reason: 'Windows drive path',
    test: (line) => /(^|[\s`'"(])[A-Za-z]:[\\/]/.test(line),
  },
  {
    reason: 'reference to a plan report path (reports/…) without the plans/ prefix',
    test: (line) => /\breports\//.test(line) && !/\bplans\//.test(line),
  },
  {
    reason: 'reference to a gitignored plan-folder name (YYMMDD-HHMM-slug/)',
    test: (line) => /\b\d{6}-\d{4}-[a-z0-9-]+\//.test(line),
  },
];

// Whole files whose matches are ignore patterns, not links. `file` is the
// exact `git ls-files` path.
const FILE_ALLOWLIST: Array<{ file: string; reason: string }> = [
  { file: '.gitignore', reason: 'lists the ignore patterns themselves, not links to them' },
  { file: 'eslint.config.mjs', reason: 'lint ignore globs (plans/**), not links' },
  {
    file: 'scripts/no-untracked-references.guard.test.ts',
    reason: 'this file holds the forbidden patterns as strings in order to detect them',
  },
];

// Single lines that state the rule itself or describe where plans live.
// Line-level, so any other line added to the same file is still checked.
const LINE_ALLOWLIST: Array<{ file: string; line: RegExp; reason: string }> = [
  {
    file: 'AGENTS.md',
    line: /^\| Tham chiếu path\/URL git không track/,
    reason: 'the hard-rule row names the forbidden patterns as examples',
  },
  {
    file: 'AGENTS.md',
    line: /^- Plan: `plans\/<YYMMDD-HHMM>-<slug>\/`/,
    reason: 'describes the naming convention of the local plan folder, not a link to one file',
  },
];

// Memories are imported lessons that name docs a sibling repo keeps; the
// docs-existence check would fail on a file this repo has not written yet.
// They are still checked for the other untracked-reference patterns.
function isMemoryFile(file: string): boolean {
  return file.startsWith('.serena/memories/');
}

function isFileAllowed(file: string): boolean {
  return FILE_ALLOWLIST.some((entry) => entry.file === file);
}

function isLineAllowed(file: string, line: string): boolean {
  return LINE_ALLOWLIST.some((entry) => entry.file === file && entry.line.test(line));
}

function findViolations(content: string, file = ''): string[] {
  const found: string[] = [];
  for (const line of content.split('\n')) {
    if (isLineAllowed(file, line)) continue;
    for (const violation of VIOLATIONS) {
      if (violation.test(line)) {
        found.push(violation.reason);
      }
    }
  }
  return found;
}

// `-z`: without it git quotes non-ASCII paths (core.quotePath) and the read
// below would miss them.
function listTrackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

function readText(file: string): string | undefined {
  const ext = file.includes('.') ? file.slice(file.lastIndexOf('.')) : '';
  if (BINARY_EXTENSIONS.has(ext)) return undefined;
  let content: string;
  try {
    content = readFileSync(join(REPO_ROOT, file), 'utf8');
  } catch (error) {
    // A tracked submodule/gitlink is a directory, and a tracked file deleted
    // in the working tree (not yet staged) has no content to check. Anything
    // else is a real error.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EISDIR' || code === 'ENOENT') return undefined;
    throw error;
  }
  return content.includes('\u0000') ? undefined : content;
}

describe('no references to untracked paths/URLs in tracked files', () => {
  it('every tracked text file only references paths git tracks', () => {
    const offenders: Array<{ file: string; reasons: string[] }> = [];
    for (const file of listTrackedFiles()) {
      if (isFileAllowed(file)) continue;
      const content = readText(file);
      if (content === undefined) continue;
      const reasons = findViolations(content, file);
      if (reasons.length > 0) offenders.push({ file, reasons: [...new Set(reasons)] });
    }
    expect(offenders).toEqual([]);
  });

  it('every cited docs/**.md file is itself tracked', () => {
    const tracked = new Set(listTrackedFiles());
    const missing: Array<{ file: string; target: string }> = [];
    for (const file of tracked) {
      if (isFileAllowed(file) || isMemoryFile(file)) continue;
      const content = readText(file);
      if (content === undefined) continue;
      for (const match of content.matchAll(/(?<![\w/.-])docs\/[\w/.-]+\.md\b/g)) {
        if (!tracked.has(match[0])) missing.push({ file, target: match[0] });
      }
    }
    expect(missing).toEqual([]);
  });

  // A guard that scans a currently clean repo and asserts `[]` can pass
  // vacuously forever. Prove the detector flags each forbidden pattern, on
  // inline fixture strings rather than real files.
  it('flags a plans/ reference', () => {
    expect(findViolations('See `plans/261011-1027-some-plan/plan.md`.')).toContain(
      'reference to gitignored plans/ directory',
    );
  });

  it('flags a local machine path', () => {
    expect(findViolations('Repo root: /Users/someone/Github/SAB-Delegate')).toContain(
      'local machine path',
    );
  });

  it('flags a /home/ machine path', () => {
    expect(findViolations('Clone into /home/runner/work/repo.')).toContain('local machine path');
  });

  it('flags a Windows drive path', () => {
    expect(findViolations('Checkout lives at D:\\Github\\SAB-Delegate.')).toContain(
      'Windows drive path',
    );
  });

  it('flags a bare reports/ reference', () => {
    expect(findViolations('Details: `reports/spike-notes.md`.')).toContain(
      'reference to a plan report path (reports/…) without the plans/ prefix',
    );
  });

  it('flags a plan-folder name reference', () => {
    expect(findViolations('See `261011-1027-some-plan/plan.md`.')).toContain(
      'reference to a gitignored plan-folder name (YYMMDD-HHMM-slug/)',
    );
  });

  it('exempts only the listed AGENTS.md lines, not the rest of the file', () => {
    const ruleRow = '| Tham chiếu path/URL git không track (`plans/`, `/Users/...`) | ... |';
    expect(findViolations(ruleRow, 'AGENTS.md')).toEqual([]);
    expect(findViolations('Xem `plans/x/plan.md`.', 'AGENTS.md')).toContain(
      'reference to gitignored plans/ directory',
    );
  });

  it('does not flag ordinary repo-relative text', () => {
    expect(findViolations('See `docs/stack-decisions.md` for the pinned versions.')).toEqual([]);
  });
});
