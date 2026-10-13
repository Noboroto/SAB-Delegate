import { z } from 'zod';

/** Administrator, and Manage Server, as Discord numbers them. */
const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

/**
 * A member's guild permissions as Discord sends them: a decimal string, because
 * the bit set outgrows the safe integer range. Anything else is not a
 * permission set.
 */
const PermissionsStringSchema = z.string().regex(/^\d{1,20}$/);

export const CanManageGuildInputSchema = z.object({
  permissions: PermissionsStringSchema,
  /** The member owns the guild; owners hold every permission whatever their roles say. */
  isOwner: z.boolean(),
});

export type CanManageGuildInput = z.infer<typeof CanManageGuildInputSchema>;

/**
 * Whether a member may use the dashboard and API for a guild: Manage Server,
 * Administrator or ownership. Pure so the bot and the web app decide the same
 * way. Fails closed: a value that is not a decimal permission string grants
 * nothing, even to an owner flag it cannot be paired with.
 */
export function canManageGuild(input: CanManageGuildInput): boolean {
  const parsed = CanManageGuildInputSchema.safeParse(input);
  if (!parsed.success) return false;
  if (parsed.data.isOwner) return true;
  const bits = BigInt(parsed.data.permissions);
  return (bits & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;
}
