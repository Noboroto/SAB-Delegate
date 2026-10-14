import { ErrorCode } from '@sab/shared';
import { ServiceError } from '../common/errors/service-error.js';
import type { McpCaller } from './mcp-caller.js';

/**
 * R reads; W changes data that can be put back (needs a WRITE key, supports
 * `dryRun`); C changes data or posts publicly and needs a one-use
 * `confirmToken`; CC is bulk or irreversible and also needs the server's name
 * typed back.
 */
export type ToolClass = 'R' | 'W' | 'C' | 'CC';

export const isWriteClass = (toolClass: ToolClass): boolean => toolClass !== 'R';

/**
 * One declaration for both questions a tool has to answer: whether this caller
 * is shown it (`visible`) and whether the call may proceed (`require`). `visible`
 * is only what the caller sees; `require()` stays mandatory in every handler, so
 * a READ key that names a write tool directly is still refused.
 */
export function toolGuard(caller: McpCaller, toolClass: ToolClass) {
  const allowed = !isWriteClass(toolClass) || caller.mode === 'WRITE';
  return {
    visible: allowed,
    require: (): void => {
      if (!allowed) throw new ServiceError(ErrorCode.AUTH_API_KEY_READ_ONLY);
    },
  };
}

/** `readOnlyHint` on every tool, `destructiveHint` on the writes: false for W, true for C and CC. */
export function annotationsFor(toolClass: ToolClass) {
  return toolClass === 'R'
    ? { readOnlyHint: true }
    : { readOnlyHint: false, destructiveHint: toolClass !== 'W' };
}
