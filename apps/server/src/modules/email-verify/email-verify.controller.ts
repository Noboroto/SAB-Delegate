import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  AccessRulesInputSchema,
  AccessRulesViewSchema,
  EmailBlocklistSchema,
  EmailListCreateSchema,
  EmailListEntriesInputSchema,
  EmailListEntriesResultSchema,
  EmailListParamSchema,
  EmailListSummarySchema,
  EmailManualVerifyInputSchema,
  EmailMemberListQuerySchema,
  EmailMemberPageSchema,
  EmailMemberParamSchema,
  EmailMemberRowSchema,
  EmailTestMailInputSchema,
  EmailVerifyButtonInputSchema,
  EmailVerifyButtonResultSchema,
  EmailVerifyConfigPatchSchema,
  EmailVerifyConfigSchema,
  EmailVerifyStatusSchema,
  ErrorCode,
  SmtpSettingsInputSchema,
  SmtpSettingsSchema,
  SmtpTestResultSchema,
  z,
  type AccessRulesView,
  type EmailBlocklist,
  type EmailListEntriesResult,
  type EmailListSummary,
  type EmailMemberPage,
  type EmailMemberRow,
  type EmailVerifyButtonResult,
  type EmailVerifyConfig,
  type EmailVerifyStatus,
  type SmtpSettings,
  type SmtpTestResult,
} from '@sab/shared';
import type { FastifyReply } from 'fastify';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { EmailListService } from './email-list.service.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';
import { EmailVerifyDiscordService } from './email-verify-discord.service.js';
import { EmailVerifyMembersService } from './email-verify-members.service.js';
import { EmailVerifyService } from './email-verify.service.js';
import { MailerService } from './mailer.service.js';
import { SmtpConfigService } from './smtp-config.service.js';

/** The file name for a `Content-Disposition`: an ASCII fallback plus the real name encoded (RFC 6266). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Email verification for the managers of a server: the guard checks Manage
 * Server on `guildId`. Every response is parsed through its shared schema, so
 * no stored column (an encrypted address, the SMTP password) can leave in one.
 * The SMTP account belongs to the admin guild alone, like the LLM settings.
 */
@Controller('api/guilds/:guildId/email-verify')
@UseGuards(ManageGuildGuard)
export class EmailVerifyController {
  constructor(
    private readonly config: EmailVerifyConfigService,
    private readonly lists: EmailListService,
    private readonly members: EmailVerifyMembersService,
    private readonly flow: EmailVerifyService,
    private readonly discord: EmailVerifyDiscordService,
    private readonly smtp: SmtpConfigService,
    private readonly mailer: MailerService,
  ) {}

  @Get('config')
  async getConfig(@Param('guildId') guildId: string): Promise<EmailVerifyConfig> {
    return EmailVerifyConfigSchema.parse(await this.config.get(guildId));
  }

