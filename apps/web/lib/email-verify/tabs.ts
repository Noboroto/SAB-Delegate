export const EMAIL_VERIFY_TABS = [
  'overview',
  'settings',
  'rules',
  'lists',
  'members',
  'smtp',
] as const;

export type EmailVerifyTab = (typeof EMAIL_VERIFY_TABS)[number];

/** Tabs that were folded into another one; links and bookmarks to them still land on the right content. */
const LEGACY_TABS: Readonly<Record<string, EmailVerifyTab>> = {
  blocklist: 'rules',
  button: 'settings',
};

/** The tab named by `?tab=`; a retired tab name maps to the tab that holds it now, anything else opens the overview. */
export function parseEmailVerifyTab(value: string | string[] | undefined): EmailVerifyTab {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return 'overview';
  return (
    EMAIL_VERIFY_TABS.find((tab) => tab === first) ??
    (Object.hasOwn(LEGACY_TABS, first) ? LEGACY_TABS[first] : undefined) ??
    'overview'
  );
}
