import { theme as antdTheme, type ThemeConfig } from 'antd';

/**
 * AntD's tokens, kept numerically equal to `styles/tokens.css` (see the table
 * at its top; `tokens.test.ts` compares both). Plain data with no React so a
 * test can read it without a DOM.
 */
export const lightTokens = {
  colorPrimary: '#0b7d70',
  colorLink: '#0a786c',
  // Darker than the link so hover never drops below AA.
  colorLinkHover: '#0a7065',
  fontFamily: 'var(--font-be-vietnam-pro), system-ui, sans-serif',
  borderRadius: 8,
  fontSize: 14,
  controlHeight: 32,
  controlHeightSM: 24,
  colorBgBase: '#ffffff',
  colorBgLayout: '#f6f7f7',
  colorTextBase: '#19211e',
} satisfies ThemeConfig['token'];

export const darkTokens = {
  ...lightTokens,
  colorPrimary: '#0c8275',
  colorLink: '#2dd4bf',
  colorLinkHover: '#28c6b4',
  colorBgBase: '#141c1a',
  colorBgLayout: '#0d1413',
  colorTextBase: '#e9efed',
} satisfies ThemeConfig['token'];

/** Layout colours come from each theme's own tokens, never copied across themes. */
function layoutFor(token: typeof lightTokens) {
  return {
    bodyBg: token.colorBgLayout,
    headerBg: token.colorBgBase,
    lightSiderBg: token.colorBgBase,
    headerPadding: '0 16px',
  };
}

export const lightTheme: ThemeConfig = {
  token: lightTokens,
  components: { Layout: layoutFor(lightTokens) },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: darkTokens,
  components: { Layout: layoutFor(darkTokens) },
};
