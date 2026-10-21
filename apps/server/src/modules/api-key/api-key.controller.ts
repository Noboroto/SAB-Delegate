import { Body, Controller, Delete, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  ApiKeyMintResultSchema,
  ApiKeyMintSchema,
  ApiKeyViewSchema,
  z,
  type ApiKeyMint,
  type ApiKeyMintResult,
  type ApiKeyView,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { SessionGuard } from '../../auth/session.guard.js';
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

  /** The answer carries the secret, which cannot be read again. */
  @Post()
  @RouteConfig({ rateLimit: MINT_RATE_LIMIT })
  @Header('Cache-Control', 'no-store')
  async mint(
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ApiKeyMintSchema }) body: ApiKeyMint,
  ): Promise<ApiKeyMintResult> {
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
