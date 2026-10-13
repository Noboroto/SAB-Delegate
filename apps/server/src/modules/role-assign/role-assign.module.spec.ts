import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { RoleAssignCommands } from './role-assign.commands.js';
import { RoleAssignModule } from './role-assign.module.js';
import { RoleAssignService } from './role-assign.service.js';

// The database, the Discord client and the other modules' services are stand-ins.
describe('RoleAssignModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [RoleAssignModule] })
      .useMocker(() => ({}))
      .compile();
    expect(moduleRef.get(RoleAssignService)).toBeInstanceOf(RoleAssignService);
    expect(moduleRef.get(RoleAssignCommands)).toBeInstanceOf(RoleAssignCommands);
    await moduleRef.close();
  });
});
