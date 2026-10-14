import type { Type } from '@nestjs/common';
import type { ActorContext } from '@sab/shared';
import { AuthModule, restEnabledFromEnv } from '../../auth/auth.module.js';
import type { SessionPrincipal } from '../../auth/principal.decorator.js';
import { GuildAccessModule } from '../guild-access/guild-access.module.js';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * What a module needs in `imports` for its controllers' guards (the login and
 * the Manage Server check). Empty while the REST API is off, because the
 * session service only exists when `APP_URL` is set. Read from the raw
 * environment when the module is declared, like `authModules`.
 */
export function restImports(env: Env = process.env): Type[] {
  return restEnabledFromEnv(env) ? [AuthModule, GuildAccessModule] : [];
}

/** The HTTP controllers of a module, left out together with their guards' modules while REST is off. */
export function restControllers(controllers: readonly Type[], env: Env = process.env): Type[] {
  return restEnabledFromEnv(env) ? [...controllers] : [];
}

/** Who a service call is for when the request came through the REST API. */
export function httpActor(principal: SessionPrincipal): ActorContext {
  return { source: 'HTTP', userId: principal.discordUserId };
}
