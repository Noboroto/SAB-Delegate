import { Logger } from '@nestjs/common';
import { MESSAGES, toSupportedLocale, type Locale } from '@sab/shared';
import { createTranslator } from 'use-intl/core';

/**
 * Whoever arrives with a language the catalog lacks gets English, the common
 * second language of Discord clients. A guild without a stored choice is a
 * different case and defaults to Vietnamese (see `resolveLocale`).
 */
const FALLBACK_LOCALE: Locale = 'en';

const logger = new Logger('Translator');

// The English tree is the type of record: assigning Vietnamese to it makes a
// key present in one language and missing from the other a compile error.
type Catalog = (typeof MESSAGES)['en'];

function buildTranslator(locale: Locale) {
  const messages: Catalog = MESSAGES[locale];
  return createTranslator({
    locale,
    messages,
    // A formatting problem (a placeholder with no value) must not stop a reply
    // from going out; the translator then answers with the key path instead.
    onError: (error) => logger.warn(`${locale}: ${error.code}: ${error.message}`),
  });
}

const translators = new Map<Locale, ReturnType<typeof buildTranslator>>();

/**
 * ICU translator over the shared catalog (`common.*`, `commands.*`, `errors.*`).
 * Keys are checked against the catalog at compile time; build once per language.
 */
export function translatorFor(locale: string): ReturnType<typeof buildTranslator> {
  const resolved = toSupportedLocale(locale) ?? FALLBACK_LOCALE;
  let translator = translators.get(resolved);
  if (translator === undefined) {
    translator = buildTranslator(resolved);
    translators.set(resolved, translator);
  }
  return translator;
}
