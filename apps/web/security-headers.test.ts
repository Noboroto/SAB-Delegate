import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

describe('securityHeaders', () => {
  it('sends HSTS in production only', () => {
    const keys = (production: boolean) => securityHeaders(production).map(({ key }) => key);
    expect(keys(true)).toContain('Strict-Transport-Security');
    expect(keys(false)).not.toContain('Strict-Transport-Security');
  });

  it('allows eval and a hot-reload socket in development only', () => {
    const dev = contentSecurityPolicy(false);
    const prod = contentSecurityPolicy(true);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain('ws:');
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).not.toContain('ws:');
    expect(dev).toContain("frame-ancestors 'none'");
    expect(prod).toContain("frame-ancestors 'none'");
  });
});
