import 'reflect-metadata';
import { Global, Module, type Type } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { fastifyOptions } from '../bootstrap/security-config.js';
import { GuildAccessModule } from '../common/guild-access/guild-access.module.js';
import { GuildAccessService } from '../common/guild-access/guild-access.service.js';
import { ApiKeyModule } from '../modules/api-key/api-key.module.js';
import { ApiKeyService } from '../modules/api-key/api-key.service.js';
import { McpController } from './mcp.controller.js';
import { McpModule, mcpModules } from './mcp.module.js';
import { HARNESS_TARGET } from './mcp.test-harness.js';
import { ConfirmTokenService } from './confirm-token.service.js';
import { McpRateLimiter } from './mcp-rate-limit.js';
import { McpServerFactory } from './mcp-server.factory.js';
import { MCP_TARGET } from './tool-result.js';

function stubModule(token: Type, value: object): Type {
  @Module({ providers: [{ provide: token, useValue: value }], exports: [token] })
  class Stub {}
  return Stub;
}

/** The Discord client that `DiscordModule` provides globally in the application. */
@Global()
@Module({
  providers: [{ provide: Client, useValue: { guilds: { cache: new Map() } } }],
  exports: [Client],
})
class ClientStubModule {}

const compile = () =>
  Test.createTestingModule({ imports: [ClientStubModule, McpModule] })
    .overrideModule(ApiKeyModule)
    .useModule(stubModule(ApiKeyService, { verify: vi.fn() }))
    .overrideModule(GuildAccessModule)
    .useModule(stubModule(GuildAccessService, { assertManageGuild: vi.fn() }))
    .overrideProvider(MCP_TARGET)
    .useValue(HARNESS_TARGET);

describe('McpModule', () => {
  it('resolves every dependency of the controller and the factory through the container', async () => {
    const moduleRef = await compile().compile();
    expect(moduleRef.get(McpController)).toBeInstanceOf(McpController);
    expect(moduleRef.get(McpServerFactory)).toBeInstanceOf(McpServerFactory);
    expect(moduleRef.get(ConfirmTokenService)).toBeInstanceOf(ConfirmTokenService);
    expect(moduleRef.get(McpRateLimiter)).toBeInstanceOf(McpRateLimiter);
    await moduleRef.close();
  });

  it('installs its hooks when booted as an application, so a browser Origin is refused', async () => {
    const moduleRef = await compile().compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(fastifyOptions()),
    );
    try {
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        payload: {},
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('builds a server for a caller from the container', async () => {
    const moduleRef = await compile().compile();
    const server = moduleRef.get(McpServerFactory).create({
      discordUserId: '444444444444444449',
      apiKeyId: '0190a000-0000-7000-8000-000000000001',
      mode: 'READ',
      ip: '',
      userAgent: null,
    });
    expect(server).toBeDefined();
    await server.close();
    await moduleRef.close();
  });
});

describe('mcpModules', () => {
  const rest = { APP_URL: 'https://bot.example.test' };

  it('mounts the endpoint when the REST API and the Discord client are on', () => {
    expect(mcpModules(rest)).toEqual([McpModule]);
    expect(mcpModules({ ...rest, MCP_ENABLED: '' })).toEqual([McpModule]);
    expect(mcpModules({ ...rest, MCP_ENABLED: 'true' })).toEqual([McpModule]);
  });

  it('removes the route with MCP_ENABLED=false, without APP_URL, or while a migration is pending', () => {
    expect(mcpModules({ ...rest, MCP_ENABLED: 'false' })).toEqual([]);
    expect(mcpModules({ ...rest, MCP_ENABLED: ' false ' })).toEqual([]);
    expect(mcpModules({})).toEqual([]);
    expect(mcpModules({ ...rest, MIGRATION_PENDING: 'true' })).toEqual([]);
  });
});
