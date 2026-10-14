import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/server';
import { Client } from 'discord.js';
import { GuildAccessService } from '../common/guild-access/guild-access.service.js';
import { ConfirmTokenService } from './confirm-token.service.js';
import type { McpCaller } from './mcp-caller.js';
import type { AnyToolRow } from './tool-definition.js';
import { registerTools, TOOL_REGISTRY } from './tool-registry.js';
import { MCP_TARGET, type McpTarget } from './tool-result.js';

const MCP_SERVER_NAME = 'sab-delegate';
const MCP_SERVER_VERSION = '1.0.0';

/**
 * Builds one `McpServer` per request. The caller is baked into the tool
 * closures rather than read from an ambient store, so a tool physically cannot
 * act for anyone but the key that authenticated this request.
 */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly access: GuildAccessService,
    private readonly tokens: ConfirmTokenService,
    private readonly client: Client,
    @Inject(MCP_TARGET) private readonly target: McpTarget,
  ) {}

  create(caller: McpCaller, rows: readonly AnyToolRow[] = TOOL_REGISTRY): McpServer {
    const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
    registerTools(
      server,
      {
        access: this.access,
        tokens: this.tokens,
        target: this.target,
        guildName: (guildId) => this.client.guilds.cache.get(guildId)?.name,
        // Services come from the running application: a table row names a class
        // and nothing here has to know the domain modules.
        services: { get: (token) => this.moduleRef.get(token, { strict: false }) },
      },
      caller,
      rows,
    );
    return server;
  }
}