  @Patch('config')
  async patchConfig(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: EmailVerifyConfigPatchSchema })
    body: z.output<typeof EmailVerifyConfigPatchSchema>,
  ): Promise<EmailVerifyConfig> {
    return EmailVerifyConfigSchema.parse(
      await this.config.patch(guildId, body, httpActor(principal)),
    );
  }

  @Get('status')
  async status(@Param('guildId') guildId: string): Promise<EmailVerifyStatus> {
    return EmailVerifyStatusSchema.parse(await this.flow.status(guildId));
  }

  @Get('rules')
  async getRules(@Param('guildId') guildId: string): Promise<AccessRulesView> {
    return AccessRulesViewSchema.parse(await this.config.rules(guildId));
  }

  /** Replaces the whole rule set. */
  @Put('rules')
  async putRules(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: AccessRulesInputSchema }) body: z.output<typeof AccessRulesInputSchema>,
  ): Promise<AccessRulesView> {
    return AccessRulesViewSchema.parse(
      await this.config.setRules(guildId, body, httpActor(principal)),
    );
  }

  @Get('blocklist')
  async getBlocklist(@Param('guildId') guildId: string): Promise<EmailBlocklist> {
    return EmailBlocklistSchema.parse(await this.config.blocklist(guildId));
  }

  /** Replaces the whole blocklist. */
  @Put('blocklist')
  async putBlocklist(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: EmailBlocklistSchema }) body: z.output<typeof EmailBlocklistSchema>,
  ): Promise<EmailBlocklist> {
    return EmailBlocklistSchema.parse(
      await this.config.setBlocklist(guildId, body, httpActor(principal)),
    );
  }

  @Get('lists')
  async getLists(@Param('guildId') guildId: string): Promise<EmailListSummary[]> {
    return z.array(EmailListSummarySchema).parse(await this.lists.list(guildId));
  }

  @Post('lists')
  async createList(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: EmailListCreateSchema }) body: z.output<typeof EmailListCreateSchema>,
  ): Promise<EmailListSummary> {
    return EmailListSummarySchema.parse(
      await this.lists.create(guildId, body, httpActor(principal)),
    );
  }

  /** The list and its addresses go; a rule that names it stays and no longer matches. */
  @Delete('lists/:listId')
  @HttpCode(204)
  async deleteList(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: EmailListParamSchema }) params: z.output<typeof EmailListParamSchema>,
  ): Promise<void> {
    await this.lists.delete(guildId, params.listId, httpActor(principal));
  }

  @Post('lists/:listId/entries')
  @HttpCode(200)
  async addEntries(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: EmailListParamSchema }) params: z.output<typeof EmailListParamSchema>,
    @Body({ schema: EmailListEntriesInputSchema })
    body: z.output<typeof EmailListEntriesInputSchema>,
  ): Promise<EmailListEntriesResult> {
    return EmailListEntriesResultSchema.parse(
      await this.lists.addEntries(guildId, params.listId, body, httpActor(principal)),
    );
  }

  @Post('lists/:listId/entries/remove')
  @HttpCode(200)
  async removeEntries(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: EmailListParamSchema }) params: z.output<typeof EmailListParamSchema>,
    @Body({ schema: EmailListEntriesInputSchema })
    body: z.output<typeof EmailListEntriesInputSchema>,
  ): Promise<EmailListEntriesResult> {
    return EmailListEntriesResultSchema.parse(
      await this.lists.removeEntries(guildId, params.listId, body, httpActor(principal)),
    );
  }

  /** Empties the list and keeps it. */
  @Delete('lists/:listId/entries')
  @HttpCode(204)
  async clearEntries(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: EmailListParamSchema }) params: z.output<typeof EmailListParamSchema>,
  ): Promise<void> {
    await this.lists.clearEntries(guildId, params.listId, httpActor(principal));
  }

  @Get('members')
  async getMembers(
    @Param('guildId') guildId: string,
    @Query({ schema: EmailMemberListQuerySchema })
    query: z.output<typeof EmailMemberListQuerySchema>,
  ): Promise<EmailMemberPage> {
    return EmailMemberPageSchema.parse(await this.members.members(guildId, query));
  }

  /** Every verified member as an Excel file. Personal data: never cached. */
  @Get('members/export')
  @Header('Cache-Control', 'no-store')
  async exportMembers(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const file = await this.members.exportXlsx(guildId, httpActor(principal));
    // Members Discord could not name: their name and role cells are empty.
    void reply.header('X-Export-Unresolved', String(file.unresolved));
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: attachmentDisposition(file.fileName),
      length: file.buffer.length,
    });
  }

  @Post('members')
  @HttpCode(200)
  async verifyMember(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: EmailManualVerifyInputSchema })
    body: z.output<typeof EmailManualVerifyInputSchema>,
  ): Promise<EmailMemberRow> {
    const { member } = await this.members.manualVerify(guildId, body, httpActor(principal));
    return EmailMemberRowSchema.parse(member);
  }

  /** Forgets the member's verification; their roles are left as they are. */
  @Delete('members/:userId')
  @HttpCode(204)
  async revokeMember(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: EmailMemberParamSchema }) params: z.output<typeof EmailMemberParamSchema>,
  ): Promise<void> {
    await this.members.revoke(guildId, params.userId, httpActor(principal));
  }

  @Post('button')
  @HttpCode(200)
  async postButton(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: EmailVerifyButtonInputSchema })
    body: z.output<typeof EmailVerifyButtonInputSchema>,
  ): Promise<EmailVerifyButtonResult> {
    return EmailVerifyButtonResultSchema.parse(
      await this.discord.postButton(guildId, body, httpActor(principal)),
    );
  }

  @Post('test-mail')
  @HttpCode(204)
  async testMail(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: EmailTestMailInputSchema }) body: z.output<typeof EmailTestMailInputSchema>,
  ): Promise<void> {
    await this.flow.testMail(guildId, body, httpActor(principal));
  }

  @Get('smtp')
  async getSmtp(@Param('guildId') guildId: string): Promise<SmtpSettings> {
    return SmtpSettingsSchema.parse(await this.smtp.view(guildId));
  }

  @Put('smtp')
  async saveSmtp(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: SmtpSettingsInputSchema }) body: z.output<typeof SmtpSettingsInputSchema>,
  ): Promise<SmtpSettings> {
    this.assertAdminGuild(guildId);
    return SmtpSettingsSchema.parse(await this.smtp.save(body, httpActor(principal)));
  }

  /**
   * Connects and logs in with the STORED account; nothing the client sends is
   * used, and nothing is sent. Five a person per ten minutes, every one audited.
   */
  @Post('smtp/test')
  @HttpCode(200)
  async testSmtp(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
  ): Promise<SmtpTestResult> {
    this.assertAdminGuild(guildId);
    return SmtpTestResultSchema.parse(await this.mailer.testStored(httpActor(principal)));
  }

  private assertAdminGuild(guildId: string): void {
    if (guildId !== this.smtp.adminGuildId) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  }
}
