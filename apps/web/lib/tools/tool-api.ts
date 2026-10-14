import { apiFetch } from '@/lib/api/api-fetch';
import type { ResponseParser } from '@/lib/api/api-response';
import { guildApiPath } from '@/lib/guild-path';

function toolUrl(guildId: string, path: string): string {
  return guildApiPath(guildId, path);
}

/** A write (or an action that reads and may post) on one of the tool routes. */
export function postTool<T>(
  guildId: string,
  path: string,
  body: unknown,
  parser: ResponseParser<T>,
): Promise<T> {
  return apiFetch(toolUrl(guildId, path), { method: 'POST', body, parser });
}

/** A lookup route; absent values are left out of the query string. */
export function getTool<T>(
  guildId: string,
  path: string,
  query: Record<string, string | undefined>,
  parser: ResponseParser<T>,
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  return apiFetch(`${toolUrl(guildId, path)}?${params.toString()}`, { parser });
}
