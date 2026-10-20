import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UPLOAD_MAX_BYTES, readUpload } from './email-list-upload.js';

type UploadedFile = Parameters<typeof readUpload>[0];

const file = (over: Partial<UploadedFile> = {}): UploadedFile => ({
  url: 'https://cdn.discordapp.com/attachments/1/2/list.csv?ex=1',
  name: 'list.csv',
  size: 100,
  contentType: 'text/csv; charset=utf-8',
  ...over,
});

const answering = (body: string | null, init: ResponseInit = {}) =>
  vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(new Response(body, { status: 200, ...init })),
  );

describe('readUpload', () => {
  it('reads the distinct items between commas, spaces and line breaks', async () => {
    const fetcher = answering('﻿a@x.io, b@x.io\nA@x.io;b@x.io\r\n\r\n');
    const result = await readUpload(file(), fetcher);
    expect(result).toEqual({ ok: true, items: ['a@x.io', 'b@x.io', 'A@x.io'] });
  });

  it('fetches from the Discord file hosts only, and never follows a redirect', async () => {
    const fetcher = answering('a@x.io');
    await readUpload(
      file({ url: 'https://media.discordapp.net/attachments/1/2/list.txt', name: 'list.txt' }),
      fetcher,
    );
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('https://media.discordapp.net/attachments/1/2/list.txt');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    for (const url of [
      'https://evil.example/list.csv',
      'http://cdn.discordapp.com/list.csv',
      'https://cdn.discordapp.com.evil.example/list.csv',
      'not a url',
    ]) {
      const refused = answering('a@x.io');
      expect(await readUpload(file({ url }), refused)).toEqual({ ok: false, reason: 'UNREADABLE' });
      expect(refused).not.toHaveBeenCalled();
    }
  });

  it('refuses a file that is not CSV or TXT', async () => {
    const fetcher = answering('x');
    expect(
      await readUpload(file({ name: 'photo.png', contentType: 'image/png' }), fetcher),
    ).toEqual({
      ok: false,
      reason: 'TYPE',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('takes a file by its type when its name has no extension', async () => {
    const result = await readUpload(
      file({ name: 'list', contentType: 'text/plain' }),
      answering('a@x.io'),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a file over the limit before downloading it', async () => {
    const fetcher = answering('x');
    expect(await readUpload(file({ size: UPLOAD_MAX_BYTES + 1 }), fetcher)).toEqual({
      ok: false,
      reason: 'TOO_BIG',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops reading a body that is bigger than the size it claimed', async () => {
    const big = 'a@x.io\n'.repeat(Math.ceil(UPLOAD_MAX_BYTES / 7) + 10);
    expect(await readUpload(file(), answering(big))).toEqual({ ok: false, reason: 'TOO_BIG' });
  });

  it('reports an empty file', async () => {
    expect(await readUpload(file(), answering(' \n, \n'))).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('reports a failed download without leaking why', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const failing = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
      expect(await readUpload(file(), failing)).toEqual({ ok: false, reason: 'UNREADABLE' });
      expect(await readUpload(file(), answering('x', { status: 404 }))).toEqual({
        ok: false,
        reason: 'UNREADABLE',
      });
    } finally {
      warn.mockRestore();
    }
  });
});
