import type { ServerResponse } from 'node:http';

/** JSON-RPC 2.0 `Internal error`. */
const JSON_RPC_INTERNAL_ERROR = -32603;

/**
 * Finishes a hijacked reply with a JSON-RPC error the client can parse.
 *
 * After `reply.hijack()` Fastify no longer owns the response, so nothing may
 * escape to the exception filter: it would send through a reply that cannot
 * write and the client would wait out the proxy's read timeout. Every failure
 * after the hijack ends here instead.
 */
export function endHijacked(raw: ServerResponse): void {
  if (raw.writableEnded) return;
  try {
    if (!raw.headersSent) raw.writeHead(500, { 'content-type': 'application/json' });
    raw.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSON_RPC_INTERNAL_ERROR, message: 'Internal server error' },
      }),
    );
  } catch {
    // The socket is already gone; dropping it is all that is left to do.
    raw.destroy();
  }
}
