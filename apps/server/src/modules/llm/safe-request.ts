import { lookup } from 'node:dns/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { request } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** Why an outbound call was not made or failed; the remote text is never kept. */
export class SafePostError extends Error {
  constructor(readonly reason: 'blocked' | 'unreachable' | 'too_large' | 'bad_response') {
    super(`Outbound request failed: ${reason}`);
    this.name = 'SafePostError';
  }
}

/**
 * Addresses an admin-entered URL must never reach: this host, the private
 * networks the bot's containers and the database sit on, link-local (cloud
 * metadata), and the special-purpose ranges.
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
// No `::ffff:0:0/96` rule: BlockList applies it to every IPv4 address, public
// ones included. A mapped address is unwrapped and judged as IPv4 below.
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2001::', 32],
  ['2002::', 16],
  // IPv4-compatible (deprecated) addresses such as ::7f00:1.
  ['::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    // An IPv4-mapped address is judged as the IPv4 address it carries.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)?.[1];
    if (mapped !== undefined) return BLOCKED.check(mapped, 'ipv4');
    return BLOCKED.check(address, 'ipv6');
  }
  return true;
}

type SafeRequestInit = {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs: number;
  /** The response is cut off, and the call fails, past this many bytes. */
  maxBytes: number;
  /** Exact hostnames; any other host is refused before it is resolved. */
  allowHosts?: readonly string[];
  signal?: AbortSignal;
};

type SafeResponse = { status: number; headers: IncomingHttpHeaders; body: Buffer };

/**
 * One https call to an address a user or admin supplied, without letting it
 * reach the bot's own network. The host is resolved once, every answer is
 * checked, and the connection goes to the checked address (no second lookup an
 * attacker's DNS could answer differently). Redirects are not followed, the
 * body is capped, and the whole call is bounded by `timeoutMs`.
 */
export async function safeRequest(init: SafeRequestInit): Promise<SafeResponse> {
  let url: URL;
  try {
    url = new URL(init.url);
  } catch {
    throw new SafePostError('blocked');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new SafePostError('blocked');
  }
  if (init.allowHosts !== undefined && !init.allowHosts.includes(url.hostname)) {
    throw new SafePostError('blocked');
  }
  // One clock for the whole call, DNS included: a cancel or the deadline
  // rejects at once instead of waiting for a slow resolver.
  const budget = AbortSignal.timeout(init.timeoutMs);
  const stop = init.signal === undefined ? budget : AbortSignal.any([budget, init.signal]);
  if (stop.aborted) throw new SafePostError('unreachable');
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await untilAborted(lookup(host, { all: true }), stop);
  } catch {
    throw new SafePostError('unreachable');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new SafePostError('blocked');
  }
  const pinned = addresses[0] as { address: string; family: number };
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === 'object' && options.all === true) {
      callback(null, [pinned]);
    } else {
      callback(null, pinned.address, pinned.family);
    }
  };

  const { body, timeoutMs, maxBytes } = init;
  return new Promise<SafeResponse>((resolve, reject) => {
    // Once the cap is hit the socket is torn down, which can surface as a
    // response error before the request's own; the reason must stay this one.
    let overflowed = false;
    const req = request(
      url,
      {
        method: init.method,
        lookup: pinnedLookup,
        servername: isIP(host) ? undefined : host,
        headers: {
          ...init.headers,
          ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (overflowed) return;
          size += chunk.length;
          if (size > maxBytes) {
            overflowed = true;
            req.destroy(new SafePostError('too_large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (overflowed) return;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', () => reject(new SafePostError(overflowed ? 'too_large' : 'unreachable')));
      },
    );
    const fail = () => req.destroy(new SafePostError('unreachable'));
    stop.addEventListener('abort', fail, { once: true });
    req.on('timeout', fail);
    req.on('error', (error) =>
      reject(
        overflowed
          ? new SafePostError('too_large')
          : error instanceof SafePostError
            ? error
            : new SafePostError('unreachable'),
      ),
    );
    req.on('close', () => stop.removeEventListener('abort', fail));
    req.end(body);
  });
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SafePostError('unreachable'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
