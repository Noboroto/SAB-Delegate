import { notFound } from 'next/navigation';
import { SnowflakeSchema } from '@sab/shared';

/**
 * A Discord id taken from a URL or a form, safe to put in an API path; any other
 * value (`..%2F..%2Fme%2Fx`, a mention, digits that are too long) renders the
 * not-found page instead of reaching another route of the server. The layout's
 * own check does not stop a page that fetches at the same time, so every path
 * builder validates for itself.
 */
export function snowflakeSegment(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) notFound();
  return parsed.data;
}

/** `/api/guilds/<guildId>/<rest...>` with every segment validated or encoded. */
export function guildApiPath(guildId: string, ...rest: string[]): string {
  const segments = rest.flatMap((part) => part.split('/')).map(encodeURIComponent);
  return ['/api/guilds', snowflakeSegment(guildId), ...segments].join('/');
}
