import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DICTIONARY_SOURCE, DictionaryService } from './dictionary.service.js';
import { WordGameListener } from './word-game.listener.js';
import { WordGameModule } from './word-game.module.js';
import { WordGameService } from './word-game.service.js';
import { DEFINITION_FETCH, WordDefinitionService } from './word-definition.service.js';

// Everything that lives outside the module (the database, the Discord client,
// the other modules' services) is a stand-in. The dictionary source
// and the definition fetcher are the parameters that are optional on purpose:
// they must stay unresolved so the services fall back to their defaults.
const standIn = (token: unknown): object | undefined =>
  token === DICTIONARY_SOURCE || token === DEFINITION_FETCH ? undefined : {};

describe('WordGameModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WordGameModule] })
      .useMocker(standIn)
      .compile();

    expect(moduleRef.get(WordGameService)).toBeInstanceOf(WordGameService);
    expect(moduleRef.get(WordGameListener)).toBeInstanceOf(WordGameListener);
    expect(moduleRef.get(WordDefinitionService)).toBeInstanceOf(WordDefinitionService);
    await moduleRef.close();
  });

  it('wires the dictionary to the bundled asset when nothing replaces the source', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WordGameModule] })
      .useMocker(standIn)
      .compile();

    await expect(moduleRef.get(DictionaryService).has('aardvark')).resolves.toBe(true);
    await moduleRef.close();
  });
});
