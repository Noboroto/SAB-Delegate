import { Inject, Injectable, Module } from '@nestjs/common';
import { REST, Routes } from 'discord.js';
import { z } from '@sab/shared';
import { loadEnv } from '../config/env.js';
import { errorLabel } from '../prisma/pool-factory.js';

/** The validated process environment, for the Discord providers. */
export const DISCORD_ENV = Symbol('DISCORD_ENV');
/** The one REST call BootGuard makes; replaced by a stub in tests. */
export const IDENTITY_REST = Symbol('IDENTITY_REST');

export type DiscordEnv = ReturnType<typeof loadEnv>;
export type IdentityRest = Pick<REST, 'get'>;

/** Carries only variable NAMES and non-secret application ids. */
export class BootGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootGuardError';
  }
}

const IdentitySchema = z.object({ id: z.string().regex(/^\d{17,20}$/) });

/**
 * Refuses to start when the token belongs to a different application than the
 * one this deployment is configured for. Without it a production token pasted
 * into a dev environment (or the reverse) would log in and then overwrite that
 * application's slash commands with this build's.
 *
 * A bot user's id is its application id, so `GET /users/@me` is enough and no
 * gateway session is opened.
 */
@Injectable()
export class BootGuard {
  constructor(
    @Inject(IDENTITY_REST) private readonly rest: IdentityRest,
    @Inject(DISCORD_ENV) private readonly env: DiscordEnv,
  ) {}

  /** Resolves with the application id; throws `BootGuardError` otherwise. */
  async assertIdentity(): Promise<string> {
    const id = await this.fetchApplicationId();
    if (id !== this.env.DISCORD_CLIENT_ID) {
      throw new BootGuardError(
        `DISCORD_TOKEN authenticates application ${id}, which is not the application in DISCORD_CLIENT_ID`,
      );
    }
    if (!this.env.DISCORD_ALLOWED_APP_IDS.includes(id)) {
      throw new BootGuardError(
        `DISCORD_TOKEN authenticates application ${id}, which is not listed in DISCORD_ALLOWED_APP_IDS`,
      );
    }
    return id;
  }

  private async fetchApplicationId(): Promise<string> {
    let body: unknown;
    try {
      body = await this.rest.get(Routes.user('@me'));
    } catch (error) {
      // Never forward the library error: its message can echo request details.
      if (isUnauthorized(error)) {
        throw new BootGuardError('DISCORD_TOKEN was rejected by Discord (HTTP 401)');
      }
      throw new BootGuardError(
        `Could not verify the application behind DISCORD_TOKEN (${errorLabel(error)})`,
      );
    }
    const parsed = IdentitySchema.safeParse(body);
    if (!parsed.success) {
      throw new BootGuardError('Discord answered the identity check with an unexpected body');
    }
    return parsed.data.id;
  }
}

function isUnauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401;
}

@Module({
  providers: [
    { provide: DISCORD_ENV, useFactory: () => loadEnv() },
    {
      provide: IDENTITY_REST,
      useFactory: (env: DiscordEnv): IdentityRest =>
        new REST({ version: '10' }).setToken(env.DISCORD_TOKEN),
      inject: [DISCORD_ENV],
    },
    BootGuard,
  ],
  exports: [DISCORD_ENV, BootGuard],
})
export class BootGuardModule {}
