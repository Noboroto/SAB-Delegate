import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PrivateThreadCommands } from './private-thread.commands.js';
import { PrivateThreadService } from './private-thread.service.js';
import { ThreadCommands } from './thread.commands.js';
import { ThreadModule } from './thread.module.js';
import { ThreadService } from './thread.service.js';

// Everything that lives outside the module (the database, the Discord client,
// the message resolver and reaction reader of the Discord module) is a stand-in.
describe('ThreadModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ThreadModule] })
      .useMocker(() => ({}))
      .compile();

    expect(moduleRef.get(ThreadService)).toBeInstanceOf(ThreadService);
    expect(moduleRef.get(PrivateThreadService)).toBeInstanceOf(PrivateThreadService);
    expect(moduleRef.get(ThreadCommands)).toBeInstanceOf(ThreadCommands);
    expect(moduleRef.get(PrivateThreadCommands)).toBeInstanceOf(PrivateThreadCommands);
    await moduleRef.close();
  });
});
