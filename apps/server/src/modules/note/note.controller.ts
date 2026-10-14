import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  NoteKeySchema,
  NoteListQuerySchema,
  NoteSchema,
  NoteUpsertSchema,
  destructiveQueryShape,
  z,
  type Note,
  type NoteRemovePlan,
  type NoteRemoveResult,
  type NoteUpsert,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { requireConfirmation } from '../../common/rest/rest-support.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { NoteService } from './note.service.js';

const DeleteQuerySchema = requireConfirmation(NoteKeySchema.extend(destructiveQueryShape));

/** A note is named by its role and topic within the server in the route, never by a key of the row. */
@Controller('api/guilds/:guildId/notes')
@UseGuards(ManageGuildGuard)
export class NoteController {
  constructor(private readonly notes: NoteService) {}

  /** Every note of the server, or those of one role. */
  @Get()
  async list(
    @Param('guildId') guildId: string,
    @Query({ schema: NoteListQuerySchema }) query: z.output<typeof NoteListQuerySchema>,
  ): Promise<Note[]> {
    const notes =
      query.roleId === undefined
        ? await this.notes.listAll(guildId)
        : await this.notes.listByRole(guildId, query.roleId);
    return z.array(NoteSchema).parse(notes);
  }

  @Post()
  async create(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: NoteUpsertSchema }) body: NoteUpsert,
  ): Promise<Note> {
    return NoteSchema.parse(await this.notes.upsert(guildId, body, httpActor(principal)));
  }

  /** Replaces the text of the note with this role and topic; saving is one operation, so a missing note is created. */
  @Patch()
  async update(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: NoteUpsertSchema }) body: NoteUpsert,
  ): Promise<Note> {
    return NoteSchema.parse(await this.notes.upsert(guildId, body, httpActor(principal)));
  }

  @Delete()
  async remove(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Query({ schema: DeleteQuerySchema }) query: z.output<typeof DeleteQuerySchema>,
  ): Promise<NoteRemovePlan | NoteRemoveResult> {
    const { roleId, topic, dryRun } = query;
    return this.notes.remove(guildId, { roleId, topic }, httpActor(principal), { dryRun });
  }
}
