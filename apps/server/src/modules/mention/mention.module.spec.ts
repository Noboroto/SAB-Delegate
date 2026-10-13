import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MentionCommands } from './mention.commands.js';
import { MentionContextMenus } from './mention.context-menus.js';
import { MentionModule } from './mention.module.js';
import { MentionResponder } from './mention.responder.js';
import { MentionService } from './mention.service.js';
import { ThreadEveryoneCommands } from './thread-everyone.commands.js';

// The database, the Discord client and the other modules' services are stand-ins.
describe('MentionModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [MentionModule] })
      .useMocker(() => ({}))
      .compile();
    expect(moduleRef.get(MentionService)).toBeInstanceOf(MentionService);
    expect(moduleRef.get(MentionResponder)).toBeInstanceOf(MentionResponder);
    expect(moduleRef.get(MentionCommands)).toBeInstanceOf(MentionCommands);
    expect(moduleRef.get(ThreadEveryoneCommands)).toBeInstanceOf(ThreadEveryoneCommands);
    expect(moduleRef.get(MentionContextMenus)).toBeInstanceOf(MentionContextMenus);
    await moduleRef.close();
  });
});
