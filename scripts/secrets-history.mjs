// Scans the full git history (every ref) with gitleaks and prints ONLY
// commit / file / line / rule for each finding - never the matched text. Exit
// codes: 0 clean, 1 findings or a broken allowlist, 2 gitleaks is missing or
// failed to run.
//
// gitleaks is an external binary (Homebrew on the Mac, the official release
// elsewhere); the npm wrappers were rejected in the stack decisions because
// they download the binary in a postinstall script.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONFIG_PATH = '.gitleaks.toml';
// Any value other than 0 (clean) and this one means gitleaks itself failed.
const LEAKS_EXIT_CODE = 3;

if (!existsSync(CONFIG_PATH)) {
  console.error(`${CONFIG_PATH} is missing; run this from the repo root.`);
  process.exit(2);
}

// An allowlist entry without a description is an unexplained exception.
const blocks = readFileSync(CONFIG_PATH, 'utf8').split(/^\[\[allowlists\]\]\s*$/m).slice(1);
const undocumented = blocks
  .map((block, index) => ({ index: index + 1, ok: /^description\s*=\s*"[^"]+"/m.test(block) }))
  .filter((entry) => !entry.ok)
  .map((entry) => entry.index);
if (undocumented.length > 0) {
  console.error(
    `${CONFIG_PATH}: allowlist entr${undocumented.length === 1 ? 'y' : 'ies'} #${undocumented.join(', #')} ha${undocumented.length === 1 ? 's' : 've'} no description.`,
  );
  process.exit(1);
}

const probe = spawnSync('gitleaks', ['version'], { stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  console.error('gitleaks is not installed. Install it (`brew install gitleaks`) and re-run.');
  process.exit(2);
}

/** @returns {number} the process exit code; cleanup always runs before exiting. */
function scanHistory() {
  const workDir = mkdtempSync(join(tmpdir(), 'sab-gitleaks-'));
  const reportPath = join(workDir, 'report.json');
  try {
    const result = spawnSync(
      'gitleaks',
      [
        'git',
        '--config',
        CONFIG_PATH,
        '--log-opts=--all',
        '--redact',
        '--no-banner',
        '--no-color',
        '--exit-code',
        String(LEAKS_EXIT_CODE),
        '--report-format',
        'json',
        '--report-path',
        reportPath,
      ],
      // gitleaks narrates findings (with redacted text) on stderr; keep it out
      // of the transcript and print our own value-free summary below.
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    if (result.error || (result.status !== 0 && result.status !== LEAKS_EXIT_CODE)) {
      console.error(`gitleaks failed to run (exit ${result.status ?? 'none'}).`);
      return 2;
    }
    if (!existsSync(reportPath)) {
      console.error('gitleaks wrote no report.');
      return 2;
    }

    /** @type {Array<{ Commit?: string, File?: string, StartLine?: number, RuleID?: string }>} */
    const findings = JSON.parse(readFileSync(reportPath, 'utf8')) ?? [];
    if (findings.length === 0) {
      console.log('secrets:history - no findings outside the documented allowlist.');
      return 0;
    }
    console.error(`secrets:history - ${findings.length} finding(s); values withheld:`);
    for (const finding of findings) {
      const commit = (finding.Commit ?? '').slice(0, 12);
      const where = `${finding.File ?? '?'}:${finding.StartLine ?? '?'}`;
      console.error(`  ${commit} ${where} ${finding.RuleID ?? '?'}`);
    }
    return 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

process.exitCode = scanHistory();
