/**
 * Anything with a `parse` that throws on bad input: a Zod schema from
 * `@sab/shared` satisfies it, and this module stays free of the runtime import
 * (the browser bundle must not carry the whole shared package for a type).
 */
export interface ResponseParser<T> {
  parse(input: unknown): T;
}

/**
 * A non-2xx answer from the server. `code` is the server's `ErrorCode` when the
 * body carried one; callers switch on `status` and `code`, and the UI shows a
 * translation of the code. The server's `message` is English text for logs and
 * is deliberately not kept: it must never reach a screen.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code?: string) {
    super(`Request failed (HTTP ${status}${code === undefined ? '' : `, ${code}`})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }

  /** Unknown server, no permission and no bot all look the same on purpose. */
  get isGuildNotFound(): boolean {
    return this.status === 404 && this.code === 'GUILD_NOT_FOUND';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

function codeOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

/** Turns a failed response into the typed error; an unreadable body keeps only the status. */
export async function toApiRequestError(res: Response): Promise<ApiRequestError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return new ApiRequestError(res.status, codeOf(body));
}

/** The success path: parses the JSON body with `parser`; `204` parses `null`. */
export async function parseApiResponse<T>(res: Response, parser: ResponseParser<T>): Promise<T> {
  if (res.status === 204) return parser.parse(null);
  const text = await res.text();
  return parser.parse(text === '' ? null : (JSON.parse(text) as unknown));
}
