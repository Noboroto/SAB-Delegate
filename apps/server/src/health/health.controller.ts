import { Controller, Get } from '@nestjs/common';

// Liveness only. The container healthcheck must stay green while Postgres is
// restarting, otherwise the orchestrator kills the process that would have
// reconnected on its own. Keep every dependency out of this class.
@Controller('health')
export class HealthController {
  @Get()
  check(): { ok: true } {
    return { ok: true };
  }
}
