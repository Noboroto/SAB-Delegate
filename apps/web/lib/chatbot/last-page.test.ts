import { describe, expect, it } from 'vitest';
import { lastPageIfPastEnd } from './last-page';

const at = (page: number, total: number, items: number) => ({
  items: Array.from({ length: items }),
  pagination: { page, pageSize: 10, total },
});

describe('lastPageIfPastEnd', () => {
  it('leaves a page that has rows, and the first page, alone', () => {
    expect(lastPageIfPastEnd(at(2, 15, 5))).toBeUndefined();
    expect(lastPageIfPastEnd(at(1, 0, 0))).toBeUndefined();
  });

  it('points to the last page that exists, or the first when nothing is left', () => {
    expect(lastPageIfPastEnd(at(4, 15, 0))).toBe(2);
    expect(lastPageIfPastEnd(at(3, 0, 0))).toBe(1);
  });
});
