export const EMAIL_VERIFY_TABS = [
  'overview',
  'settings',
  'rules',
  'blocklist',
  'lists',
  'members',
  'button',
  'smtp',
] as const;

export type EmailVerifyTab = (typeof EMAIL_VERIFY_TABS)[number];

/** The tab named by `?tab=`; anything else opens the overview. */
export function parseEmailVerifyTab(value: string | string[] | undefined): EmailVerifyTab {
  const first = Array.isArray(value) ? value[0] : value;
  return EMAIL_VERIFY_TABS.find((tab) => tab === first) ?? 'overview';
}
