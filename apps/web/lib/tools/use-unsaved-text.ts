'use client';

import { useState } from 'react';
import { useUnsavedChanges } from '@/components/forms/unsaved-guard';

/**
 * Guards a long free-text field: the page asks before it is left while the
 * text is filled in and has not been sent. Returns the setter to call with the
 * text that was just sent, so a successful send does not leave the page "dirty".
 */
export function useUnsavedText(text: string | undefined): (sent: string | undefined) => void {
  const [sent, setSent] = useState('');
  const current = text ?? '';
  useUnsavedChanges(current.trim() !== '' && current !== sent);
  return (value) => setSent(value ?? '');
}
