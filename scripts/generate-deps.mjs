// Builds the artifacts every typecheck/lint/test run depends on: the
// `packages/shared` output, and (unless `--shared-only`) the server's generated
// Prisma client and Zod schemas, which land inside shared and so need shared
// built once more afterwards.
//
// Each step is skipped when its package or script does not exist yet, so the
// root tooling stays valid on a workspace with no packages.
//
// Every step is idempotent and slow, and a single hook run reaches them several
// times over: the root `prelint`/`pretypecheck` each call this, and
// `pnpm -r typecheck` re-runs the packages' own `pretypecheck` on top. Nothing
// between those steps invalidates the artifacts, so every run after the first
// is pure wall clock.
//
// SAB_DEPS_READY is the deduplication: a hook generates once, exports the
// flag, and every nested pnpm process inherits it and returns immediately.
// The flag is deliberately scoped to one hook invocation rather than cached on
// disk - there is no hash to go stale, and a developer running
// `pnpm typecheck` directly still gets a full regeneration.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.SAB_DEPS_READY === '1') {
  process.exit(0);
}

const SHARED_DIR = 'packages/shared';
const SERVER_DIR = 'apps/server';

const sharedOnly = process.argv.includes('--shared-only');

/** @param {string} dir @param {string} script */
function hasScript(dir, script) {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  /** @type {{ scripts?: Record<string, string> }} */
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  return typeof parsed.scripts?.[script] === 'string';
}

// One command string rather than (cmd, args[]) with shell:true - Node warns
// DEP0190 for that combination, because args are concatenated rather than
// escaped. Nothing here is user input, but the warning is noise on every hook
// run and the single-string form is what `shell: true` actually wants.
const steps = [];
const buildsShared = hasScript(SHARED_DIR, 'build');
if (buildsShared) {
  steps.push(`pnpm --filter ./${SHARED_DIR} run build`);
}
if (!sharedOnly && hasScript(SERVER_DIR, 'db:generate')) {
  steps.push(`pnpm --filter ./${SERVER_DIR} run db:generate`);
  if (buildsShared) {
    steps.push(`pnpm --filter ./${SHARED_DIR} run build`);
  }
}

for (const step of steps) {
  const res = spawnSync(step, { stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}
