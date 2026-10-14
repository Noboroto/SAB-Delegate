import { Logger } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import { errorBody } from '../common/errors/http-error.js';
import { errorLabel } from '../prisma/pool-factory.js';
import type { Auth } from './better-auth.js';

const logger = new Logger('AuthHandler');

/**
 * Mounts Better Auth as a raw Fastify route: it speaks the Fetch API
 * (`Request` in, `Response` out) and owns its own cookies, so it sits beside
 * Nest rather than inside it. Call before the server starts listening.
 *
 * Only the request is forwarded: its body goes to Better Auth's own handler,
 * never into an `auth.api.*` call, whose server-side entry points skip the
 * default-deny list.
 */
export function mountAuth(fastify: FastifyInstance, auth: Auth): void {
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      try {
        const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            ...(request.body != null ? { body: JSON.stringify(request.body) } : {}),
          }),
        );
        void reply.status(response.status);
        // `Headers.forEach` merges repeated Set-Cookie into one line; the
        // callback sets several cookies and each needs its own header.
        const cookies = response.headers.getSetCookie();
        response.headers.forEach((value, name) => {
          if (name.toLowerCase() !== 'set-cookie') void reply.header(name, value);
        });
        if (cookies.length > 0) void reply.header('set-cookie', cookies);
        return reply.send(response.body === null ? null : await response.text());
      } catch (error) {
        // Fastify would serialise the thrown message into the response.
        logger.error(`Auth request failed (${errorLabel(error)})`);
        return reply.status(500).send(errorBody(ErrorCode.INTERNAL));
      }
    },
  });
}
