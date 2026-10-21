import { describe, expect, it } from 'vitest';
import { parseThreadsTab } from './threads-tabs';

describe('parseThreadsTab', () => {
  it('reads a known tab, from a string or the first of several', () => {
    expect(parseThreadsTab('rename')).toBe('rename');
    expect(parseThreadsTab(['delete', 'create'])).toBe('delete');
  });

  it('opens the first tab for anything else', () => {
    expect(parseThreadsTab(undefined)).toBe('create');
    expect(parseThreadsTab('nope')).toBe('create');
    expect(parseThreadsTab([])).toBe('create');
  });
});
