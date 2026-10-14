import { describe, expect, it } from 'vitest';
import { listWebSources } from './web-sources';

/**
 * AntD's static `message`, `notification` and `Modal.confirm` render outside
 * `<ConfigProvider>`: a white box on the dark theme, no theme, no translation.
 * Everything goes through `App.useApp()`.
 */
const STATIC_IMPORT = /import\s*\{[^}]*\b(message|notification)\b[^}]*\}\s*from\s*'antd'/;
const STATIC_MODAL = /\bModal\.(confirm|info|success|error|warning)\s*\(/;

/** The offence found in `source`, if any (the `message` and `notification` that `App.useApp()` returns are not imports). */
export function staticAntdUse(source: string): string | undefined {
  return STATIC_IMPORT.exec(source)?.[0] ?? STATIC_MODAL.exec(source)?.[0];
}

describe('no static AntD feedback API', () => {
  it('is used nowhere in product code', () => {
    const offenders = listWebSources(['app', 'components', 'lib']).flatMap(({ rel, source }) => {
      const hit = staticAntdUse(source);
      return hit === undefined ? [] : [`${rel} -> ${hit}`];
    });
    expect(offenders).toEqual([]);
  });

  it('detects the static forms and accepts the context ones', () => {
    expect(staticAntdUse("import { message } from 'antd';")).toBeDefined();
    expect(staticAntdUse('Modal.confirm({ title })')).toBeDefined();
    expect(staticAntdUse("import { Button, notification } from 'antd';")).toBeDefined();
    expect(
      staticAntdUse('const { message } = App.useApp();\nvoid message.error(text);'),
    ).toBeUndefined();
    expect(
      staticAntdUse('const { modal } = App.useApp();\nmodal.confirm({ title });'),
    ).toBeUndefined();
  });
});
