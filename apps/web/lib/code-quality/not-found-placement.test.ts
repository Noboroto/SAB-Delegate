import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = join(import.meta.dirname, '..', '..', 'app');

/** Every `layout.tsx` under `app/` that raises `notFound()` itself. */
function layoutsRaisingNotFound(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return layoutsRaisingNotFound(full);
    return entry.name === 'layout.tsx' && /\bnotFound\(\)/.test(readFileSync(full, 'utf8'))
      ? [full]
      : [];
  });
}

/** The first `not-found.tsx` above the segment of `layout`: the only one Next uses for it. */
function boundaryAbove(layout: string): string | undefined {
  let dir = dirname(dirname(layout));
  while (dir.startsWith(APP_DIR)) {
    const candidate = join(dir, 'not-found.tsx');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return undefined;
}

/**
 * A layout's own `notFound()` is not caught by a `not-found.tsx` beside it, only
 * by one in a parent segment. Next then falls through silently to the root one,
 * which is the wrong screen (and no error says so).
 */
describe('a layout that raises notFound() has its own boundary in a parent segment', () => {
  const layouts = layoutsRaisingNotFound(APP_DIR);

  it('finds the layouts that do', () => {
    expect(layouts.length).toBeGreaterThan(0);
  });

  it.each(layouts.map((layout) => [relative(APP_DIR, layout), layout] as const))(
    '%s',
    (_name, layout) => {
      const boundary = boundaryAbove(layout);
      expect(boundary, 'no not-found.tsx above this layout').toBeDefined();
      // The root `app/not-found.tsx` is the generic page; the layout wants its own screen.
      expect(dirname(boundary ?? '')).not.toBe(APP_DIR);
    },
  );
});
