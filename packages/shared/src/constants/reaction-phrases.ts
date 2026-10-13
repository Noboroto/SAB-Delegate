/**
 * Phrase to reactions. Matching is case-insensitive and on whole words: the
 * message and each phrase are lowercased, and a phrase must be delimited by
 * whitespace or the ends of the message, so "react no" does not fire on "react nothing".
 * A reaction that is not an emoji character names a custom emoji of the guild.
 */
export const REACTION_PHRASES: Readonly<Record<string, readonly string[]>> = {
  'React 👌': ['👌'],
  'react ok': ['👌'],
  'react error': ['❌'],
  'react warning': ['⚠️'],
  'react info': ['ℹ️'],
  'react debug': ['🐛'],
  'react success': ['✅'],
  'react fatal': ['💀'],
  'react yes no': ['yes', 'no'],
  'react yes': ['yes'],
  'react no': ['no'],
  'react ok cancel': ['ok', '❌'],
};
