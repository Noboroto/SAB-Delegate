import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErrorCodeSchema } from '../errors/error-code.js';
import { LocaleSchema, type Locale } from '../utils/locale.js';
import { MessageRefFailureSchema } from '../utils/message-ref.js';
import { COMMAND_DESCRIPTION_MAX_LENGTH, MESSAGES, MessageNamespaceSchema } from './index.js';

// The catalog is read from disk, not through the barrel, so a file the barrel
// forgot to import (or a stale build) cannot pass for translated.
const MESSAGES_DIR = __dirname;
const LOCALES = LocaleSchema.options;

function fileNames(locale: Locale): string[] {
  return readdirSync(join(MESSAGES_DIR, locale))
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function readNamespace(locale: Locale, namespace: string): unknown {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, locale, `${namespace}.json`), 'utf8'));
}

/** `{ a: { b: 'x' } }` -> `Map { 'a.b' => 'x' }`; anything but string or object is rejected. */
function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === 'string') {
    out.set(prefix, value);
  } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, text] of flatten(child, prefix === '' ? key : `${prefix}.${key}`)) {
        out.set(path, text);
      }
    }
  } else {
    throw new Error(`catalog value at "${prefix}" must be a string or an object`);
  }
  return out;
}

function catalog(locale: Locale): Map<string, string> {
  const merged = new Map<string, string>();
  for (const file of fileNames(locale)) {
    const namespace = file.replace(/\.json$/, '');
    for (const [path, text] of flatten(readNamespace(locale, namespace), namespace)) {
      merged.set(path, text);
    }
  }
  return merged;
}

/** ICU argument names, so `{count}` renamed in one language is caught. */
function argumentNames(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1] ?? ''))].sort();
}

describe('message catalog parity', () => {
  it('has the same files in every language, and they are the barrel namespaces', () => {
    const expected = MessageNamespaceSchema.options.map((ns) => `${ns}.json`).sort();
    for (const locale of LOCALES) expect(fileNames(locale), locale).toEqual(expected);
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort(), locale).toEqual(
        [...MessageNamespaceSchema.options].sort(),
      );
    }
  });

  it('exposes through the barrel exactly what the files on disk say', () => {
    for (const locale of LOCALES) {
      for (const namespace of MessageNamespaceSchema.options) {
        expect(MESSAGES[locale][namespace], `${locale}/${namespace}`).toEqual(
          readNamespace(locale, namespace),
        );
      }
    }
  });

  it('has the same key paths in vi and en', () => {
    expect([...catalog('vi').keys()].sort()).toEqual([...catalog('en').keys()].sort());
  });

  it('has no empty string and the same ICU arguments in vi and en', () => {
    const vi = catalog('vi');
    const en = catalog('en');
    for (const [path, text] of en) {
      expect(text.trim(), `en ${path}`).not.toBe('');
      expect(vi.get(path)?.trim(), `vi ${path}`).not.toBe('');
      expect(argumentNames(vi.get(path) ?? ''), path).toEqual(argumentNames(text));
    }
  });

  it('explains every ErrorCode in every language', () => {
    for (const locale of LOCALES) {
      const keys = catalog(locale);
      for (const code of ErrorCodeSchema.options) {
        expect(keys.get(`errors.${code}`), `${locale} errors.${code}`).toBeTruthy();
      }
    }
  });

  it('explains every message-reference failure in every language', () => {
    for (const locale of LOCALES) {
      const keys = catalog(locale);
      for (const reason of MessageRefFailureSchema.options) {
        expect(keys.get(`errors.invalidLink.${reason}`), `${locale} ${reason}`).toBeTruthy();
      }
    }
  });

  it('keeps every command description within the length Discord allows', () => {
    for (const locale of LOCALES) {
      const descriptions = [...catalog(locale)].filter(([path]) => path.startsWith('commands.'));
      expect(descriptions.length).toBeGreaterThan(0);
      for (const [path, text] of descriptions) {
        expect(path, locale).toMatch(/^commands\.[a-z0-9-]+\.description$/);
        expect(text.length, `${locale} ${path}`).toBeLessThanOrEqual(
          COMMAND_DESCRIPTION_MAX_LENGTH,
        );
      }
    }
    expect([...catalog('en').keys()].filter((p) => p.startsWith('commands.')).length).toBe(19);
  });
});

// Vietnamese puts the tone mark of "oa", "oe" and "uy" on the second vowel here
// (Xoá, khoá, Huỷ, hoà, thoả, tuỳ). The old placement (Xóa, khóa, Hủy, hòa,
// thỏa, tùy) is a different spelling of the same words and must not mix in.
const OLD_PLACEMENT = /[óòỏõọ][ae]|[úùủũụ]y/iu;
const LISTED_FORMS = /xóa|khóa|hủy|hòa|thỏa|tùy/iu;

function oldSpelling(text: string): string | undefined {
  const normal = text.normalize('NFC');
  return LISTED_FORMS.exec(normal)?.[0] ?? OLD_PLACEMENT.exec(normal)?.[0];
}

describe('Vietnamese spelling guard', () => {
  it('finds no old tone placement in any vi string', () => {
    for (const [path, text] of catalog('vi')) {
      expect(oldSpelling(text), `vi ${path}: "${text}"`).toBeUndefined();
    }
  });

  it('flags the old forms, accented or not, in any case, in composed or decomposed text', () => {
    for (const bad of ['Xóa', 'khóa', 'HỦY', 'hòa', 'thỏa', 'tùy', 'thủy', 'khỏe', 'họa']) {
      expect(oldSpelling(bad), bad).toBeDefined();
      expect(oldSpelling(bad.normalize('NFD')), `${bad} decomposed`).toBeDefined();
    }
  });

  it('accepts the repository spelling and unrelated words', () => {
    for (const good of ['Xoá', 'khoá', 'Huỷ', 'hoà', 'thoả', 'tuỳ', 'toán', 'quyền', 'quý']) {
      expect(oldSpelling(good), good).toBeUndefined();
    }
  });
});
