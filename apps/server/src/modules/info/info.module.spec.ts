import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { InfoCommands } from './info.commands.js';
import { InfoModule } from './info.module.js';
import { InfoService } from './info.service.js';

// The database, the Discord client and the other modules' services are stand-ins.
describe('InfoModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfoModule] })
      .useMocker(() => ({}))
      .compile();
    expect(moduleRef.get(InfoService)).toBeInstanceOf(InfoService);
    expect(moduleRef.get(InfoCommands)).toBeInstanceOf(InfoCommands);
    await moduleRef.close();
  });
});
