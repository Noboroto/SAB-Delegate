import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ErrorCode } from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { isBlockedAddress } from '../llm/safe-request.js';

const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * The address a mail server saved in the dashboard resolves to, after checking
 * that none of its addresses is on this host or a private, link-local or
 * special-purpose network. The caller connects to the returned address (not to
 * the name again), so a name that changes its answer between the check and the
 * connection cannot reach the bot's own network. A name that does not resolve
 * is refused too: it cannot be vouched for.
 *
 * The host named in the environment is the operator's own and skips this.
 */
export async function resolveSafeSmtpAddress(host: string): Promise<string> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0) {
    if (isBlockedAddress(bare)) throw new ServiceError(ErrorCode.SMTP_ADDRESS_BLOCKED);
    return bare;
  }
  let addresses: { address: string }[];
  try {
    addresses = await Promise.race([
      lookup(bare, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('lookup timed out')), LOOKUP_TIMEOUT_MS).unref();
      }),
    ]);
  } catch {
    throw new ServiceError(ErrorCode.SMTP_ADDRESS_BLOCKED);
  }
  const first = addresses[0];
  if (first === undefined || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new ServiceError(ErrorCode.SMTP_ADDRESS_BLOCKED);
  }
  return first.address;
}
