import { describe, expect, it } from 'vitest';
import { SnowflakeSchema } from './snowflake.js';

describe('SnowflakeSchema', () => {
  it('accepts 17 to 20 digits up to the largest unsigned 64-bit value', () => {
    for (const id of ['12345678901234567', '713025650176294945', '18446744073709551615']) {
      expect(SnowflakeSchema.safeParse(id).success, id).toBe(true);
    }
  });

  it('trims surrounding spaces', () => {
    expect(SnowflakeSchema.parse(' 713025650176294945 ')).toBe('713025650176294945');
  });

  it('rejects a 20-digit value that does not fit 64 bits', () => {
    for (const id of ['18446744073709551616', '99999999999999999999']) {
      expect(SnowflakeSchema.safeParse(id).success, id).toBe(false);
    }
  });

  it('rejects mentions, short ids and text without throwing', () => {
    for (const id of [
      '<@713025650176294945>',
      '1234567890123456',
      '123456789012345678901',
      'abc',
    ]) {
      expect(SnowflakeSchema.safeParse(id).success, id).toBe(false);
    }
  });
});
