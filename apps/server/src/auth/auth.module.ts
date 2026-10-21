import { Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { InvalidEnvError, loadEnv, restSettingsOf, type RestSettings } from '../config/env.js';
import { PgBossModule } from '../jobs/pg-boss.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthSessionCleanupCron } from './auth-session-cleanup.cron.js';
import { AUTH, REST_SETTINGS, createAuth } from './better-auth.js';
import { OriginGuard } from './origin.guard.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

/**
 * The REST API and the login are on exactly when `APP_URL` is set. Read from
 * the raw environment like `migrationPendingFromEnv`: Nest builds the module
 * graph before anything is parsed.
 */
export const restEnabledFromEnv = (env: Readonly<Record<string, string | undefined>>): boolean =>
  (env['APP_URL']?.trim() ?? '') !== '';

/** The login modules while the REST API is on, nothing otherwise. */
export function authModules(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly Type[] {
  return restEnabledFromEnv(env) ? [AuthModule, AuthSessionCleanupModule] : [];
}

@Module({
  providers: [
    {
      provide: REST_SETTINGS,
      useFactory: () => {
        const settings = restSettingsOf(loadEnv());
        if (settings === undefined) throw new InvalidEnvError(['APP_URL']);
        return settings;
      },
    },
    {
      provide: AUTH,
      // The Prisma client comes from the container, so Better Auth is built
      // after the database connection exists.
      useFactory: (settings: RestSettings, prisma: PrismaService) =>
        createAuth(settings, prismaAdapter(prisma, { provider: 'postgresql' })),
      inject: [REST_SETTINGS, PrismaService],
    },
    SessionService,
    SessionGuard,
    // Global: a route added later cannot forget the CSRF check.
    { provide: APP_GUARD, useClass: OriginGuard },
    // Global: every REST failure leaves as { code, message, details? }.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [AUTH, REST_SETTINGS, SessionService, SessionGuard],
})
export class AuthModule {}

/**
 * Daily deletion of expired sessions. A module of its own: it needs the job
 * queue, which the login itself does not.
 */
@Module({
  imports: [PgBossModule],
  providers: [AuthSessionCleanupCron],
})
export class AuthSessionCleanupModule {}
