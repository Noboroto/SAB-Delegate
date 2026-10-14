import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  PurgeLastSchema,
  PurgePlanSchema,
  PurgeRangeSchema,
  PurgeResultSchema,
  z,
  type PurgePlan,
  type PurgeResult,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { destructiveFlags, requireConfirmation } from '../../common/rest/rest-support.js';
import { PurgeService } from './purge.service.js';

const PurgeBodySchema = requireConfirmation(
  z.discriminatedUnion('mode', [
    PurgeRangeSchema.extend({ mode: z.literal('range'), ...destructiveFlags }),
    PurgeLastSchema.extend({ mode: z.literal('last'), ...destructiveFlags }),
  ]),
);

/**
 * Deletes messages. `dryRun: true` answers with the plan (what would go);
 * running it for real needs `confirm: true`. Passing the plan's
 * `fromMessageId` back keeps messages posted since from joining the selection.
 */
@Controller('api/guilds/:guildId/purge')
@UseGuards(ManageGuildGuard)
export class PurgeController {
  constructor(private readonly purge: PurgeService) {}

  @Post()
  @HttpCode(200)
  async run(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: PurgeBodySchema }) body: z.infer<typeof PurgeBodySchema>,
  ): Promise<PurgePlan | PurgeResult> {
    const actor = httpActor(principal);
    const opts = { dryRun: body.dryRun };
    const outcome =
      body.mode === 'range'
        ? await this.purge.purgeRange(guildId, body, actor, opts)
        : await this.purge.purgeLast(guildId, body, actor, opts);
    return body.dryRun ? PurgePlanSchema.parse(outcome) : PurgeResultSchema.parse(outcome);
  }
}
