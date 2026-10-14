import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { darkTokens, lightTokens } from '@/components/ui/theme-config';

const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

/** The declarations inside the first `{...}` that follows `selector`. */
function block(selector: string): string {
  // Anchored to a line start: the header comment names the dark selector too.
  const found = new RegExp(`^${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{`, 'm').exec(css);
  expect(found, `selector ${selector} not found`).not.toBeNull();
  const open = (found?.index ?? 0) + (found?.[0].length ?? 1) - 1;
  return css.slice(open + 1, css.indexOf('}', open));
}

const light = block(':root');
const dark = block("[data-theme='dark']");

function valueOf(scope: string, token: string): string {
  const match = new RegExp(`${token}:\\s*([^;]+);`).exec(scope);
  expect(match, `${token} is not declared`).not.toBeNull();
  return (match?.[1] ?? '').trim();
}

const SEMANTIC = ['green', 'red', 'amber', 'blue', 'gray'];
const THEMED = [
  '--bg',
  '--surface',
  '--surface-secondary',
  '--surface-hover',
  '--surface-selected',
  '--border',
  '--border-strong',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--primary',
  '--primary-hover',
  '--primary-fg',
  '--primary-tint',
  '--link',
  '--focus',
  '--shadow',
  '--overlay',
  ...SEMANTIC.flatMap((color) => [`--${color}-bg`, `--${color}-fg`]),
];

describe('tokens.css', () => {
  it.each(THEMED)('defines %s for light and overrides it for dark', (token) => {
    expect(light).toContain(`${token}:`);
    expect(dark).toContain(`${token}:`);
  });

  it('keeps layout tokens theme-independent, and --danger an alias that follows the theme', () => {
    for (const token of ['--page-px', '--measure', '--control-h', '--control-h-sm']) {
      expect(light, token).toContain(`${token}:`);
      expect(dark, token).not.toContain(`${token}:`);
    }
    expect(valueOf(light, '--danger')).toBe('var(--red-fg)');
    expect(dark).not.toContain('--danger:');
  });

  it('sizes the reading measure in ch so it holds ~65 characters when zoomed', () => {
    expect(valueOf(light, '--measure')).toMatch(/^\d+ch$/);
  });
});

describe('touch screens', () => {
  const globals = readFileSync(join(import.meta.dirname, '..', 'app', 'globals.css'), 'utf8');

  it('grows the control height to 44px for a coarse pointer, and only there', () => {
    const coarse = /@media \(pointer: coarse\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css);
    expect(coarse, 'coarse-pointer block not found').not.toBeNull();
    expect(valueOf(coarse?.[1] ?? '', '--control-h')).toBe('44px');
    expect(valueOf(coarse?.[1] ?? '', '--control-h-sm')).toBe('44px');
    expect(valueOf(light, '--control-h')).toBe('32px');
  });

  it('keeps fields at 16px so iOS does not zoom, and sizes AntD controls from --control-h', () => {
    const coarse = /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}\n/.exec(globals);
    expect(coarse, 'coarse-pointer block not found').not.toBeNull();
    expect(coarse?.[1]).toMatch(/font-size:\s*16px/);
    expect(coarse?.[1]).toContain('min-height: var(--control-h)');
  });
});

describe('tokens.css and the AntD theme agree', () => {
  it('uses one control height in CSS and in AntD, so mixed rows line up', () => {
    expect(valueOf(light, '--control-h')).toBe(`${lightTokens.controlHeight}px`);
    expect(valueOf(light, '--control-h-sm')).toBe(`${lightTokens.controlHeightSM}px`);
    expect(darkTokens.controlHeight).toBe(lightTokens.controlHeight);
    expect(darkTokens.controlHeightSM).toBe(lightTokens.controlHeightSM);
  });

  it.each([
    ['light', light, lightTokens],
    ['dark', dark, darkTokens],
  ] as const)('maps colours one to one in %s', (_name, scope, tokens) => {
    expect(valueOf(scope, '--primary')).toBe(tokens.colorPrimary);
    expect(valueOf(scope, '--link')).toBe(tokens.colorLink);
    expect(valueOf(scope, '--surface')).toBe(tokens.colorBgBase);
    expect(valueOf(scope, '--bg')).toBe(tokens.colorBgLayout);
    expect(valueOf(scope, '--text-primary')).toBe(tokens.colorTextBase);
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('tokens.css text meets WCAG AA (4.5:1)', () => {
  const PAIRS: ReadonlyArray<readonly [string, string]> = [
    ...SEMANTIC.map((color) => [`--${color}-fg`, `--${color}-bg`] as const),
    ['--text-primary', '--bg'],
    ['--text-primary', '--surface'],
    ['--text-secondary', '--surface'],
    ['--text-muted', '--surface'],
    ['--link', '--surface'],
    ['--primary-fg', '--primary'],
  ];

  for (const [theme, scope, base] of [
    ['light', light, light],
    ['dark', dark, light],
  ] as const) {
    it.each(PAIRS)(`${theme}: %s on %s`, (fg, bg) => {
      // A token the dark block does not override keeps its light value.
      const read = (token: string) =>
        scope.includes(`${token}:`) ? valueOf(scope, token) : valueOf(base, token);
      const ratio = contrast(read(fg), read(bg));
      expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
