import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { UnsavedGuardProvider, useConfirmLeave, useUnsavedChanges } from './unsaved-guard';

function DirtyForm({ name }: { name: string }) {
  const [dirty, setDirty] = useState(true);
  useUnsavedChanges(dirty);
  return (
    <button type="button" onClick={() => setDirty(false)}>
      {`clean ${name}`}
    </button>
  );
}

function Leave() {
  const confirmLeave = useConfirmLeave();
  return (
    <button
      type="button"
      onClick={() =>
        confirmLeave(() => {
          push('/next');
        })
      }
    >
      leave
    </button>
  );
}

describe('unsaved guard', () => {
  it('keeps blocking while another form on the page is still dirty', async () => {
    push.mockClear();
    renderWithProviders(
      <UnsavedGuardProvider>
        <DirtyForm name="a" />
        <DirtyForm name="b" />
        <Leave />
      </UnsavedGuardProvider>,
      'en',
    );

    fireEvent.click(screen.getByText('clean a'));
    fireEvent.click(screen.getByText('leave'));
    expect(await screen.findAllByText('Leave without saving?')).not.toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('lets the person leave at once when every form is clean', () => {
    push.mockClear();
    renderWithProviders(
      <UnsavedGuardProvider>
        <DirtyForm name="a" />
        <Leave />
      </UnsavedGuardProvider>,
      'en',
    );

    fireEvent.click(screen.getByText('clean a'));
    fireEvent.click(screen.getByText('leave'));
    expect(push).toHaveBeenCalledWith('/next');
  });
});
