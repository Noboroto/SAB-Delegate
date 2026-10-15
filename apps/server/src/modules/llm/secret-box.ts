import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const VERSION = 'v1';
const SALT = 'sab-delegate-llm-key-v1';
const IV_BYTES = 12;
/** Pinned: GCM would otherwise accept a shorter, forgeable tag. */
const TAG_BYTES = 16;

const keys = new Map<string, Buffer>();

/** scrypt is slow on purpose; the key is derived once per secret. */
function keyOf(secret: string): Buffer {
  let key = keys.get(secret);
  if (key === undefined) {
    key = scryptSync(secret, SALT, 32);
    keys.set(secret, key);
  }
  return key;
}

/** AES-256-GCM, stored as `v1:<iv>:<tag>:<ciphertext>` in base64. */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv, { authTagLength: TAG_BYTES });
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64'));
  return [VERSION, ...parts].join(':');
}

/**
 * The plain text, or `null` when it cannot be read back: the secret changed
 * since it was stored, or the value is damaged. The caller then treats the key
 * as missing instead of failing.
 */
export function decryptSecret(stored: string, secret: string): string | null {
  const [version, iv, tag, body] = stored.split(':');
  if (version !== VERSION || iv === undefined || tag === undefined || body === undefined) {
    return null;
  }
  try {
    const nonce = Buffer.from(iv, 'base64');
    if (nonce.length !== IV_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}
