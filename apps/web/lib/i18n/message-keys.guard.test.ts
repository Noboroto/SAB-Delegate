import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listWebSources } from '@/lib/code-quality/web-sources';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/locale';

// The translations are read from the catalog files on disk, so a key the
// components use but nobody wrote cannot pass for translated.
const MESSAGES_DIR = join(import.meta.dirname, '../../../../packages/shared/src/messages');

function paths(value: unknown, prefix: string): string[] {
  if (typeof value === 'string') return [prefix];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => paths(child, `${prefix}.${key}`));
}

function catalogPaths(locale: SupportedLocale, namespace: string): Set<string> {
  const file = JSON.parse(
    readFileSync(join(MESSAGES_DIR, locale, `${namespace}.json`), 'utf8'),
  ) as unknown;
  return new Set(paths(file, namespace));
}

const TRANSLATOR =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']+)'\s*\)/g;

/** `[full key path, file]` for every literal `t('key')` call in `source`. */
export function usedKeys(source: string): string[] {
  const keys: string[] = [];
  for (const [, variable, namespace] of source.matchAll(TRANSLATOR)) {
    if (variable === undefined || namespace === undefined) continue;
    for (const call of source.matchAll(new RegExp(`\\b${variable}\\(\\s*'([\\w.-]+)'`, 'g'))) {
      keys.push(`${namespace}.${call[1] ?? ''}`);
    }
  }
  return keys;
}

describe('every translation key the web app asks for exists in every language', () => {
  const used = listWebSources(['app', 'components', 'lib']).flatMap(({ rel, source }) =>
    usedKeys(source).map((key) => ({ key, rel })),
  );

  it('finds the keys the components use', () => {
    expect(used.length).toBeGreaterThan(5);
  });

  it.each(SUPPORTED_LOCALES)('is complete for %s', (locale) => {
    const known = new Map<string, Set<string>>();
    const missing: string[] = [];
    for (const { key, rel } of used) {
      // The namespace is the first segment ('web.theme.light' -> web).
      const namespace = key.split('.')[0] ?? '';
      if (!known.has(namespace)) known.set(namespace, catalogPaths(locale, namespace));
      if (!known.get(namespace)?.has(key)) missing.push(`${rel}: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it('extracts literal calls only', () => {
    const source = `const t = useTranslations('web.theme');\nt('light'); t(\`x.\${y}\`); t("no");`;
    expect(usedKeys(source)).toEqual(['web.theme.light']);
  });
});
