import { SafePostError, isBlockedAddress, safeRequest } from './safe-request.js';

export { SafePostError, isBlockedAddress };

const MAX_BODY_BYTES = 256 * 1024;

type SafePostResult = { status: number; body: unknown };

/**
 * POSTs JSON to an https URL an admin entered (see `safeRequest` for what is
 * refused). A body that is not JSON comes back as `null`.
 */
export async function safePostJson(
  target: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs: number,
): Promise<SafePostResult> {
  const response = await safeRequest({
    url: target,
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs,
    maxBytes: MAX_BODY_BYTES,
  });
  const text = response.body.toString('utf8');
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}
