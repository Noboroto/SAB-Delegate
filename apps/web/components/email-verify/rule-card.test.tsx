import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubApi } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { draftFromRule, resolveDraft, type RuleDraft } from '@/lib/email-verify/rule-draft';
import { RuleCard } from './rule-card';

const GUILD = '1'.repeat(18);
const ROLE = '5'.repeat(18);

const RULE = {
  condition: {
    combinator: 'or' as const,
    rules: [
      { field: 'domain' as const, operator: '=' as const, value: '*.edu' },
      { field: 'list' as const, operator: '=' as const, value: 'k21' },
    ],
  },
  roleIds: [ROLE],
};

let latest: RuleDraft;

function Harness({ showErrors = false }: { showErrors?: boolean }) {
  const [draft, setDraft] = useState(() => draftFromRule(RULE, 1));
  latest = draft;
  return (
    <RuleCard
      guildId={GUILD}
      draft={draft}
      index={1}
      count={2}
      listNames={['k21', 'staff']}
      showErrors={showErrors}
      disabled={false}
      onChange={setDraft}
      onMove={vi.fn()}
      onRemove={vi.fn()}
    />
  );
}

beforeEach(() => {
  stubApi((path) =>
    path.endsWith('/discord/roles') ? [{ id: ROLE, name: 'Student', managed: false }] : [],
  );
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['vi', 'en'] as const)('RuleCard (%s)', (locale) => {
  const TEXT = {
    vi: { toText: 'Sửa dạng văn bản', toBuilder: 'Sửa bằng trình dựng', rule: 'Quy tắc 1' },
    en: { toText: 'Edit as text', toBuilder: 'Edit with the builder', rule: 'Rule 1' },
  }[locale];

  it('shows the condition in the builder, and as text when asked', async () => {
    renderWithProviders(<Harness />, locale);
    expect(screen.getByText(TEXT.rule)).toBeInTheDocument();
    expect(screen.getByDisplayValue('*.edu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: TEXT.toText }));
    const box = await screen.findByRole('textbox');
    expect(box).toHaveValue('domain:*.edu OR list:k21');
    expect(screen.getByRole('button', { name: TEXT.toBuilder })).toBeInTheDocument();
  });

  it('marks a text that cannot be read with where it goes wrong, and keeps the text', async () => {
    renderWithProviders(<Harness />, locale);
    fireEvent.click(screen.getByRole('button', { name: TEXT.toText }));
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'domain:*.edu AND nope:x' } });

    const alert = await screen.findByText(locale === 'vi' ? /vị trí 18/ : /position 18/);
    expect(alert).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');

    // Going back to the builder is refused while the text is broken.
    fireEvent.click(screen.getByRole('button', { name: TEXT.toBuilder }));
    expect(screen.getByRole('textbox')).toHaveValue('domain:*.edu AND nope:x');
    expect(latest.mode).toBe('text');
  });

  it('returns to the builder with the text that was typed', async () => {
    renderWithProviders(<Harness />, locale);
    fireEvent.click(screen.getByRole('button', { name: TEXT.toText }));
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'email:*@hcmus.edu.vn' } });
    fireEvent.click(screen.getByRole('button', { name: TEXT.toBuilder }));

    await waitFor(() => expect(screen.getByDisplayValue('*@hcmus.edu.vn')).toBeInTheDocument());
    expect(latest.mode).toBe('builder');
    const resolved = resolveDraft(latest);
    expect(resolved.ok && resolved.rule.condition).toEqual({
      combinator: 'and',
      rules: [{ field: 'email', operator: '=', value: '*@hcmus.edu.vn' }],
    });
  });
});
