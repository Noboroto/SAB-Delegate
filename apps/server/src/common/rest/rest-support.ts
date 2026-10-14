import { z } from '@sab/shared';

/**
 * The two flags of a destructive body. The service itself does the preview
 * (`dryRun`); the controller only hands the flag down.
 */
export const destructiveFlags = {
  dryRun: z.boolean().default(false),
  confirm: z.boolean().default(false),
};

/**
 * A body that either asks for a preview or confirms the real run: sending
 * neither is a 400 on `confirm`, so a stray request cannot delete anything.
 */
export function requireConfirmation<T extends z.ZodType<{ dryRun: boolean; confirm: boolean }>>(
  schema: T,
): T {
  return schema.refine(({ dryRun, confirm }) => dryRun || confirm, {
    message: 'confirm must be true to run; send dryRun to preview',
    path: ['confirm'],
  });
}
