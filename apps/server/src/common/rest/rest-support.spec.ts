import { z } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import { destructiveFlags, requireConfirmation } from './rest-support.js';

describe('requireConfirmation', () => {
  const schema = requireConfirmation(z.object({ name: z.string(), ...destructiveFlags }));

  it('accepts a preview or a confirmed run', () => {
    expect(schema.parse({ name: 'a', dryRun: true })).toEqual({
      name: 'a',
      dryRun: true,
      confirm: false,
    });
    expect(schema.parse({ name: 'a', confirm: true })).toMatchObject({ dryRun: false });
  });

  it('refuses neither, pointing at confirm', () => {
    const result = schema.safeParse({ name: 'a' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirm']);
  });
});
