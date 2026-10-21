import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('singleton rows', () => {
  // Why: see SmtpConfigService.row (batched findUnique on a Boolean unique field fails).
  it('are read with findFirst, never findUnique by `singleton`', () => {
    const offenders = sources(SRC).filter((file) =>
      /findUnique(?:OrThrow)?\([\s\S]{0,300}?\bsingleton\b/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });
});
