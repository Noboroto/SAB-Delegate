import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

/** Who to look for (the role) and where (the voice or stage channel). */
export const AttendanceCheckSchema = z.object({
  roleId: SnowflakeSchema,
  voiceChannelId: SnowflakeSchema,
});

export type AttendanceCheck = z.infer<typeof AttendanceCheckSchema>;

export const AttendanceMemberSchema = z.object({
  userId: SnowflakeSchema,
  username: z.string(),
});

export type AttendanceMember = z.infer<typeof AttendanceMemberSchema>;

/** Members of the role split by whether they are in the channel right now. */
export const AttendanceResultSchema = z.object({
  roleId: SnowflakeSchema,
  roleName: z.string(),
  voiceChannelId: SnowflakeSchema,
  total: z.number().int().min(0),
  present: z.array(AttendanceMemberSchema),
  absent: z.array(AttendanceMemberSchema),
});

export type AttendanceResult = z.infer<typeof AttendanceResultSchema>;
