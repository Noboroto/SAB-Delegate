import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ActivityCommands } from './activity.commands.js';
import { ActivityModule } from './activity.module.js';
import { ActivityService } from './activity.service.js';

// The database, the Discord client and the other modules' services are stand-ins.
describe('ActivityModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ActivityModule] })
      .useMocker(() => ({}))
      .compile();
    expect(moduleRef.get(ActivityService)).toBeInstanceOf(ActivityService);
    expect(moduleRef.get(ActivityCommands)).toBeInstanceOf(ActivityCommands);
    await moduleRef.close();
  });
});
