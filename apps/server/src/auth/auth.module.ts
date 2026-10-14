import { Module, type Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { InvalidEnvError, loadEnv, restSettingsOf } from '../config/env.js';
import { AUTH, REST_SETTINGS, createAuth } from './better-auth.js';
import { OriginGuard } from './origin.guard.js';
import { FreshAuthGuard, SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

/**
 * The REST API and the login are on exactly when `APP_URL` is set. Read from
 * the raw environment like `migrationPendingFromEnv`: Nest builds the module
 * graph before anything is parsed.
 */
export const restEnabledFromEnv = (env: Readonly<Record<string, string | undefined>>): boolean =>
  (env['APP_URL']?.trim() ?? '') !== '';

/** `[AuthModule]` while the REST API is on, nothing otherwise. */
export function authModules(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly Type[] {
  return restEnabledFromEnv(env) ? [AuthModule] : [];
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
      useFactory: createAuth,
      inject: [REST_SETTINGS],
    },
    SessionService,
    SessionGuard,
    FreshAuthGuard,
    // Global: a route added later cannot forget the CSRF check.
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
  exports: [AUTH, REST_SETTINGS, SessionService, SessionGuard, FreshAuthGuard],
})
export class AuthModule {}
