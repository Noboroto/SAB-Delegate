import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DictionaryService, loadBundledWords } from './dictionary.service.js';

const ASSET = join(__dirname, '..', '..', '..', 'assets', 'word-dict.json');

describe('DictionaryService', () => {
  it('knows the words of its source and nothing else', async () => {
    const dictionary = new DictionaryService(() => Promise.resolve(['apple', 'egg']));
    await expect(dictionary.has('apple')).resolves.toBe(true);
    await expect(dictionary.has('egg')).resolves.toBe(true);
    await expect(dictionary.has('pear')).resolves.toBe(false);
  });

  it('does not mistake what every object inherits for a word', async () => {
    const dictionary = new DictionaryService(() => Promise.resolve(['apple']));
    for (const word of ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf']) {
      await expect(dictionary.has(word), word).resolves.toBe(false);
    }
  });

  it('still finds a word that is spelled like an inherited property when it is in the list', async () => {
    const dictionary = new DictionaryService(() => Promise.resolve(['constructor']));
    await expect(dictionary.has('constructor')).resolves.toBe(true);
  });

  it('reads the list once, however many words are asked about and however fast', async () => {
    const source = vi.fn(() => Promise.resolve(['apple']));
    const dictionary = new DictionaryService(source);
    await Promise.all([dictionary.has('apple'), dictionary.has('egg'), dictionary.has('pear')]);
    await dictionary.has('apple');
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('does not read anything until the first word is asked about', () => {
    const source = vi.fn(() => Promise.resolve(['apple']));
    new DictionaryService(source);
    expect(source).not.toHaveBeenCalled();
  });

  it('retries after a failed load instead of staying broken', async () => {
    const source = vi
      .fn<() => Promise<readonly string[]>>()
      .mockRejectedValueOnce(new Error('disk gone'))
      .mockResolvedValueOnce(['apple']);
    const dictionary = new DictionaryService(source);

    await expect(dictionary.has('apple')).rejects.toThrow('disk gone');
    await expect(dictionary.has('apple')).resolves.toBe(true);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('fails every caller that waited on the same failed load, then recovers', async () => {
    let fail = true;
    const source = vi.fn(() =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve(['apple']),
    );
    const dictionary = new DictionaryService(source);

    const results = await Promise.allSettled([dictionary.has('a'), dictionary.has('b')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(source).toHaveBeenCalledTimes(1);

    fail = false;
    await expect(dictionary.has('apple')).resolves.toBe(true);
  });
});

describe('the bundled word list', () => {
  it('has 370,100 words and is the file the previous bot shipped, byte for byte', async () => {
    const bytes = await readFile(ASSET);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '9bb5ed5ba5d8e9ac8f40aca1594943507bdd601c87fc7dfcfa23ae893dc19bd9',
    );
    const words = await loadBundledWords();
    expect(words).toHaveLength(370_100);
  });

  it('holds only lower-case single words, which is how a move is looked up', async () => {
    const words = await loadBundledWords();
    const offenders = words.filter(
      (word) => word === '' || /\s/u.test(word) || word !== word.toLowerCase(),
    );
    expect(offenders.slice(0, 5)).toEqual([]);
  });

  it('answers through the service, and does not know a made-up word', async () => {
    const dictionary = new DictionaryService();
    await expect(dictionary.has('aardvark')).resolves.toBe(true);
    // "constructor" is a real word of the list; "__proto__" is not.
    await expect(dictionary.has('constructor')).resolves.toBe(true);
    await expect(dictionary.has('__proto__')).resolves.toBe(false);
    await expect(dictionary.has('zzzzqqqq')).resolves.toBe(false);
  });
});
