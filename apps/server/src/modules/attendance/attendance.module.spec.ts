import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AttendanceCommands } from './attendance.commands.js';
import { AttendanceModule } from './attendance.module.js';
import { AttendanceService } from './attendance.service.js';

// The database and the Discord client are stand-ins.
describe('AttendanceModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AttendanceModule] })
      .useMocker(() => ({}))
      .compile();
    expect(moduleRef.get(AttendanceService)).toBeInstanceOf(AttendanceService);
    expect(moduleRef.get(AttendanceCommands)).toBeInstanceOf(AttendanceCommands);
    await moduleRef.close();
  });
});
