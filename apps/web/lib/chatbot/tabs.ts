export const CHATBOT_TABS = ['settings', 'usage', 'history'] as const;

export type ChatbotTab = (typeof CHATBOT_TABS)[number];

/** The tab named by `?tab=`; anything else opens the settings. */
export function parseChatbotTab(value: string | string[] | undefined): ChatbotTab {
  const first = Array.isArray(value) ? value[0] : value;
  return CHATBOT_TABS.find((tab) => tab === first) ?? 'settings';
}
