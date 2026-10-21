'use client';

import { useSearchParams } from 'next/navigation';

/**
 * The tab named by `?tab=` in the address right now, so the Back button and a
 * pasted link move the tabs too. Without a (known) `tab` it is `fallback`, the
 * tab the server rendered for that address.
 */
export function useUrlTab<T extends string>(tabs: readonly T[], fallback: T): T {
  const requested = useSearchParams().get('tab');
  return tabs.find((tab) => tab === requested) ?? fallback;
}
