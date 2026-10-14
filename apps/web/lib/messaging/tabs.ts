export const MESSAGING_TABS = ['send', 'copy', 'react', 'poll', 'edit'] as const;

export type MessagingTab = (typeof MESSAGING_TABS)[number];

/** The tab named by `?tab=`; anything else opens the first one. */
export function parseMessagingTab(value: string | string[] | undefined): MessagingTab {
  const first = Array.isArray(value) ? value[0] : value;
  return MESSAGING_TABS.find((tab) => tab === first) ?? 'send';
}
