import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PurgeCommands } from './purge.commands.js';
import { PurgeContextMenu } from './purge.context-menu.js';
import { PurgeFlow } from './purge.flow.js';
import { PurgeModule } from './purge.module.js';
import { PurgeService } from './purge.service.js';

// Everything that lives outside the module (the database and the Discord
// client) is a stand-in.
describe('PurgeModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PurgeModule] })
      .useMocker(() => ({}))
      .compile();

    expect(moduleRef.get(PurgeService)).toBeInstanceOf(PurgeService);
    expect(moduleRef.get(PurgeFlow)).toBeInstanceOf(PurgeFlow);
    expect(moduleRef.get(PurgeCommands)).toBeInstanceOf(PurgeCommands);
    expect(moduleRef.get(PurgeContextMenu)).toBeInstanceOf(PurgeContextMenu);
    await moduleRef.close();
  });
});
