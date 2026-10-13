// .gitleaks.toml is the only place a finding can be waved through. Every
// exception must therefore be pinned (specific commits, paths and rules) and
// explained, and nothing may switch detection off wholesale: a global
// allowlist, a disabled rule, a regex or stopword list would silently hide
// future leaks everywhere, not just the one historical finding.
//
// The file is checked line by line rather than with a TOML parser because none
// is a direct dependency, and the accepted shape is deliberately tiny.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CONFIG_PATH = join(import.meta.dirname, '..', '.gitleaks.toml');
const REQUIRED_ARRAYS = ['commits', 'paths', 'targetRules'] as const;
const FORBIDDEN_KEYS = ['disabledRules', 'regexes', 'stopwords'] as const;
const FORBIDDEN_TABLE = /^\[\[?\s*(allowlist|rules\b[^\]]*)\s*\]\]?\s*$/;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;

function stripComments(toml: string): string {
  return toml
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/**
 * Items of `key = [ ... ]` in one entry, or undefined when the key is absent
 * or its array never closes. Strings (basic, literal and `'''` literal) may
 * contain `]` (a regex character class), so the scan tracks quoting.
 */
function arrayItems(block: string, key: string): string[] | undefined {
  const start = new RegExp(`^${key}\\s*=\\s*\\[`, 'm').exec(block);
  if (!start) return undefined;
  const items: string[] = [];
  let i = start.index + start[0].length;
  while (i < block.length) {
    const rest = block.slice(i);
    if (rest.startsWith("'''")) {
      const end = rest.indexOf("'''", 3);
      if (end === -1) return undefined;
      items.push(rest.slice(3, end));
      i += end + 3;
    } else if (rest.startsWith('"')) {
      const match = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
      if (!match) return undefined;
      items.push(match[1] ?? '');
      i += match[0].length;
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      if (end === -1) return undefined;
      items.push(rest.slice(1, end));
      i += end + 1;
    } else if (rest.startsWith(']')) {
      return items;
    } else {
      i += 1;
    }
  }
  return undefined;
}

/** @returns human-readable problems; empty when the config is acceptable. */
function validateGitleaksConfig(raw: string): string[] {
  const toml = stripComments(raw);
  const problems: string[] = [];

  for (const line of toml.split('\n')) {
    if (FORBIDDEN_TABLE.test(line.trim())) {
      problems.push(`forbidden table ${line.trim()}`);
    }
  }
  for (const key of FORBIDDEN_KEYS) {
    if (new RegExp(`^\\s*${key}\\s*=`, 'm').test(toml)) {
      problems.push(`forbidden key ${key}`);
    }
  }
  if (!/^\[extend\][^[]*^useDefault\s*=\s*true\s*$/m.test(toml)) {
    problems.push('[extend] must set useDefault = true so the stock rules stay on');
  }

  const entries = toml.split(/^\[\[allowlists\]\]\s*$/m).slice(1);
  entries.forEach((entry, index) => {
    // An entry ends at the next table header of any kind.
    const block = entry.split(/^\[/m)[0] ?? '';
    const label = `allowlists #${index + 1}`;
    const description = /^description\s*=\s*"([^"]*)"/m.exec(block)?.[1] ?? '';
    if (description.trim() === '') problems.push(`${label}: empty or missing description`);
    for (const key of REQUIRED_ARRAYS) {
      const items = arrayItems(block, key);
      if (items === undefined || items.length === 0) {
        problems.push(`${label}: empty or missing ${key}`);
      } else if (items.some((item) => item.trim() === '')) {
        problems.push(`${label}: blank item in ${key}`);
      }
    }
    for (const commit of arrayItems(block, 'commits') ?? []) {
      if (!FULL_COMMIT_SHA.test(commit)) {
        problems.push(`${label}: commits must be full 40-character hashes`);
        break;
      }
    }
  });

  return problems;
}

const VALID_ENTRY = `[extend]
useDefault = true

[[allowlists]]
description = "known historical finding"
targetRules = ["generic-api-key"]
commits = ["${'a'.repeat(40)}"]
paths = ['''^root/src/config\\.ts$''']
`;

describe('.gitleaks.toml', () => {
  it('has only pinned, documented allowlist entries and no global switches', () => {
    expect(validateGitleaksConfig(readFileSync(CONFIG_PATH, 'utf8'))).toEqual([]);
  });

  // A validator that never fails would pass the real file forever.
  it('accepts a fully pinned entry, including a `]` inside a regex path', () => {
    expect(validateGitleaksConfig(VALID_ENTRY)).toEqual([]);
    expect(
      validateGitleaksConfig(
        VALID_ENTRY.replace("'''^root/src/config\\.ts$'''", () => "'''^[a-z]+$'''"),
      ),
    ).toEqual([]);
  });

  it.each(['description', 'commits', 'paths', 'targetRules'])(
    'rejects an entry without %s',
    (key) => {
      const withoutKey = VALID_ENTRY.split('\n')
        .filter((line) => !line.startsWith(`${key} =`))
        .join('\n');
      expect(validateGitleaksConfig(withoutKey)).not.toEqual([]);
    },
  );

  it('rejects empty arrays, blank descriptions and abbreviated commit hashes', () => {
    expect(validateGitleaksConfig(VALID_ENTRY.replace(/paths = \[.*\]/, 'paths = []'))).not.toEqual(
      [],
    );
    expect(
      validateGitleaksConfig(VALID_ENTRY.replace('known historical finding', '  ')),
    ).not.toEqual([]);
    expect(validateGitleaksConfig(VALID_ENTRY.replace('a'.repeat(40), 'a'.repeat(12)))).not.toEqual(
      [],
    );
  });

  it.each([
    ['a global allowlist', '[allowlist]\nregexes = ["x"]\n'],
    ['a rule-level allowlist', '[[rules.allowlists]]\ndescription = "x"\n'],
    ['disabledRules', 'disabledRules = ["generic-api-key"]\n'],
    ['regexes', 'regexes = ["x"]\n'],
    ['stopwords', 'stopwords = ["x"]\n'],
  ])('rejects %s', (_name, extra) => {
    expect(validateGitleaksConfig(`${VALID_ENTRY}\n${extra}`)).not.toEqual([]);
  });

  it('rejects a config that drops the stock rules', () => {
    expect(
      validateGitleaksConfig(VALID_ENTRY.replace('useDefault = true', 'useDefault = false')),
    ).not.toEqual([]);
  });

  it('ignores forbidden words that only appear in comments', () => {
    expect(
      validateGitleaksConfig(`# never add regexes = [] or [allowlist]\n${VALID_ENTRY}`),
    ).toEqual([]);
  });
});
