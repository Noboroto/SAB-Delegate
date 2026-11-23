export const BIRTHDAY_TABS = ['list', 'wishes'] as const;

export type BirthdayTab = (typeof BIRTHDAY_TABS)[number];

/** The tab named by `?tab=`; anything else opens the birthday list. */
export function parseBirthdayTab(value: string | string[] | undefined): BirthdayTab {
  const first = Array.isArray(value) ? value[0] : value;
  return BIRTHDAY_TABS.find((tab) => tab === first) ?? 'list';
}
