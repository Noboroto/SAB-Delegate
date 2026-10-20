import type { ReadableStreamDefaultReader } from 'node:stream/web';
import { Logger } from '@nestjs/common';
import type { Attachment } from 'discord.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { splitItems } from './email-verify.command-support.js';

/** Largest file taken: a list holds at most 20 000 addresses, a few hundred KB of text. */
export const UPLOAD_MAX_BYTES = 1024 * 1024;

/** Longest wait for the file; the interaction token lives 15 minutes, the person should not. */
const FETCH_TIMEOUT_MS = 15_000;

/** The only hosts a file is fetched from: the places Discord serves its attachments. */
const DISCORD_CDN_HOSTS: ReadonlySet<string> = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
]);

const TEXT_TYPES = ['text/csv', 'text/plain'];
const TEXT_EXTENSIONS = ['.csv', '.txt'];

const logger = new Logger('EmailListUpload');

/** The part of a Discord attachment that is read. */
type UploadedFile = Pick<Attachment, 'url' | 'name' | 'size' | 'contentType'>;

export type UploadResult =
  | { ok: true; items: string[] }
  | { ok: false; reason: 'TYPE' | 'TOO_BIG' | 'UNREADABLE' | 'EMPTY' };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

function isTextFile(file: UploadedFile): boolean {
  const name = file.name.toLowerCase();
  const type = (file.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return TEXT_EXTENSIONS.some((ext) => name.endsWith(ext)) || TEXT_TYPES.includes(type);
}

/** The attachment URL, only when it points at Discord's own file hosts over https. */
function cdnUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && DISCORD_CDN_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** The body as text, or `null` once it is past the size limit (the rest is never read). */
async function readCapped(response: Response): Promise<string | null> {
  if (response.body === null) return null;
  // fetch's body type has `any` chunks; a body is bytes.
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > UPLOAD_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/**
 * The distinct items of an uploaded CSV or TXT file: whatever sits between
 * commas, semicolons, spaces and line breaks. Whether an item is an address is
 * for the list service to say. The file is fetched only from Discord's file
 * hosts, without following a redirect elsewhere, within a time limit and a size
 * limit; the person's own file never reaches another server.
 */
export async function readUpload(
  file: UploadedFile,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<UploadResult> {
  if (!isTextFile(file)) return { ok: false, reason: 'TYPE' };
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, reason: 'TOO_BIG' };
  const url = cdnUrl(file.url);
  if (url === null) return { ok: false, reason: 'UNREADABLE' };

  let text: string | null;
  try {
    const response = await fetcher(url.href, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) return { ok: false, reason: 'UNREADABLE' };
    text = await readCapped(response);
  } catch (error) {
    logger.warn(`Could not download an uploaded list file (${errorLabel(error)})`);
    return { ok: false, reason: 'UNREADABLE' };
  }
  if (text === null) return { ok: false, reason: 'TOO_BIG' };

  const items = [...new Set(splitItems(text.replace(/^﻿/, '')))];
  return items.length === 0 ? { ok: false, reason: 'EMPTY' } : { ok: true, items };
}
