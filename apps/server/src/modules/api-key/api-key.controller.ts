import { Body, Controller, Delete, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  ApiKeyMintResultSchema,
  ApiKeyMintSchema,
  ApiKeyViewSchema,
  ErrorCode,
  z,
  type ApiKeyMint,
  type ApiKeyMintResult,
  type ApiKeyView,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { FRESH_AUTH_WINDOW_MS, SessionGuard } from '../../auth/session.guard.js';
import { ApiError } from '../../common/errors/http-error.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { ApiKeyService } from './api-key.service.js';
import { SessionOnlyGuard } from './session-only.guard.js';

/** Minting is rare; a small bucket stops a script from burning through the five-key limit and the audit trail. */
const MINT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/**
 * The caller's own API keys. Cookie login only (`SessionOnlyGuard`), and the
 * global `OriginGuard` covers the writes: a key can never manage keys.
 */
@Controller('api/me/api-keys')
@UseGuards(SessionOnlyGuard, SessionGuard)
export class ApiKeyController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get()
  async list(@Principal() principal: SessionPrincipal): Promise<ApiKeyView[]> {
    return z.array(ApiKeyViewSchema).parse(await this.keys.list(principal.discordUserId));
  }

  /**
   * The answer carries the secret, which cannot be read again. A key that can
   * change things needs a login from the last five minutes: a stolen cookie
   * then cannot turn into a long-lived write credential. Checked here and not
   * by `FreshAuthGuard` because only the body says which kind is requested.
   */
  @Post()
  @RouteConfig({ rateLimit: MINT_RATE_LIMIT })
  @Header('Cache-Control', 'no-store')
  async mint(
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ApiKeyMintSchema }) body: ApiKeyMint,
  ): Promise<ApiKeyMintResult> {
    if (
      body.mode === 'WRITE' &&
      Date.now() - principal.createdAt.getTime() > FRESH_AUTH_WINDOW_MS
    ) {
      throw new ApiError(ErrorCode.AUTH_REAUTH_REQUIRED);
    }
    const minted = await this.keys.mint(principal.discordUserId, body, httpActor(principal));
    return ApiKeyMintResultSchema.parse(minted);
  }

  @Delete(':id')
  async revoke(
    @Principal() principal: SessionPrincipal,
    @Param('id') id: string,
  ): Promise<ApiKeyView> {
    return ApiKeyViewSchema.parse(
      await this.keys.revoke(principal.discordUserId, id, httpActor(principal)),
    );
  }
}
