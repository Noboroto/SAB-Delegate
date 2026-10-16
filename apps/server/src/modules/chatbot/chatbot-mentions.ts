/** A member the model has seen in this turn's context, under the name it was shown. */
type KnownMember = { id: string; name: string };

// Code is left as the model wrote it: an `@Name` there is an example, not a ping.
// An unclosed fence runs to the end, as Discord renders it.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]+`/gu;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const PLACEHOLDER_NAMES = new Set(['deleted user', 'unknown', 'everyone', 'here']);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The names a plain `@Name` may stand for: shown to exactly one id, not a
 * placeholder, longest first so "@Anh Tuấn" wins over "@Anh".
 */
function unambiguousNames(members: readonly KnownMember[]): Map<string, string> {
  const owners = new Map<string, Set<string>>();
  for (const { id, name } of members) {
    if (name === '' || PLACEHOLDER_NAMES.has(name.toLowerCase())) continue;
    const ids = owners.get(name) ?? new Set<string>();
    ids.add(id);
    owners.set(name, ids);
  }
  const names = new Map<string, string>();
  for (const [name, ids] of owners) {
    const [only] = ids;
    if (ids.size === 1 && only !== undefined) names.set(name, only);
  }
  return names;
}

/**
 * Makes the model's mentions real and only real: `@Name` of a member of the
 * conversation becomes `<@id>`, and a `<@id>` of someone the model was never
 * shown is turned into plain `@id`, so it cannot fabricate a ping.
 */
export function mentionMembers(text: string, members: readonly KnownMember[]): string {
  const knownIds = new Set(members.map((member) => member.id));
  const byName = unambiguousNames(members);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const alternatives = names.map((name) => {
    // A name ending in a letter must not be only the start of a longer word.
    const edge = WORD_CHAR.test(name.slice(-1)) ? '(?![\\p{L}\\p{N}_])' : '';
    return `${escapeRegExp(name)}${edge}`;
  });
  const pattern = new RegExp(
    `<@!?(\\d+)>${alternatives.length > 0 ? `|(?<![\\p{L}\\p{N}_])@(${alternatives.join('|')})` : ''}`,
    'gu',
  );

  const rewrite = (plain: string): string =>
    plain.replace(pattern, (whole, id: string | undefined, name: string | undefined) => {
      if (id !== undefined) return knownIds.has(id) ? whole : `@${id}`;
      const owner = name === undefined ? undefined : byName.get(name);
      return owner === undefined ? whole : `<@${owner}>`;
    });

  let result = '';
  let last = 0;
  for (const code of text.matchAll(CODE)) {
    result += rewrite(text.slice(last, code.index)) + code[0];
    last = code.index + code[0].length;
  }
  return result + rewrite(text.slice(last));
}
