import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  ErrorCode,
  LlmSettingsInputSchema,
  LlmSettingsSchema,
  LlmTestResultSchema,
  z,
  type LlmSettings,
  type LlmTestResult,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { FreshAuthGuard } from '../../auth/session.guard.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { LlmService } from './llm.service.js';

/**
 * The LLM settings, for the managers of the admin guild only: the guard checks
 * Manage Server on `guildId`. Any other server reads `adminServer: false` and
 * nothing else, and cannot save or test.
 */
@Controller('api/guilds/:guildId/llm')
@UseGuards(ManageGuildGuard)
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Get()
  async settings(@Param('guildId') guildId: string): Promise<LlmSettings> {
    return LlmSettingsSchema.parse(await this.llm.settings(guildId));
  }

  /** A recent login only: the key and the address calls go to are changed here. */
  @Put()
  @UseGuards(FreshAuthGuard)
  async save(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: LlmSettingsInputSchema }) body: z.output<typeof LlmSettingsInputSchema>,
  ): Promise<LlmSettings> {
    this.assertAdminGuild(guildId);
    return LlmSettingsSchema.parse(await this.llm.save(body, httpActor(principal)));
  }

  @Post('test')
  @HttpCode(200)
  async test(
    @Param('guildId') guildId: string,
    @Body({ schema: LlmSettingsInputSchema }) body: z.output<typeof LlmSettingsInputSchema>,
  ): Promise<LlmTestResult> {
    this.assertAdminGuild(guildId);
    return LlmTestResultSchema.parse(await this.llm.test(body));
  }

  private assertAdminGuild(guildId: string): void {
    if (guildId !== this.llm.adminGuildId) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  }
}
