import { lookup } from 'node:dns/promises';
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

const MAX_BODY_BYTES = 256 * 1024;

type SafePostResult = { status: number; body: unknown };

/**
 * POSTs JSON to an https URL an admin entered, without letting it reach the
 * bot's own network. The host is resolved once, every answer is checked, and
 * the connection goes to the checked address (no second lookup an attacker's
 * DNS could answer differently). Redirects are not followed, the body is
 * capped, and the whole call is bounded by `timeoutMs`.
 */
export async function safePostJson(
  target: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs: number,
): Promise<SafePostResult> {
  const url = new URL(target);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new SafePostError('blocked');
  }
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true });
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

  const body = JSON.stringify(payload);
  return new Promise<SafePostResult>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        lookup: pinnedLookup,
        servername: isIP(host) ? undefined : host,
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new SafePostError('too_large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = null;
          try {
            parsed = text === '' ? null : JSON.parse(text);
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
        res.on('error', () => reject(new SafePostError('unreachable')));
      },
    );
    const deadline = setTimeout(() => req.destroy(new SafePostError('unreachable')), timeoutMs);
    req.on('timeout', () => req.destroy(new SafePostError('unreachable')));
    req.on('error', (error) =>
      reject(error instanceof SafePostError ? error : new SafePostError('unreachable')),
    );
    req.on('close', () => clearTimeout(deadline));
    req.end(body);
  });
}
