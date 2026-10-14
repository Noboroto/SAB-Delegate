import { Transform } from 'node:stream';
import { ErrorCode } from '@sab/shared';
import type { FastifyInstance } from 'fastify';
import { errorBody } from '../common/errors/http-error.js';

/** The route pattern, as Fastify resolves it. */
const MCP_ROUTE = '/mcp';
/** Tool arguments are small; the REST body limit (3 MiB, sized for CSV import) is not needed here. */
export const MCP_BODY_LIMIT_BYTES = 1024 * 1024;

function tooLarge(): Error {
  return Object.assign(new Error('Request body is too large'), {
    statusCode: 413,
    code: 'FST_ERR_CTP_BODY_TOO_LARGE',
  });
}

/**
 * Hooks that must run before the handler and before the body is read, which a
 * Nest controller cannot express.
 *
 * Origin: any request carrying an `Origin` header is a browser, and a browser
 * has no business here (the endpoint takes a bearer key and has no CORS). It
 * is judged on the route Fastify RESOLVED, not on the raw URL: the raw URL is
 * matched literally by Fastify, so `/%6dcp` reaches the same handler with the
 * check bypassed (measured).
 *
 * Body size: 1 MiB, enforced on the stream so a chunked request with no
 * `Content-Length` is cut off too.
 */
export function installMcpHooks(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url !== MCP_ROUTE) return;
    if (request.headers.origin !== undefined) {
      return reply.code(403).send(errorBody(ErrorCode.AUTH_ORIGIN_REJECTED));
    }
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > MCP_BODY_LIMIT_BYTES) {
      return reply.code(413).send(errorBody(ErrorCode.VALIDATION_FAILED));
    }
  });

  fastify.addHook('preParsing', (request, _reply, payload, done) => {
    if (request.routeOptions.url !== MCP_ROUTE) {
      done(null, payload);
      return;
    }
    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > MCP_BODY_LIMIT_BYTES) callback(tooLarge());
        else callback(null, chunk);
      },
    });
    payload.on('error', (error) => limit.destroy(error));
    done(null, payload.pipe(limit));
  });
}
