import { describe, expect, it } from 'vitest';
import robots from './robots';

describe('robots', () => {
  const rules = [robots().rules].flat();

  it.each(['facebookexternalhit', 'Facebot'])('gives %s its own group that allows /', (agent) => {
    expect(rules).toContainEqual({ userAgent: agent, allow: '/' });
  });

  it('lets other crawlers follow / through /servers to /login, but not into the API', () => {
    const rest = rules.find((rule) => rule.userAgent === '*');
    expect(rest?.allow).toBe('/');
    expect(rest?.disallow).toEqual(['/api/', '/mcp']);
  });
});
