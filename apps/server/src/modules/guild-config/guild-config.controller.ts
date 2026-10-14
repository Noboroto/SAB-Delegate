import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  BotProfileSchema,
  BotProfileSetRequestSchema,
  BotProfileSetResultSchema,
  GuildSettingsDryRunSchema,
  GuildSettingsPatchRequestSchema,
  GuildSettingsSchema,
  z,
  type BotProfile,
  type BotProfileSetResult,
  type GuildSettings,
  type GuildSettingsDryRun,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { BotProfileService } from './bot-profile.js';
import { GuildConfigService } from './guild-config.service.js';

@Controller('api/guilds/:guildId')
@UseGuards(ManageGuildGuard)
export class GuildConfigController {
  constructor(
    private readonly config: GuildConfigService,
    private readonly botProfile: BotProfileService,
  ) {}

  @Get('settings')
  async settings(@Param('guildId') guildId: string): Promise<GuildSettings> {
    return GuildSettingsSchema.parse(await this.config.get(guildId));
  }

  /** Only the fields sent change; `null` clears a channel. `dryRun` answers `{ before, after }`. */
  @Patch('settings')
  async patchSettings(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: GuildSettingsPatchRequestSchema })
    body: z.output<typeof GuildSettingsPatchRequestSchema>,
  ): Promise<GuildSettings | GuildSettingsDryRun> {
    const { dryRun, ...changes } = body;
    const result = await this.config.patch(guildId, changes, httpActor(principal), { dryRun });
    return dryRun ? GuildSettingsDryRunSchema.parse(result) : GuildSettingsSchema.parse(result);
  }

  @Get('bot-profile')
  async profile(@Param('guildId') guildId: string): Promise<BotProfile> {
    return BotProfileSchema.parse(await this.botProfile.getBotProfile(guildId));
  }

  /** The picture is sent as base64 (never an address); the nickname and avatar go to Discord as two requests. */
  @Patch('bot-profile')
  async patchProfile(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: BotProfileSetRequestSchema }) body: z.output<typeof BotProfileSetRequestSchema>,
  ): Promise<BotProfileSetResult> {
    const { dryRun, ...change } = body;
    return BotProfileSetResultSchema.parse(
      await this.botProfile.setBotProfile(guildId, change, httpActor(principal), { dryRun }),
    );
  }
}
