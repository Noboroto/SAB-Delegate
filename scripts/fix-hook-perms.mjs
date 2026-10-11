// Asserts the husky hook wrappers are executable, repairing them if not.
//
// Git does not run a hook it cannot execute, and does not fail either: it
// prints one `hint:` line into the install noise and carries on. That is how
// a repo's only quality gate can sit switched off - no prettier, no eslint,
// no typecheck, no suite, no 29-file cap - through commits and pushes that
// all look green.
//
// husky itself writes these 0755. The bit gets stripped from OUTSIDE: a
// checkout replicated between machines by a permission-ignoring sync
// recreates files with the default 0644. Anything that rewrites the tree
// without carrying modes - an archive restore, a copy off a FAT/exFAT volume
// - does the same.
//
// Scoped to `.husky/_` because that is the only directory whose execute bit
// git actually consults: `.husky/_/h` starts the real hook scripts through an
// explicit interpreter, so their own mode is irrelevant. `_` is also
// generated and gitignored, so writing to it can never dirty the tree.
//
// Windows has no POSIX execute bit for this to repair or verify (Git for
// Windows does not consult it and runs the hooks through `sh` regardless), so
// this check is a no-op there rather than a failure — an install that always
// ends red trains everyone to ignore the one failure that would matter.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const WRAPPER_DIR = path.resolve(import.meta.dirname, '..', '.husky', '_');
const HAS_EXECUTE_BIT = process.platform !== 'win32';

// Absent in Docker builds: an image COPYs package.json, so `prepare` runs,
// but never `.husky/` - and pnpm fails the entire install on a prepare that
// exits non-zero.
if (HAS_EXECUTE_BIT && existsSync(WRAPPER_DIR)) {
  const stillBroken = [];

  for (const entry of readdirSync(WRAPPER_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === '.gitignore') continue;
    const full = path.join(WRAPPER_DIR, entry.name);
    const mode = statSync(full).mode & 0o777;
    // Mirror the read bits into execute so a 0600 file stays private.
    chmodSync(full, mode | ((mode & 0o444) >> 2));
    // Re-stat rather than trust the call: on a read-only mount or a file owned
    // by someone else chmod reports success and changes nothing, which would
    // hand back exactly the silent dead gate this script exists to prevent.
    if ((statSync(full).mode & 0o111) === 0) stillBroken.push(entry.name);
  }

  if (stillBroken.length > 0) {
    console.error(
      `Could not make these git hooks executable: ${stillBroken.join(', ')}.\n` +
        `Git will SKIP them silently and every commit and push will run unchecked.\n` +
        `Fix the permissions under .husky/_ before committing.`,
    );
    process.exit(1);
  }
}
