import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const WEB_ROOT = join(import.meta.dirname, '..', '..');

interface WebSource {
  /** POSIX path relative to `apps/web`. */
  rel: string;
  source: string;
}

const SKIP_DIRS = new Set(['node_modules', 'coverage']);
// The guards spell out the patterns they hunt for, so scanning them would make
// every guard flag its own detector.
const GUARD_TOOLING_DIR = 'lib/code-quality/';

/** Product `.ts`/`.tsx` files under the given `apps/web` sub-directories; tests and `.d.ts` are excluded. */
export function listWebSources(dirs: readonly string[]): WebSource[] {
  const out: WebSource[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      const rel = relative(WEB_ROOT, full).split('\\').join('/');
      if (!rel.startsWith(GUARD_TOOLING_DIR)) out.push({ rel, source: readFileSync(full, 'utf8') });
    }
  };
  for (const dir of dirs) walk(join(WEB_ROOT, dir));
  return out;
}

export function isClientModule(source: string): boolean {
  return /^\s*(['"])use client\1/.test(source);
}
