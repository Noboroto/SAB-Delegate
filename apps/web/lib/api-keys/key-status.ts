import type { ApiKeyView } from '@sab/shared';

export type ApiKeyStatus = 'active' | 'expired' | 'revoked';

/** Revoked wins over expired: a revoked key stays revoked after its date passes. */
export function apiKeyStatus(
  key: Pick<ApiKeyView, 'revokedAt' | 'expiresAt'>,
  now: number,
): ApiKeyStatus {
  if (key.revokedAt !== null) return 'revoked';
  if (key.expiresAt !== null && key.expiresAt.getTime() <= now) return 'expired';
  return 'active';
}

export function countActiveKeys(
  keys: readonly Pick<ApiKeyView, 'revokedAt' | 'expiresAt'>[],
  now: number,
): number {
  return keys.filter((key) => apiKeyStatus(key, now) === 'active').length;
}
