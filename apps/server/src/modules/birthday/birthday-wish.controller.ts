import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  BirthdayWishInputSchema,
  BirthdayWishViewSchema,
  z,
  type BirthdayWishInput,
  type BirthdayWishView,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { BirthdayWishService } from './birthday-wish.service.js';

/** The wishes a server sends on birthdays; listing one fills a new server's list with the built-ins. */
@Controller('api/guilds/:guildId/birthday-wishes')
@UseGuards(ManageGuildGuard)
export class BirthdayWishController {
  constructor(private readonly wishes: BirthdayWishService) {}

  @Get()
  async list(@Param('guildId') guildId: string): Promise<BirthdayWishView[]> {
    return z.array(BirthdayWishViewSchema).parse(await this.wishes.list(guildId));
  }

  @Post()
  async create(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: BirthdayWishInputSchema }) body: BirthdayWishInput,
  ): Promise<BirthdayWishView> {
    return BirthdayWishViewSchema.parse(
      await this.wishes.create(guildId, body, httpActor(principal)),
    );
  }

  @Patch(':id')
  async update(
    @Param('guildId') guildId: string,
    @Param('id') id: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: BirthdayWishInputSchema }) body: BirthdayWishInput,
  ): Promise<BirthdayWishView> {
    return BirthdayWishViewSchema.parse(
      await this.wishes.update(guildId, id, body, httpActor(principal)),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('guildId') guildId: string,
    @Param('id') id: string,
    @Principal() principal: SessionPrincipal,
  ): Promise<void> {
    await this.wishes.remove(guildId, id, httpActor(principal));
  }
}
