import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  WordGameConfigRequestSchema,
  WordGameConfigResultSchema,
  WordGameInfoSchema,
  WordGameResetResultSchema,
  WordGameWordsPageSchema,
  WordGameWordsQuerySchema,
  z,
  type WordGameConfigResult,
  type WordGameInfo,
  type WordGameResetResult,
  type WordGameWordsPage,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { destructiveFlags, requireConfirmation } from '../../common/rest/rest-support.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { WordGameService } from './word-game.service.js';

const ResetBodySchema = requireConfirmation(z.object(destructiveFlags));

@Controller('api/guilds/:guildId/word-game')
@UseGuards(ManageGuildGuard)
export class WordGameController {
  constructor(private readonly game: WordGameService) {}

  @Get()
  async status(@Param('guildId') guildId: string): Promise<WordGameInfo> {
    return WordGameInfoSchema.parse(await this.game.status(guildId));
  }

  @Get('words')
  async words(
    @Param('guildId') guildId: string,
    @Query({ schema: WordGameWordsQuerySchema }) query: z.output<typeof WordGameWordsQuerySchema>,
  ): Promise<WordGameWordsPage> {
    return WordGameWordsPageSchema.parse(await this.game.listUsedWords(guildId, query));
  }

  /** A new channel starts a new round (the used words are cleared); `dryRun` says how many would go. */
  @Patch('config')
  async configure(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: WordGameConfigRequestSchema })
    body: z.output<typeof WordGameConfigRequestSchema>,
  ): Promise<WordGameConfigResult> {
    const { dryRun, ...config } = body;
    return WordGameConfigResultSchema.parse(
      await this.game.configure(guildId, config, httpActor(principal), { dryRun }),
    );
  }

  @Post('reset')
  @HttpCode(200)
  async reset(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ResetBodySchema }) body: z.output<typeof ResetBodySchema>,
  ): Promise<WordGameResetResult> {
    return WordGameResetResultSchema.parse(
      await this.game.reset(guildId, httpActor(principal), { dryRun: body.dryRun }),
    );
  }
}
