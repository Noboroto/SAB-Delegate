import { createHash } from 'node:crypto';
import { z } from '@sab/shared';
import type { ToolClass } from './tool-guard.js';

/** Fields every write tool carries; the server enforces what they mean, not the model. */
const WRITE_GUARD_SHAPE = {
  dryRun: z
    .boolean()
    .optional()
    .describe(
      'Preview only: reports what would change and writes nothing. For a confirm-class tool it also returns the confirmToken.',
    ),
  confirmToken: z
    .string()
    .max(128)
    .optional()
    .describe(
      'One-use token returned by a dryRun call with the same arguments. Required to perform the change.',
    ),
};

/** Extra field of the bulk/irreversible class. */
const CONFIRM_GUILD_NAME_SHAPE = {
  confirmGuildName: z
    .string()
    .max(200)
    .optional()
    .describe('The exact current name of the server, typed back to confirm a bulk change.'),
};

const GUARD_FIELDS = ['dryRun', 'confirmToken', 'confirmGuildName'] as const;

/** The guard fields a class adds to the tool's own input. */
export function guardShapeFor(toolClass: ToolClass) {
  switch (toolClass) {
    case 'R':
      return {};
    case 'W':
      return { dryRun: WRITE_GUARD_SHAPE.dryRun };
    case 'C':
      return WRITE_GUARD_SHAPE;
    case 'CC':
      return { ...WRITE_GUARD_SHAPE, ...CONFIRM_GUILD_NAME_SHAPE };
  }
}

/**
 * The input schema of a tool row: its own fields plus the guard fields of its
 * class. A row must be built through this so a write tool cannot ship without
 * them; the registry spec fails on one that was not.
 */
export function toolInputSchema<Shape extends z.ZodRawShape>(toolClass: ToolClass, shape: Shape) {
  for (const field of GUARD_FIELDS) {
    if (field in shape) throw new Error(`Tool input must not declare the guard field ${field}`);
  }
  return z.object({ ...shape, ...guardShapeFor(toolClass) });
}

/** What the guard fields look like once split from the tool's own arguments. */
type SplitArgs = {
  args: Record<string, unknown>;
  dryRun: boolean;
  confirmToken: string | undefined;
  confirmGuildName: string | undefined;
};

export function splitGuardFields(input: Record<string, unknown>): SplitArgs {
  const { dryRun, confirmToken, confirmGuildName, ...args } = input;
  return {
    args,
    dryRun: dryRun === true,
    confirmToken: typeof confirmToken === 'string' ? confirmToken : undefined,
    confirmGuildName: typeof confirmGuildName === 'string' ? confirmGuildName : undefined,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Hash of the arguments a confirmation is bound to: the guard fields are not part of what was previewed. */
export function argsFingerprint(args: Record<string, unknown>): string {
  return createHash('sha256')
    .update(canonicalJson(splitGuardFields(args).args))
    .digest('hex');
}
