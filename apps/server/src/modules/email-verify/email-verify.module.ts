import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { loadEnv } from '../../config/env.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { PgBossModule } from '../../jobs/pg-boss.module.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { EMAIL_VERIFY_ENV, EmailCryptoService } from './email-crypto.js';
import { EmailActionLimiter } from './email-action-limiter.js';
import { EmailBlockCommands } from './email-block.commands.js';
import { EmailListCommands } from './email-list.commands.js';
import { EmailListService } from './email-list.service.js';
import { EmailRuleCommands } from './email-rule.commands.js';
import { EmailVerifyCron } from './email-verify.cron.js';
import { EmailVerifyDiscordService } from './email-verify-discord.service.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';
import { EmailVerifyInviteTracker } from './email-verify-invites.js';
import { EmailVerifyMembersService } from './email-verify-members.service.js';
import { EmailVerifyCommands } from './email-verify.commands.js';
import { EmailVerifyController } from './email-verify.controller.js';
import { emailVerifyEnvOf } from './email-verify.env.js';
import { EmailVerifyInteractions } from './email-verify.interactions.js';
import { EmailVerifyListener } from './email-verify.listener.js';
import { EmailVerifyService } from './email-verify.service.js';
import { MailerService } from './mailer.service.js';
import { SmtpConfigService } from './smtp-config.service.js';
import { SmtpTestLimiter } from './smtp-test-limiter.js';
import { VerifyCommands } from './verify.commands.js';

/**
 * Email verification: members prove an address by a mailed code and get roles
 * by the server's access rules. Needs the Discord client (roles, the log
 * channel, the button), so it is left out of the application while a migration
 * is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, GuildConfigModule, I18nModule, PgBossModule, ...restImports()],
  providers: [
    { provide: EMAIL_VERIFY_ENV, useFactory: () => emailVerifyEnvOf(loadEnv()) },
    EmailCryptoService,
    SmtpConfigService,
    SmtpTestLimiter,
    EmailActionLimiter,
    MailerService,
    EmailVerifyDiscordService,
    EmailVerifyConfigService,
    EmailListService,
    EmailVerifyService,
    EmailVerifyMembersService,
    EmailVerifyInviteTracker,
    EmailVerifyCron,
    EmailVerifyListener,
    EmailVerifyInteractions,
    VerifyCommands,
    EmailVerifyCommands,
    EmailRuleCommands,
    EmailBlockCommands,
    EmailListCommands,
  ],
  controllers: restControllers([EmailVerifyController]),
  exports: [
    EmailCryptoService,
    SmtpConfigService,
    EmailVerifyDiscordService,
    EmailVerifyConfigService,
    EmailListService,
    EmailVerifyService,
    EmailVerifyMembersService,
  ],
})
export class EmailVerifyModule {}
