export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_MODE_COOKIE = 'theme-mode';
/** The last resolved theme, written by the client so the server can render it without a flash. */
export const THEME_RESOLVED_COOKIE = 'theme';
export const THEME_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function parseThemeMode(value: string | undefined): ThemeMode {
  return THEME_MODES.find((mode) => mode === value) ?? 'system';
}

export function parseResolvedTheme(value: string | undefined): ResolvedTheme {
  return value === 'dark' ? 'dark' : 'light';
}
