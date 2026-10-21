import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../audit-actions.js';
import { MESSAGES } from './index.js';

// The audit log names each row by `actions.<key>`; a key with no label shows a
// raw message id and logs MISSING_MESSAGE (seen for every chatbot action).
describe('audit action labels', () => {
  it.each(['vi', 'en'] as const)('labels every audit action in %s', (locale) => {
    const labels = MESSAGES[locale]['web-audit-log'].actions as Record<string, unknown>;
    const missing = Object.keys(AUDIT_ACTIONS).filter((key) => typeof labels[key] !== 'string');
    expect(missing).toEqual([]);
  });
});
