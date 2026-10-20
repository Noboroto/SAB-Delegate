import { z } from '@sab/shared';
import type { loadEnv } from '../../config/env.js';

const EmailVerifyEnvSchema = z.object({
  secret: z.string().optional(),
  adminGuildId: z.string(),
});

export type EmailVerifyEnv = z.infer<typeof EmailVerifyEnvSchema>;

/**
 * What the module takes from the validated environment: only the key secret
 * (which also encrypts the SMTP password and every stored address) and the
 * admin guild. The mail account itself lives in the database.
 */
export function emailVerifyEnvOf(env: ReturnType<typeof loadEnv>): EmailVerifyEnv {
  return EmailVerifyEnvSchema.parse({
    secret: env.LLM_KEY_SECRET,
    adminGuildId: env.ADMIN_GUILD_ID,
  });
}
