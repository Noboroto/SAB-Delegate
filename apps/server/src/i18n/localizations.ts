import { COMMAND_DESCRIPTION_MAX_LENGTH, z, type MESSAGES } from '@sab/shared';
import { translatorFor } from './translator.js';

type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

type Catalog = (typeof MESSAGES)['en'];

/** Any catalog key whose value is a string, e.g. `commands.birthday.description`. */
type TextKey = {
  [N in keyof Catalog]: `${N}.${LeafPaths<Catalog[N]>}`;
}[keyof Catalog];

const text = z.string().trim().min(1).max(COMMAND_DESCRIPTION_MAX_LENGTH);
const LocalizationsSchema = z.object({ vi: text, 'en-US': text, 'en-GB': text });

/**
 * Per-locale texts for a command or option, in the shape Discord's
 * `*_localizations` fields take. Discord has two English tags and the catalog
 * one English text, so both get it; that text is also the base description.
 * Pure on purpose: command declarations run at class-definition time, before
 * any provider exists.
 *
 * Throws if a text is empty or over Discord's limit, so a bad translation
 * fails when the module loads rather than when Discord rejects the payload.
 */
export function localizations(key: TextKey): z.infer<typeof LocalizationsSchema> {
  const english = translatorFor('en')(key);
  return LocalizationsSchema.parse({
    vi: translatorFor('vi')(key),
    'en-US': english,
    'en-GB': english,
  });
}
