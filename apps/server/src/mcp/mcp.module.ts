import { Module, type OnModuleInit, type Type } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { GuildAccessModule } from '../common/guild-access/guild-access.module.js';
import { restEnabledFromEnv } from '../auth/auth.module.js';
import { migrationPendingFromEnv } from '../discord/discord.module.js';
import { ApiKeyModule } from '../modules/api-key/api-key.module.js';
import { ConfirmTokenService } from './confirm-token.service.js';
import { McpController } from './mcp.controller.js';
import { installMcpHooks } from './mcp-http-hooks.js';
import { McpRateLimiter } from './mcp-rate-limit.js';
import { McpServerFactory } from './mcp-server.factory.js';
import { MCP_TARGET, mcpTargetFromEnv } from './tool-result.js';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `[McpModule]` while the endpoint is on: the REST API is on (the deployment
 * host comes from `APP_URL`), the Discord client exists, and `MCP_ENABLED` is
 * not `false`. Read from the raw environment like `featureModules`: Nest
 * builds the module graph before anything is parsed.
 */
export function mcpModules(env: Env = process.env): readonly Type[] {
  const enabled = (env['MCP_ENABLED']?.trim() ?? '') !== 'false';
  return enabled && restEnabledFromEnv(env) && !migrationPendingFromEnv(env) ? [McpModule] : [];
}

/** The MCP interface: tools over the same services as the REST API, behind an API key. */
@Module({
  imports: [ApiKeyModule, GuildAccessModule],
  controllers: [McpController],
  providers: [
    McpServerFactory,
    ConfirmTokenService,
    McpRateLimiter,
    { provide: MCP_TARGET, useFactory: () => mcpTargetFromEnv() },
  ],
})
export class McpModule implements OnModuleInit {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onModuleInit(): void {
    // Absent when the module is compiled without an HTTP application.
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (fastify !== undefined) installMcpHooks(fastify);
  }
}
