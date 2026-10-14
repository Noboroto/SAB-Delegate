import { describe, expect, it } from 'vitest';
import { isClientModule, listWebSources } from './web-sources';

/**
 * A module that reaches a compound member of an `antd` import (`Skeleton.Input`,
 * `Typography.Title`, `Radio.Group`) must be a client module. From a server
 * module `antd` resolves to a client reference that exposes only named exports,
 * so the member reads back `undefined` and React throws "Element type is
 * invalid". The response still answers 200 and a DOM test still passes, so
 * nothing else notices.
 */
function antdImportNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/import\s+([^;]+?)\s+from\s+'antd'/g)) {
    const clause = match[1] ?? '';
    if (clause.startsWith('type ')) continue;
    for (const part of (/\{([^}]*)\}/.exec(clause)?.[1] ?? clause).split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name !== undefined && /^[A-Z]\w*$/.test(name)) names.push(name);
    }
  }
  return names;
}

/** `hit` for a source that uses a compound member of one of its antd imports. */
export function compoundMemberUse(source: string): string | undefined {
  for (const name of antdImportNames(source)) {
    const hit = new RegExp(`\\b${name}\\.[A-Z]\\w*`).exec(source);
    if (hit !== null) return hit[0];
  }
  return undefined;
}

describe('antd compound members require a client module', () => {
  it('finds no server module that reaches one', () => {
    const offenders = listWebSources(['app', 'components', 'lib'])
      .filter(({ rel, source }) => rel.endsWith('.tsx') && !isClientModule(source))
      .flatMap(({ rel, source }) => {
        const hit = compoundMemberUse(source);
        return hit === undefined ? [] : [`${rel} -> ${hit}`];
      });
    expect(offenders).toEqual([]);
  });

  it('detects the pattern it hunts for', () => {
    expect(compoundMemberUse("import { Skeleton } from 'antd';\n<Skeleton.Input />")).toBe(
      'Skeleton.Input',
    );
    expect(compoundMemberUse("import { Button } from 'antd';\n<Button />")).toBeUndefined();
    expect(
      compoundMemberUse("import type { Skeleton } from 'antd';\nSkeleton.Input"),
    ).toBeUndefined();
  });
});
