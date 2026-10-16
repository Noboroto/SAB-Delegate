import {
  CHATBOT_IMAGE_MAX_BYTES,
  CHATBOT_MAX_IMAGES,
  CHATBOT_TEXT_MAX_BYTES,
  CHATBOT_TEXT_MAX_CHARS,
} from '@sab/shared';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SafePostError, type safeRequest } from '../llm/safe-request.js';
import { loadAttachments } from './chatbot-attachments.js';

const CDN = 'https://cdn.discordapp.com/attachments/1/2';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF = Buffer.from('GIF89a');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

function source(
  name: string,
  overrides: Partial<{ url: string; size: number; contentType: string | null }> = {},
) {
  return { name, url: `${CDN}/${name}`, size: 10, contentType: 'image/png', ...overrides };
}

function respond(body: Buffer, status = 200) {
  return vi.fn<typeof safeRequest>().mockResolvedValue({ status, headers: {}, body });
}

describe('loadAttachments', () => {
  it('returns the four image types as image parts typed by their bytes', async () => {
    const bodies = new Map([
      ['a.png', PNG],
      ['b.jpg', JPEG],
      ['c.gif', GIF],
      ['d.webp', WEBP],
    ]);
    const fetcher = vi.fn<typeof safeRequest>(({ url }) =>
      Promise.resolve({
        status: 200,
        headers: {},
        body: bodies.get(url.split('/').pop() ?? '') ?? Buffer.alloc(0),
      }),
    );
    const loaded = await loadAttachments(
      [source('a.png'), source('b.jpg', { contentType: 'image/jpeg' })],
      fetcher,
    );
    expect(loaded.images.map((image) => image.mediaType)).toEqual(['image/png', 'image/jpeg']);
    const more = await loadAttachments(
      [
        source('c.gif', { contentType: 'image/gif' }),
        source('d.webp', { contentType: 'image/webp' }),
      ],
      fetcher,
    );
    expect(more.images.map((image) => image.mediaType)).toEqual(['image/gif', 'image/webp']);
  });

  it('skips a file whose bytes are not the declared image type', async () => {
    const loaded = await loadAttachments([source('fake.png')], respond(Buffer.from('<html>')));
    expect(loaded.images).toEqual([]);
    expect(loaded.skipped).toEqual([
      { name: 'fake.png', kind: 'image', bytes: 10, reason: 'type' },
    ]);
  });

  it('skips oversize files without fetching them', async () => {
    const fetcher = respond(PNG);
    const loaded = await loadAttachments(
      [
        source('big.png', { size: CHATBOT_IMAGE_MAX_BYTES + 1 }),
        source('big.txt', { size: CHATBOT_TEXT_MAX_BYTES + 1, contentType: 'text/plain' }),
      ],
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(loaded.skipped.map((entry) => entry.reason)).toEqual(['too_large', 'too_large']);
  });

  it('skips other types without fetching them', async () => {
    const fetcher = respond(PNG);
    const loaded = await loadAttachments(
      [
        source('a.pdf', { contentType: 'application/pdf' }),
        source('b.svg', { contentType: 'image/svg+xml' }),
      ],
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(loaded.skipped.map((entry) => [entry.kind, entry.reason])).toEqual([
      ['other', 'type'],
      ['other', 'type'],
    ]);
  });

  it.each([
    'https://evil.example/a.png',
    'http://cdn.discordapp.com/a.png',
    'https://cdn.discordapp.com.evil.example/a.png',
    'https://user@cdn.discordapp.com/a.png',
    'https://169.254.169.254/a.png',
    'not a url',
  ])('refuses %s before any request', async (url) => {
    const fetcher = respond(PNG);
    const loaded = await loadAttachments([source('a.png', { url })], fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(loaded.skipped[0]?.reason).toBe('host');
  });

  it('fetches only from the CDN hosts, capped, with a timeout', async () => {
    const fetcher = respond(PNG);
    await loadAttachments(
      [source('a.png'), source('b.png', { url: 'https://media.discordapp.net/x/b.png' })],
      fetcher,
    );
    for (const [init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET',
        maxBytes: CHATBOT_IMAGE_MAX_BYTES,
        allowHosts: ['cdn.discordapp.com', 'media.discordapp.net'],
      });
      expect(init.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('does not follow a redirect', async () => {
    const fetcher = respond(Buffer.alloc(0), 302);
    const loaded = await loadAttachments([source('a.png')], fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loaded.skipped[0]?.reason).toBe('download');
  });

  it('turns a transport failure into a skip, never a throw', async () => {
    const fetcher = vi.fn().mockRejectedValue(new SafePostError('too_large'));
    const loaded = await loadAttachments([source('a.png')], fetcher);
    expect(loaded.skipped[0]).toMatchObject({ name: 'a.png', reason: 'download' });
  });

  it('keeps the other files when one fails', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new SafePostError('unreachable'))
      .mockResolvedValueOnce({ status: 200, headers: {}, body: PNG });
    const loaded = await loadAttachments([source('a.png'), source('b.png')], fetcher);
    expect(loaded.images.map((image) => image.name)).toEqual(['b.png']);
    expect(loaded.skipped.map((entry) => entry.name)).toEqual(['a.png']);
  });

  it('takes the first images only and reports the rest as over the limit', async () => {
    const sources = Array.from({ length: CHATBOT_MAX_IMAGES + 1 }, (_, index) =>
      source(`${index}.png`),
    );
    const fetcher = respond(PNG);
    const loaded = await loadAttachments(sources, fetcher);
    expect(loaded.images).toHaveLength(CHATBOT_MAX_IMAGES);
    expect(fetcher).toHaveBeenCalledTimes(CHATBOT_MAX_IMAGES);
    expect(loaded.skipped).toEqual([
      { name: `${CHATBOT_MAX_IMAGES}.png`, kind: 'image', bytes: 10, reason: 'limit' },
    ]);
  });

  it('takes one text file; a second is over the limit', async () => {
    const loaded = await loadAttachments(
      [source('a.txt', { contentType: 'text/plain' }), source('b.txt', { contentType: null })],
      respond(Buffer.from('xin chào')),
    );
    expect(loaded.texts).toEqual([{ name: 'a.txt', text: 'xin chào', bytes: 9, truncated: false }]);
    expect(loaded.skipped).toEqual([{ name: 'b.txt', kind: 'text', bytes: 10, reason: 'limit' }]);
  });

  it('cuts a long text at the character cap and says so', async () => {
    const loaded = await loadAttachments(
      [source('long.txt', { contentType: 'text/plain; charset=utf-8' })],
      respond(Buffer.from('a'.repeat(CHATBOT_TEXT_MAX_CHARS + 500))),
    );
    expect(loaded.texts[0]?.text).toHaveLength(CHATBOT_TEXT_MAX_CHARS);
    expect(loaded.texts[0]?.truncated).toBe(true);
  });

  it('does not split a surrogate pair at the cut, and drops NULs', async () => {
    const body = Buffer.from(`${'a'.repeat(CHATBOT_TEXT_MAX_CHARS - 1)}😀tail\0`);
    const loaded = await loadAttachments(
      [source('e.txt', { contentType: 'text/plain' })],
      respond(body),
    );
    const text = loaded.texts[0]?.text ?? '';
    expect(text).toBe('a'.repeat(CHATBOT_TEXT_MAX_CHARS - 1));
    expect(text).not.toContain('\0');
  });

  it('reads a type-less picture by its extension and still checks the bytes', async () => {
    const ok = await loadAttachments([source('a.JPG', { contentType: null })], respond(JPEG));
    expect(ok.images.map((image) => image.mediaType)).toEqual(['image/jpeg']);
    const lying = await loadAttachments([source('a.png', { contentType: null })], respond(JPEG));
    expect(lying.images[0]?.mediaType).toBe('image/jpeg');
    const text = await loadAttachments([source('a.bin', { contentType: null })], respond(PNG));
    expect(text.skipped[0]?.reason).toBe('type');
  });

  it('skips a .txt that is mostly binary or broken, keeps a clean one', async () => {
    const binary = Buffer.from([
      ...Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0x01 : 0x61)),
    ]);
    const broken = Buffer.from(Array.from({ length: 100 }, (_, i) => (i % 3 === 0 ? 0xff : 0x61)));
    for (const body of [binary, broken]) {
      const loaded = await loadAttachments(
        [source('x.txt', { contentType: 'text/plain' })],
        respond(body),
      );
      expect(loaded.texts).toEqual([]);
      expect(loaded.skipped).toEqual([
        { name: 'x.txt', kind: 'text', bytes: 10, reason: 'unreadable' },
      ]);
    }
  });

  it('strips the few control characters of an otherwise readable text, keeping line breaks', async () => {
    const body = Buffer.from(`${'a'.repeat(100)}\u0001\u0085\ttab\r\nnext\0`);
    const loaded = await loadAttachments(
      [source('c.txt', { contentType: 'text/plain' })],
      respond(body),
    );
    expect(loaded.texts[0]?.text).toBe(`${'a'.repeat(100)}\ttab\r\nnext`);
  });

  it('logs a failed download by class and reason only', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const secret = 'https://cdn.discordapp.com/a.png?ex=SIGNED&hm=SECRET';
    const fetcher = vi.fn<typeof safeRequest>().mockRejectedValue(new SafePostError('unreachable'));
    await loadAttachments([source('a.png', { url: secret })], fetcher);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('SafePostError');
    expect(line).toContain('reason=unreachable');
    expect(line).not.toContain('SECRET');
    expect(line).not.toContain('Outbound request failed');
    warn.mockRestore();
  });
});
