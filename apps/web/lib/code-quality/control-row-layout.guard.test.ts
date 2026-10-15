import { describe, expect, it } from 'vitest';
import { listWebSources } from './web-sources';

/**
 * AntD `Space` wraps every child in its own item, so a hidden file input or an
 * `Upload` still receives a gap and shifts the visible buttons off the left
 * edge they share with the controls below. Rows holding either use `ActionRow`.
 */
const FILE_CONTROL = /type=(["'])file\1|<Upload\b/g;
const CONTAINER_TAG = /<(Space|ActionRow)\b(?!\.)|<\/(Space|ActionRow)>/g;

/** The file control whose innermost `Space`/`ActionRow` container is a `Space`, if any. */
export function fileControlInSpace(source: string): string | undefined {
  for (const control of source.matchAll(FILE_CONTROL)) {
    const stack: string[] = [];
    for (const tag of source.slice(0, control.index).matchAll(CONTAINER_TAG)) {
      if (tag[1] !== undefined) stack.push(tag[1]);
      else stack.pop();
    }
    if (stack.at(-1) === 'Space') return control[0];
  }
  return undefined;
}

describe('file controls stay out of AntD Space', () => {
  it('holds in product code', () => {
    const offenders = listWebSources(['app', 'components']).flatMap(({ rel, source }) => {
      const hit = fileControlInSpace(source);
      return hit === undefined ? [] : [`${rel} -> ${hit}`];
    });
    expect(offenders).toEqual([]);
  });

  it('detects a file input beside a Space and accepts ActionRow', () => {
    expect(fileControlInSpace('<Space wrap><input type="file" /></Space>')).toBeDefined();
    expect(fileControlInSpace('<Space><Upload>x</Upload></Space>')).toBeDefined();
    expect(fileControlInSpace('<ActionRow><input type="file" /></ActionRow>')).toBeUndefined();
    expect(
      fileControlInSpace('<Space><ActionRow><input type="file" /></ActionRow></Space>'),
    ).toBeUndefined();
    expect(
      fileControlInSpace('<Space.Compact><input type="file" /></Space.Compact>'),
    ).toBeUndefined();
  });
});
