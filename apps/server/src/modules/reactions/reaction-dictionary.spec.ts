import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { REACTION_PHRASES } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import { ReactionDictionary } from './reaction-dictionary.js';

const dictionary = new ReactionDictionary();
const CUSTOM = '<a:party:123456789012345678>';

describe('ReactionDictionary phrases', () => {
  it('matches whole words only: "react no" does not fire on "react nothing"', () => {
    expect(dictionary.reactionsFor('react no')).toEqual(['no']);
    expect(dictionary.reactionsFor('react nothing')).toEqual([]);
    expect(dictionary.reactionsFor('react not')).toEqual([]);
    expect(dictionary.reactionsFor('please react no now')).toEqual(['no']);
  });

  it('ignores case', () => {
    expect(dictionary.reactionsFor('REACT OK')).toEqual(['👌']);
    expect(dictionary.reactionsFor('React Success')).toEqual(['✅']);
  });

  it('needs the phrase to be delimited by whitespace or the ends of the text', () => {
    expect(dictionary.reactionsFor('react ok!')).toEqual([]);
    expect(dictionary.reactionsFor('xreact ok')).toEqual([]);
    expect(dictionary.reactionsFor('react\nok')).toEqual([]);
  });

  it('gives every reaction of a longer phrase once, even when a shorter phrase repeats it', () => {
    expect(dictionary.reactionsFor('react yes no')).toEqual(['yes', 'no']);
    expect(dictionary.reactionsFor('react ok cancel')).toEqual(['👌', 'ok', '❌']);
  });

  it('answers every entry of the shared dictionary with its reactions', () => {
    for (const [phrase, reactions] of Object.entries(REACTION_PHRASES)) {
      expect(dictionary.reactionsFor(phrase), phrase).toEqual(
        expect.arrayContaining([...reactions]),
      );
    }
  });

  it('finds nothing in ordinary text', () => {
    expect(dictionary.reactionsFor('')).toEqual([]);
    expect(dictionary.reactionsFor('hello everyone, the react library is fine')).toEqual([]);
  });

  it('does not treat dictionary text as a pattern', () => {
    // "react 👌" contains no metacharacters, but the compiled form must still be literal.
    expect(dictionary.reactionsFor('react 👌')).toEqual(['👌']);
    expect(dictionary.reactionsFor('react .*')).toEqual([]);
  });
});

describe('ReactionDictionary "react <emoji>"', () => {
  it('takes a unicode emoji and a custom one', () => {
    expect(dictionary.reactionsFor('react 🎉')).toEqual(['🎉']);
    expect(dictionary.reactionsFor(`react ${CUSTOM}`)).toEqual([CUSTOM]);
    expect(dictionary.reactionsFor('react <:blob:123456789012345678>')).toEqual([
      '<:blob:123456789012345678>',
    ]);
  });

  it('takes each command in the text, in order', () => {
    expect(dictionary.reactionsFor(`react 🎉 and also react ${CUSTOM} then react 🔥`)).toEqual([
      '🎉',
      CUSTOM,
      '🔥',
    ]);
  });

  it('puts the commands before the dictionary phrases and does not repeat an emoji', () => {
    expect(dictionary.reactionsFor('react ok react 🔥')).toEqual(['🔥', '👌']);
    expect(dictionary.reactionsFor('React 👌')).toEqual(['👌']);
  });

  it('ignores a custom emoji whose id is too short to be real', () => {
    expect(dictionary.reactionsFor('react <a:x:1>')).toEqual([]);
  });

  it('ignores "react" followed by something that is not an emoji', () => {
    expect(dictionary.reactionsFor('react please')).toEqual([]);
    expect(dictionary.reactionsFor('react')).toEqual([]);
  });
});

describe('ReactionDictionary wiring', () => {
  it('is built by the container with no collaborators', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [ReactionDictionary] }).compile();
    expect(moduleRef.get(ReactionDictionary)).toBeInstanceOf(ReactionDictionary);
    await moduleRef.close();
  });
});
