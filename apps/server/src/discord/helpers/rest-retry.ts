import { DefaultRestOptions, type RESTOptions } from 'discord.js';

type MakeRequest = RESTOptions['makeRequest'];

/**
 * Failures that happen before a single byte reaches Discord: the name did not
 * resolve or the connection was refused. Repeating such a call can never send
 * a message twice. `@discordjs/rest` itself retries only aborts and
 * ECONNRESET, so one DNS hiccup on the host (measured: `getaddrinfo EAI_AGAIN
 * discord.com` failing `/leaderboard`) otherwise fails the whole interaction.
 */
const NOT_SENT_CODES: ReadonlySet<string> = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED']);

/** Waits before each repeat; the REST client's own 15 s timeout still bounds the call. */
const RETRY_DELAYS_MS = [200, 600] as const;

function errorCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') return code;
    current = cause;
  }
  return undefined;
}

/** A stream body is consumed by the first attempt and cannot be sent again. */
function isReplayable(body: unknown): boolean {
  return (
    body === null ||
    body === undefined ||
    typeof body === 'string' ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof Blob
  );
}

function isAborted(signal: AbortSignal | null | undefined): boolean {
  return signal?.aborted === true;
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** `makeRequest` for the bot's REST client that repeats calls Discord never received. */
export function makeRetryingRequest(
  base: MakeRequest = DefaultRestOptions.makeRequest,
  delays: readonly number[] = RETRY_DELAYS_MS,
): MakeRequest {
  return async (url, init) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await base(url, init);
      } catch (error) {
        const code = errorCode(error);
        const delay = delays[attempt];
        if (
          delay === undefined ||
          code === undefined ||
          !NOT_SENT_CODES.has(code) ||
          isAborted(init.signal) ||
          !isReplayable(init.body)
        ) {
          throw error;
        }
        await wait(delay, init.signal);
        // The wait ends early on abort. Rethrow the abort itself, not the DNS
        // error: the REST client handles an AbortError (its timeout) its own way.
        if (isAborted(init.signal)) throw init.signal?.reason ?? error;
      }
    }
  };
}
