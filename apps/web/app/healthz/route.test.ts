import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /healthz', () => {
  it('answers 200 without reading cookies or calling the server, and is never cached', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });
});
