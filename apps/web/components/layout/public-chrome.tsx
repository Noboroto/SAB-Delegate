'use client';

import { LangSwitcher } from '@/components/lang-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { ActionRow } from '@/components/ui/action-row';

/**
 * Language and theme switchers for pages outside the signed-in frame (login,
 * sign-in error). A bar in the page flow, not pinned over it: on a short
 * viewport the centred login card would otherwise slide under the switchers.
 */
export function PublicChrome() {
  return (
    <div style={{ padding: 'var(--space-4) var(--page-px) 0' }}>
      <ActionRow align="end">
        <LangSwitcher />
        <ThemeSwitcher />
      </ActionRow>
    </div>
  );
}
