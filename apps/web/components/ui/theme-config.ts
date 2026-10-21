import { theme as antdTheme, type ThemeConfig } from 'antd';

/**
 * The one heading scale: the page title is h1 (24), a section or card title h2
 * (18), a block inside a card h3 (16). `Heading`, `SectionTitle` and AntD's own
 * `Typography.Title` all read these, so a level means one size everywhere. The
 * line heights are set too: AntD derives them from its default sizes, not ours.
 */
const headingScale = {
  fontSizeHeading1: 24,
  fontSizeHeading2: 18,
  fontSizeHeading3: 16,
  fontSizeHeading4: 14,
  fontSizeHeading5: 14,
  lineHeightHeading1: 1.3333,
  lineHeightHeading2: 1.4444,
  lineHeightHeading3: 1.5,
  lineHeightHeading4: 1.5714,
  lineHeightHeading5: 1.5714,
} satisfies ThemeConfig['token'];

/**
 * AntD's tokens, kept numerically equal to `styles/tokens.css` (see the table
 * at its top; `tokens.test.ts` compares both, on the values AntD actually
 * computes). Plain data with no React so a test can read it without a DOM.
 */
export const lightTokens = {
  ...headingScale,
  colorPrimary: '#4b5fab',
  // AntD would lighten the hover to 3.9:1 on white; Tabs and Buttons use it as text.
  colorPrimaryHover: '#3f5097',
  colorLink: '#4357a3',
  // Darker than the link so hover never drops below AA.
  colorLinkHover: '#3d509c',
  fontFamily: 'var(--font-be-vietnam-pro), system-ui, sans-serif',
  borderRadius: 8,
  fontSize: 14,
  controlHeight: 32,
  controlHeightSM: 24,
  colorBgBase: '#ffffff',
  colorBgLayout: '#f5f6fa',
  colorTextBase: '#1a1f36',
} satisfies ThemeConfig['token'];

/**
 * The logo teal as the dark algorithm shades the `colorLink` seed below; every
 * dark text in the primary role uses it (7:1 on the surface, the navy fill 2.4:1).
 */
const DARK_ACCENT_TEXT = '#4babb4';
const DARK_ACCENT_TEXT_HOVER = '#7ad3db';

/*
 * The dark algorithm derives every neutral and the primary shade from these
 * seeds. A navy base comes out saturated blue (borders #334993, cards #1b274f),
 * so the neutrals are pinned to the CSS ones. `colorPrimary` itself is a seed
 * and cannot be pinned: AntD shades it to #435494 (and `colorLink` to #4babb4),
 * which tokens.css copies.
 */
export const darkTokens = {
  ...lightTokens,
  colorPrimary: '#4b5fab',
  // The algorithm's own hover leaves white labels at 4.55:1.
  colorPrimaryHover: '#5568b5',
  colorPrimaryText: DARK_ACCENT_TEXT,
  colorPrimaryTextHover: DARK_ACCENT_TEXT_HOVER,
  colorPrimaryTextActive: DARK_ACCENT_TEXT,
  colorLink: '#55c6d0',
  colorLinkHover: DARK_ACCENT_TEXT_HOVER,
  colorLinkActive: DARK_ACCENT_TEXT,
  colorBgBase: '#161b2b',
  colorBgContainer: '#161b2b',
  colorBgElevated: '#1f2638',
  colorBgSpotlight: '#242b40',
  colorBgLayout: '#0f1320',
  colorBorder: '#39415a',
  colorBorderSecondary: '#2a3147',
  colorSplit: '#2a3147',
  colorTextBase: '#e8eaf3',
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
  components: {
    Layout: layoutFor(darkTokens),
    // Both colour their selected text and ink bar with `colorPrimary` directly.
    Tabs: {
      itemSelectedColor: DARK_ACCENT_TEXT,
      itemActiveColor: DARK_ACCENT_TEXT,
      itemHoverColor: DARK_ACCENT_TEXT_HOVER,
      inkBarColor: DARK_ACCENT_TEXT,
    },
    Menu: {
      itemSelectedColor: DARK_ACCENT_TEXT,
      horizontalItemSelectedColor: DARK_ACCENT_TEXT,
      itemHoverColor: DARK_ACCENT_TEXT_HOVER,
      horizontalItemHoverColor: DARK_ACCENT_TEXT_HOVER,
    },
  },
};
