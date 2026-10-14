import { describe, expect, it } from 'vitest';
import { BOT_AVATAR_MAX_BYTES } from '@sab/shared';
import { readAvatarFile } from './avatar-file';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function pngFile(type = 'image/png', name = 'a.png') {
  const bytes = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0));
  return new File([bytes], name, { type });
}

describe('readAvatarFile', () => {
  it('returns the base64 the server takes and a data URL to preview', async () => {
    const result = await readAvatarFile(pngFile());
    expect(result).toEqual({
      ok: true,
      base64: PNG_BASE64,
      previewUrl: `data:image/png;base64,${PNG_BASE64}`,
    });
  });

  it('rejects a picture over the limit before reading it', async () => {
    const big = new File([new Uint8Array(BOT_AVATAR_MAX_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    await expect(readAvatarFile(big)).resolves.toEqual({ ok: false, error: 'size' });
  });

  it('accepts a picture exactly at the limit if it is an image', async () => {
    const bytes = new Uint8Array(BOT_AVATAR_MAX_BYTES);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    const result = await readAvatarFile(new File([bytes], 'ok.jpg', { type: 'image/jpeg' }));
    expect(result.ok).toBe(true);
  });

  it('rejects a type the server does not take', async () => {
    const webp = new File([new Uint8Array(10)], 'a.webp', { type: 'image/webp' });
    await expect(readAvatarFile(webp)).resolves.toEqual({ ok: false, error: 'type' });
  });

  it('rejects a file that claims to be a picture but is not', async () => {
    const fake = new File([new TextEncoder().encode('just some text here')], 'a.png', {
      type: 'image/png',
    });
    await expect(readAvatarFile(fake)).resolves.toEqual({ ok: false, error: 'type' });
  });

  it('reports an empty file as unreadable', async () => {
    const empty = new File([], 'a.png', { type: 'image/png' });
    await expect(readAvatarFile(empty)).resolves.toEqual({ ok: false, error: 'read' });
  });
});
