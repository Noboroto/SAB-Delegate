import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  AuditLogPageSchema,
  AuditLogsQuerySchema,
  CommandCatalogEntrySchema,
  CommandsQuerySchema,
  LookupMembersQuerySchema,
  SystemOverviewSchema,
  type AuditLogPage,
  type CommandCatalogEntry,
  type LookupChannel,
  type LookupMember,
  type LookupRole,
  type SystemOverview,
  z,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { CommandsCatalogService } from './commands-catalog.service.js';
import { DiscordLookupService } from './discord-lookup.service.js';
import { SystemService } from './system.service.js';

/** Read-only views for the dashboard: health, audit trail, command list and the Discord pickers. */
@Controller('api/guilds/:guildId')
@UseGuards(ManageGuildGuard)
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly audit: AuditService,
    private readonly catalog: CommandsCatalogService,
    private readonly lookup: DiscordLookupService,
  ) {}

  /** Bot health only; the server count of the whole bot is not part of it. */
  @Get('overview')
  overview(): SystemOverview {
    const { uptimeMs, wsPing } = this.system.getStatus();
    return SystemOverviewSchema.parse({ uptimeMs, wsPing });
  }

  @Get('audit-logs')
  async auditLogs(
    @Param('guildId') guildId: string,
    @Query({ schema: AuditLogsQuerySchema }) query: z.output<typeof AuditLogsQuerySchema>,
  ): Promise<AuditLogPage> {
    const page = await this.audit.list({ ...query, guildId });
    return AuditLogPageSchema.parse({ items: page.items, nextCursor: page.nextCursor });
  }

  @Get('commands')
  commands(
    @Query({ schema: CommandsQuerySchema }) query: z.output<typeof CommandsQuerySchema>,
  ): CommandCatalogEntry[] {
    return z.array(CommandCatalogEntrySchema).parse(this.catalog.list(query.locale));
  }

  @Get('discord/channels')
  channels(@Param('guildId') guildId: string): LookupChannel[] {
    return this.lookup.channels(guildId);
  }

  @Get('discord/roles')
  roles(@Param('guildId') guildId: string): LookupRole[] {
    return this.lookup.roles(guildId);
  }

  @Get('discord/members')
  members(
    @Param('guildId') guildId: string,
    @Query({ schema: LookupMembersQuerySchema }) query: z.output<typeof LookupMembersQuerySchema>,
  ): Promise<LookupMember[]> {
    return this.lookup.members(guildId, query.q);
  }
}
