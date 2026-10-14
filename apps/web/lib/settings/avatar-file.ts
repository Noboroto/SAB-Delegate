import { BOT_AVATAR_MAX_BYTES } from '@sab/shared';

export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/gif';
export const AVATAR_MAX_KIB = BOT_AVATAR_MAX_BYTES / 1024;

export type AvatarFileError = 'type' | 'size' | 'read';

export type AvatarPick =
  { ok: true; base64: string; previewUrl: string } | { ok: false; error: AvatarFileError };

const SIGNATURES: ReadonlyArray<readonly number[]> = [
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [0xff, 0xd8, 0xff],
  [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
];

/** The server judges the format by its first bytes, so a renamed file is caught here too. */
function hasImageSignature(base64: string): boolean {
  try {
    // 12 base64 characters decode to the 9 bytes that cover the longest signature.
    const head = atob(base64.slice(0, 12));
    return SIGNATURES.some((signature) =>
      signature.every((byte, index) => head.charCodeAt(index) === byte),
    );
  } catch {
    return false;
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('not text'));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Checks a chosen picture before anything is sent, then reads it. The base64
 * is what the server's request schema takes; the data URL is only for the
 * preview (the page's image policy allows `data:`).
 */
export async function readAvatarFile(file: File): Promise<AvatarPick> {
  if (file.size > BOT_AVATAR_MAX_BYTES) return { ok: false, error: 'size' };
  if (!AVATAR_ACCEPT.split(',').includes(file.type)) return { ok: false, error: 'type' };
  let dataUrl: string;
  try {
    dataUrl = await readAsDataUrl(file);
  } catch {
    return { ok: false, error: 'read' };
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (base64.length === 0) return { ok: false, error: 'read' };
  if (!hasImageSignature(base64)) return { ok: false, error: 'type' };
  return { ok: true, base64, previewUrl: dataUrl };
}
