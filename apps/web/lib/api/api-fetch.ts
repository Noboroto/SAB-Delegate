import { parseApiResponse, toApiRequestError, type ResponseParser } from './api-response';

export { ApiRequestError } from './api-response';

/** Where a signed-out browser goes; `next` brings the person back afterwards. */
export function loginUrl(next: string | undefined): string {
  return next === undefined ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

let onUnauthorized = (): void => {
  // Already on the login page: a second navigation would only reload it.
  if (window.location.pathname === '/login') return;
  window.location.assign(loginUrl(currentPath()));
};

/** Replaces the 401 reaction (tests, or a shell that wants a soft navigation). */
export function setUnauthorizedHandler(handler: () => void): () => void {
  const previous = onUnauthorized;
  onUnauthorized = handler;
  return () => {
    onUnauthorized = previous;
  };
}

/** The 401 reaction, for browser calls that cannot go through `apiFetch` (file downloads). */
export function reactToUnauthorized(): void {
  onUnauthorized();
}

interface ApiFetchOptions<T> {
  parser: ResponseParser<T>;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Browser-side call to the server. The path is same-origin (`/api/...`): Next
 * rewrites it to the Nest server, and the login cookie travels with it.
 * A 401 sends the person to the login page; every other failure throws an
 * `ApiRequestError` for the caller to turn into a message (404 `GUILD_NOT_FOUND`
 * is `error.isGuildNotFound`).
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions<T>): Promise<T> {
  const hasBody = options.body !== undefined;
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  if (!res.ok) {
    const error = await toApiRequestError(res);
    if (error.isUnauthenticated) onUnauthorized();
    throw error;
  }
  return parseApiResponse(res, options.parser);
}
