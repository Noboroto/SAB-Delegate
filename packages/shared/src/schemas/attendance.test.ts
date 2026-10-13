import { describe, expect, it } from 'vitest';
import { AttendanceCheckSchema, AttendanceResultSchema } from './attendance.js';

const ID = '123456789012345678';

describe('AttendanceCheckSchema', () => {
  it('needs both the role and the channel as snowflakes', () => {
    expect(AttendanceCheckSchema.parse({ roleId: ID, voiceChannelId: ID })).toEqual({
      roleId: ID,
      voiceChannelId: ID,
    });
    expect(AttendanceCheckSchema.safeParse({ roleId: ID }).success).toBe(false);
    expect(AttendanceCheckSchema.safeParse({ roleId: ID, voiceChannelId: '<#1>' }).success).toBe(
      false,
    );
  });
});

describe('AttendanceResultSchema', () => {
  it('keeps the split and the total', () => {
    const result = {
      roleId: ID,
      roleName: 'Mentors',
      voiceChannelId: ID,
      total: 2,
      present: [{ userId: ID, username: 'an' }],
      absent: [{ userId: ID, username: 'binh' }],
    };
    expect(AttendanceResultSchema.parse(result)).toEqual(result);
  });
});
