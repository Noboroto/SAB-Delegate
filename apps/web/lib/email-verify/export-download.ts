import { reactToUnauthorized } from '@/lib/api/api-fetch';
import { toApiRequestError } from '@/lib/api/api-response';
import { emailMembersExportPath } from './email-verify-api';

const EXPORT_FILE_NAME = 'email-verify-members.xlsx';

/** The file name the server chose (`filename*` first, then `filename`), safe to use as a download name. */
export function fileNameFromDisposition(header: string | null): string | undefined {
  if (header === null) return undefined;
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  let raw: string | undefined;
  if (encoded !== undefined) {
    try {
      raw = decodeURIComponent(encoded.trim());
    } catch {
      raw = undefined;
    }
  }
  raw ??= /filename\s*=\s*(?:"([^"]*)"|([^;]+))/
    .exec(header)
    ?.slice(1, 3)
    .find((m) => m);
  // A name is never a path: keep what follows the last separator, without control characters.
  const name = raw
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f]/g, '')
    .trim();
  return name === undefined || name === '' ? undefined : name;
}

/**
 * Fetches the Excel export through the same-origin proxy (the login cookie
 * travels with it) and hands the file to the browser. Going through `fetch`
 * rather than a bare link keeps a failure on this page, as an error the caller
 * can show, instead of navigating to the server's JSON error.
 */
export async function downloadMembersExport(guildId: string): Promise<void> {
  const res = await fetch(emailMembersExportPath(guildId), { credentials: 'same-origin' });
  if (!res.ok) {
    const error = await toApiRequestError(res);
    if (error.isUnauthenticated) reactToUnauthorized();
    throw error;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    fileNameFromDisposition(res.headers.get('Content-Disposition')) ?? EXPORT_FILE_NAME;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked later: some browsers start the save after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
