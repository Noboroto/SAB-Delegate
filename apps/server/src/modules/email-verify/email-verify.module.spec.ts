import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import {
  PGBOSS_OPTIONS,
  PGBOSS_WORKERS_ENABLED,
  PgBossService,
} from '../../jobs/pg-boss.service.js';
import { EMAIL_VERIFY_ENV } from './email-crypto.js';
import { EmailVerifyDiscordService } from './email-verify-discord.service.js';
import { EmailVerifyInviteTracker } from './email-verify-invites.js';
import { EmailVerifyMembersService } from './email-verify-members.service.js';
import { EmailVerifyCommands } from './email-verify.commands.js';
import { EmailVerifyCron } from './email-verify.cron.js';
import { EmailVerifyInteractions } from './email-verify.interactions.js';
import { EmailVerifyListener } from './email-verify.listener.js';
import { EmailVerifyModule } from './email-verify.module.js';
import { EmailVerifyService } from './email-verify.service.js';
import { MailerService } from './mailer.service.js';
import { SmtpConfigService } from './smtp-config.service.js';
import { VerifyCommands } from './verify.commands.js';

// The database, the Discord client and the other modules' services are stand-ins.
describe('EmailVerifyModule', () => {
  it('resolves every provider through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EmailVerifyModule] })
      .overrideProvider(EMAIL_VERIFY_ENV)
      .useValue({ secret: undefined, adminGuildId: '713025650176294945' })
      // The job queue would connect to Postgres; nothing here needs it.
      .overrideProvider(PGBOSS_OPTIONS)
      .useValue({})
      .overrideProvider(PGBOSS_WORKERS_ENABLED)
      .useValue(false)
      .overrideProvider(PgBossService)
      .useValue({})
      .useMocker(() => ({}))
      .compile();
    for (const provider of [
      EmailVerifyService,
      EmailVerifyMembersService,
      EmailVerifyDiscordService,
      SmtpConfigService,
      MailerService,
      EmailVerifyInviteTracker,
      EmailVerifyListener,
      EmailVerifyInteractions,
      EmailVerifyCron,
      VerifyCommands,
      EmailVerifyCommands,
    ]) {
      expect(moduleRef.get(provider)).toBeInstanceOf(provider);
    }
    await moduleRef.close();
  });
});
