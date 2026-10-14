import {
  ApiKeyMintResultSchema,
  ApiKeyViewSchema,
  z,
  type ApiKeyMint,
  type ApiKeyMintResult,
  type ApiKeyView,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';

const API_KEYS_PATH = '/api/me/api-keys';

/** What the server component and the browser both parse the key list with. */
export const ApiKeyListSchema = z.array(ApiKeyViewSchema);

/** The answer carries the secret: the caller keeps it only as long as the person needs to copy it. */
export function mintApiKey(input: ApiKeyMint): Promise<ApiKeyMintResult> {
  return apiFetch(API_KEYS_PATH, { method: 'POST', body: input, parser: ApiKeyMintResultSchema });
}

export function revokeApiKey(id: string): Promise<ApiKeyView> {
  return apiFetch(`${API_KEYS_PATH}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    parser: ApiKeyViewSchema,
  });
}
