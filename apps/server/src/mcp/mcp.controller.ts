import { Controller, Delete, Get, Logger, Post, Req, Res } from '@nestjs/common';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { ErrorCode } from '@sab/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorBody } from '../common/errors/http-error.js';
import { errorLabel } from '../prisma/pool-factory.js';
import { ApiKeyService } from '../modules/api-key/api-key.service.js';
import { endHijacked } from './end-hijacked.js';
import { McpCallerSchema } from './mcp-caller.js';
import { McpRateLimiter } from './mcp-rate-limit.js';
import { McpServerFactory } from './mcp-server.factory.js';

const BEARER = /^Bearer ([^\s]+)$/i;

/**
 * Streamable-HTTP MCP endpoint, STATELESS: a fresh server and transport per
 * request, discarded when the response closes. Tools answer in one shot, so a
 * plain JSON body needs no SSE keep-alive to survive the proxy in front.
 *
 * Authentication is a bearer API key and nothing else. A cookie is authority a
 * browser attaches on its own, so honouring one here would let any page the
 * person visits call a tool as them. A request with an `Origin` header never
 * reaches this class (`installMcpHooks`).
 */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly factory: McpServerFactory,
    private readonly keys: ApiKeyService,
    private readonly limiter: McpRateLimiter,
  ) {}

  @Post()
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const { ip } = request;

    // Every refusal below happens BEFORE the reply is hijacked, so none of them
    // can be skipped by the raw-socket path.
    if (!this.limiter.allowAddress(ip)) return this.tooManyRequests(reply);

    const bearer = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (bearer === undefined) {
      this.limiter.recordFailure(ip);
      return this.unauthorized(reply);
    }
    if (!this.limiter.allowKey(bearer)) return this.tooManyRequests(reply);

    const principal = await this.keys.verify(bearer, ip);
    if (principal === null) {
      this.limiter.recordFailure(ip);
      return this.unauthorized(reply);
    }
    const caller = McpCallerSchema.parse({
      ...principal,
      ip,
      userAgent: (request.headers['user-agent'] ?? '').slice(0, 512) || null,
    });

    const server = this.factory.create(caller);
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // Fastify must stop owning the reply before the transport writes to the raw
    // socket. Helmet and `onSend` headers are lost from here on, so the few that
    // matter for a JSON API are set on the raw response.
    reply.hijack();
    reply.raw.setHeader('cache-control', 'no-store');
    reply.raw.setHeader('x-content-type-options', 'nosniff');
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      this.logger.error(`MCP request failed after hijack (${errorLabel(error)})`);
      endHijacked(reply.raw);
    }
  }

  /**
   * The transport's standalone SSE stream and session teardown only exist in
   * stateful mode; 405 tells a client the endpoint is alive and offers none.
   */
  @Get()
  rejectGet(@Res() reply: FastifyReply): void {
    this.methodNotAllowed(reply);
  }

  @Delete()
  rejectDelete(@Res() reply: FastifyReply): void {
    this.methodNotAllowed(reply);
  }

  private methodNotAllowed(reply: FastifyReply): void {
    void reply.code(405).header('allow', 'POST').send();
  }

  /** The same answer whatever was wrong with the key: missing, malformed, unknown, revoked or expired. */
  private unauthorized(reply: FastifyReply): void {
    void reply
      .code(401)
      .header('www-authenticate', 'Bearer')
      .header('cache-control', 'no-store')
      .send(errorBody(ErrorCode.AUTH_UNAUTHENTICATED));
  }

  private tooManyRequests(reply: FastifyReply): void {
    void reply.code(429).header('retry-after', '60').send(errorBody(ErrorCode.RATE_LIMITED));
  }
}
