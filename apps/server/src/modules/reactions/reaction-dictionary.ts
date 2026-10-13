import { Injectable } from '@nestjs/common';
import { REACTION_PHRASES } from '@sab/shared';
import { EMOJI_SOURCE } from './emoji-resolver.js';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "react <emoji>" anywhere in the text; `react` need not start a word. */
const REACT_COMMAND = new RegExp(String.raw`react\s+(${EMOJI_SOURCE})`, 'giu');

type CompiledPhrase = { readonly pattern: RegExp; readonly reactions: readonly string[] };

/**
 * What to react with for a message's text: the emoji of every "react <emoji>"
 * it contains, then the reactions of every dictionary phrase it contains.
 * A phrase matches whole words only, ignoring case, so "react no" fires on
 * "React NO please" and not on "react nothing". Each emoji appears once even
 * when both rules produce it.
 */
@Injectable()
export class ReactionDictionary {
  private readonly phrases: readonly CompiledPhrase[] = Object.entries(REACTION_PHRASES).map(
    ([phrase, reactions]) => ({
      // Delimited by whitespace or the ends of the text, which is what "whole
      // word" has always meant for phrases that end in an emoji.
      pattern: new RegExp(String.raw`(^|\s)${escapeRegExp(phrase.toLowerCase())}(?=\s|$)`, 'u'),
      reactions,
    }),
  );

  reactionsFor(content: string): string[] {
    const found = new Set<string>();
    for (const match of content.matchAll(REACT_COMMAND)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
    const lowered = content.toLowerCase();
    for (const { pattern, reactions } of this.phrases) {
      if (pattern.test(lowered)) for (const reaction of reactions) found.add(reaction);
    }
    return [...found];
  }
}
