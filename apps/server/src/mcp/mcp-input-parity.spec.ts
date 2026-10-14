import { z } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import type { AnyToolRow } from './tool-definition.js';
import { TOOL_REGISTRY } from './tool-registry.js';
import { toolInputSchema } from './write-guard.js';

/**
 * Fields of the REST (or slash) schema a row mirrors that its input does not
 * carry, and the exceptions that excuse them. Returns the problems.
 */
function parityProblems(row: AnyToolRow): string[] {
  if (row.parity === undefined) return [];
  const { rest, exceptions = {} } = row.parity;
  const restFields = Object.keys(rest.shape);
  const toolFields = Object.keys(row.inputSchema.shape);
  const problems: string[] = [];
  for (const field of restFields) {
    if (!toolFields.includes(field) && !(field in exceptions)) {
      problems.push(`${row.name}: REST field ${field} is not a tool input and has no excuse`);
    }
  }
  for (const [field, reason] of Object.entries(exceptions)) {
    if (!restFields.includes(field))
      problems.push(`${row.name}: excuse for ${field}, which REST does not have`);
    if (toolFields.includes(field))
      problems.push(`${row.name}: ${field} is excused but is a tool input`);
    if (reason.trim().length < 10)
      problems.push(`${row.name}: the excuse for ${field} gives no reason`);
  }
  return problems;
}

const rest = z.object({ channelId: z.string(), maxWords: z.number(), note: z.string().optional() });
const toolRow = (shape: z.ZodRawShape, exceptions?: Record<string, string>): AnyToolRow =>
  ({
    name: 'fixture_set',
    class: 'W',
    inputSchema: toolInputSchema('W', shape),
    parity: { rest, ...(exceptions && { exceptions }) },
  }) as unknown as AnyToolRow;

describe('tool input parity with the REST schemas', () => {
  it('has every registry tool take every field of the schema it mirrors', () => {
    expect(TOOL_REGISTRY.flatMap(parityProblems)).toEqual([]);
  });

  it('accepts a tool that carries every field, or excuses the missing one with a reason', () => {
    const all = { channelId: z.string(), maxWords: z.number(), note: z.string() };
    expect(parityProblems(toolRow(all))).toEqual([]);
    const { note: _note, ...fewer } = all;
    expect(
      parityProblems(toolRow(fewer, { note: 'free text is never taken from an agent' })),
    ).toEqual([]);
  });

  it('fails a missing field, a stale excuse, a needless excuse and an excuse without a reason', () => {
    const missing = parityProblems(toolRow({ channelId: z.string(), maxWords: z.number() }));
    expect(missing).toEqual(['fixture_set: REST field note is not a tool input and has no excuse']);

    const stale = parityProblems(
      toolRow(
        { channelId: z.string(), maxWords: z.number(), note: z.string() },
        { gone: 'was removed from REST long ago' },
      ),
    );
    expect(stale.join()).toContain('REST does not have');

    const needless = parityProblems(
      toolRow(
        { channelId: z.string(), maxWords: z.number(), note: z.string() },
        { note: 'not really needed here' },
      ),
    );
    expect(needless.join()).toContain('is excused but is a tool input');

    const bare = parityProblems(
      toolRow({ channelId: z.string(), maxWords: z.number() }, { note: 'no' }),
    );
    expect(bare.join()).toContain('gives no reason');
  });
});
