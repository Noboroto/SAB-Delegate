export const THREADS_TABS = ['create', 'private', 'reactors', 'rename', 'delete'] as const;

export type ThreadsTab = (typeof THREADS_TABS)[number];

/** The tab named by `?tab=`; anything else opens the first one. */
export function parseThreadsTab(value: string | string[] | undefined): ThreadsTab {
  const first = Array.isArray(value) ? value[0] : value;
  return THREADS_TABS.find((tab) => tab === first) ?? 'create';
}
