import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { ScheduleModule } from '../schedule/schedule.module.js';
import { ApiKeyController } from './api-key.controller.js';
import { ApiKeyService } from './api-key.service.js';

/**
 * Revoking a key withdraws what it scheduled, which needs the schedule
 * service and with it the Discord client, so the module is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, ScheduleModule, ...restImports()],
  providers: [ApiKeyService],
  controllers: restControllers([ApiKeyController]),
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
