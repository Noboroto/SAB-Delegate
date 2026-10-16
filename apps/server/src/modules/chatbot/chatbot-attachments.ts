import {
  CHATBOT_IMAGE_MAX_BYTES,
  CHATBOT_MAX_IMAGES,
  CHATBOT_MAX_TEXT_FILES,
  CHATBOT_TEXT_MAX_BYTES,
  CHATBOT_TEXT_MAX_CHARS,
} from '@sab/shared';
import { Logger } from '@nestjs/common';
import { safeRequest } from '../llm/safe-request.js';

/** Where Discord serves uploads from; any other host is never contacted. */
const CDN_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'] as const;

const DOWNLOAD_TIMEOUT_MS = 15_000;

/** A text file with more than this share of broken or control characters is not text. */
const MAX_BAD_SHARE = 0.05;

const logger = new Logger('ChatbotAttachments');

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Only for an attachment Discord gave no type; the bytes are sniffed afterwards anyway. */
const IMAGE_EXTENSIONS = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

// Replacement characters, and every control character but tab, newline and carriage return.
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd]/gu;

/** What `load` needs of a Discord attachment. */
type AttachmentSource = {
  name: string;
  url: string;
  size: number;
  contentType: string | null;
};

type Kind = 'image' | 'text' | 'other';

type Skipped = {
  name: string;
  kind: Kind;
  bytes: number;
  reason: 'type' | 'too_large' | 'limit' | 'host' | 'download' | 'unreadable';
};

type Loaded = {
  images: { name: string; data: Uint8Array; mediaType: string }[];
  texts: { name: string; text: string; bytes: number; truncated: boolean }[];
  skipped: Skipped[];
};

type Fetcher = typeof safeRequest;

/**
 * What a failure was, for the log: its class and codes, never its message
 * (which can quote user content or a signed URL).
 */
export function describeFailure(error: unknown): string {
  if (typeof error !== 'object' || error === null) return typeof error;
  const fields = ['code', 'status', 'reason'].flatMap((key) => {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === 'number' || typeof value === 'string' ? [`${key}=${value}`] : [];
  });
  return [error.constructor.name, ...fields].join(' ');
}

function kindOf(source: AttachmentSource): Kind {
  const lowerName = source.name.toLowerCase();
  const declared = source.contentType?.split(';')[0]?.trim().toLowerCase();
  const type =
    declared ??
    [...IMAGE_EXTENSIONS].find(([extension]) => lowerName.endsWith(extension))?.[1] ??
    '';
  if (IMAGE_TYPES.has(type)) return 'image';
  if (type === 'text/plain' || lowerName.endsWith('.txt')) return 'text';
  return 'other';
}

/** The type the bytes really are; the declared one is the sender's word. */
function sniffImage(bytes: Uint8Array): string | undefined {
  const at = (index: number) => bytes[index];
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (
    bytes.length >= 12 &&
    riff.every((byte, index) => at(index) === byte) &&
    webp.every((byte, index) => at(8 + index) === byte)
  ) {
    return 'image/webp';
  }
  return undefined;
}

function isCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      CDN_HOSTS.some((host) => host === parsed.hostname)
    );
  } catch {
    return false;
  }
}

function decodeText(bytes: Uint8Array): { text: string; truncated: boolean } | undefined {
  // Not fatal: a few bad bytes still leave what is readable.
  const decoded = new TextDecoder('utf-8').decode(bytes);
  const bad = decoded.match(BAD_CHARS)?.length ?? 0;
  if (decoded.length > 0 && bad / decoded.length > MAX_BAD_SHARE) return undefined;
  const text = decoded.replace(BAD_CHARS, '');
  if (text.length <= CHATBOT_TEXT_MAX_CHARS) return { text, truncated: false };
  let end = CHATBOT_TEXT_MAX_CHARS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

/**
 * Pictures and .txt files the member attached (to the message or to the one it
 * replies to), ready for the model. Each file is judged and fetched on its own:
 * a refusal or a failure puts it in `skipped` with a reason and never throws,
 * so the reply still goes out. The first `CHATBOT_MAX_IMAGES` pictures and
 * `CHATBOT_MAX_TEXT_FILES` text files in the given order are taken.
 */
export async function loadAttachments(
  sources: readonly AttachmentSource[],
  fetcher: Fetcher = safeRequest,
): Promise<Loaded> {
  const skipped: Skipped[] = [];
  const picked: { source: AttachmentSource; kind: 'image' | 'text'; cap: number }[] = [];
  let images = 0;
  let texts = 0;

  for (const source of sources) {
    const kind = kindOf(source);
    const refuse = (reason: Skipped['reason']) =>
      skipped.push({ name: source.name, kind, bytes: source.size, reason });
    if (kind === 'other') {
      refuse('type');
      continue;
    }
    const cap = kind === 'image' ? CHATBOT_IMAGE_MAX_BYTES : CHATBOT_TEXT_MAX_BYTES;
    if (source.size > cap) {
      refuse('too_large');
      continue;
    }
    if (!isCdnUrl(source.url)) {
      refuse('host');
      continue;
    }
    if (kind === 'image' ? images >= CHATBOT_MAX_IMAGES : texts >= CHATBOT_MAX_TEXT_FILES) {
      refuse('limit');
      continue;
    }
    if (kind === 'image') images += 1;
    else texts += 1;
    picked.push({ source, kind, cap });
  }

  const results = await Promise.all(
    picked.map(async ({ source, kind, cap }) => {
      try {
        // The cap is ours, not the declared size: a lying size cannot make us read more.
        const response = await fetcher({
          url: source.url,
          method: 'GET',
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          maxBytes: cap,
          allowHosts: CDN_HOSTS,
        });
        if (response.status !== 200) {
          logger.warn(`Attachment download refused (status ${response.status})`);
          return { source, kind, body: null };
        }
        return { source, kind, body: new Uint8Array(response.body) };
      } catch (error) {
        logger.warn(`Attachment download failed (${describeFailure(error)})`);
        return { source, kind, body: null };
      }
    }),
  );

  const loaded: Loaded = { images: [], texts: [], skipped };
  for (const result of results) {
    const { source, kind } = result;
    if (result.body === null) {
      skipped.push({ name: source.name, kind, bytes: source.size, reason: 'download' });
    } else if (kind === 'image') {
      const mediaType = sniffImage(result.body);
      if (mediaType === undefined) {
        skipped.push({ name: source.name, kind, bytes: source.size, reason: 'type' });
      } else {
        loaded.images.push({ name: source.name, data: result.body, mediaType });
      }
    } else {
      const decoded = decodeText(result.body);
      if (decoded === undefined) {
        skipped.push({ name: source.name, kind, bytes: source.size, reason: 'unreadable' });
      } else {
        loaded.texts.push({ name: source.name, bytes: result.body.length, ...decoded });
      }
    }
  }
  return loaded;
}
