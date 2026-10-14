import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIRM_TOKEN_TTL_MS,
  CONFIRM_TOKENS_PER_KEY,
  ConfirmTokenService,
} from './confirm-token.service.js';

const KEY = '0190a000-0000-7000-8000-000000000001';
const OTHER_KEY = '0190a000-0000-7000-8000-000000000002';
const ARGS = { guildId: '444444444444444441', id: 7 };

describe('ConfirmTokenService', () => {
  let service: ConfirmTokenService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new ConfirmTokenService();
  });
  afterEach(() => vi.useRealTimers());

  it('accepts the token for the key, tool and arguments it was issued for', () => {
    const { token, expiresInSeconds } = service.issue(KEY, 'note_delete', ARGS);
    expect(expiresInSeconds).toBe(300);
    expect(service.verify(token, KEY, 'note_delete', ARGS)).toBe(true);
  });

  it('is single use', () => {
    const { token } = service.issue(KEY, 'note_delete', ARGS);
    expect(service.verify(token, KEY, 'note_delete', ARGS)).toBe(true);
    expect(service.verify(token, KEY, 'note_delete', ARGS)).toBe(false);
    expect(service.size).toBe(0);
  });

  it.each([
    ['other arguments', KEY, 'note_delete', { ...ARGS, id: 8 }],
    ['another tool', KEY, 'birthday_remove', ARGS],
    ['another key', OTHER_KEY, 'note_delete', ARGS],
  ])('refuses a token used with %s, and spends it', (_label, key, tool, args) => {
    const { token } = service.issue(KEY, 'note_delete', ARGS);
    expect(service.verify(token, key, tool, args)).toBe(false);
    expect(service.verify(token, KEY, 'note_delete', ARGS)).toBe(false);
  });

  it('refuses a token after five minutes, and an unknown one', () => {
    const { token } = service.issue(KEY, 'note_delete', ARGS);
    vi.advanceTimersByTime(CONFIRM_TOKEN_TTL_MS);
    expect(service.verify(token, KEY, 'note_delete', ARGS)).toBe(false);
    expect(service.verify('ct_unknown', KEY, 'note_delete', ARGS)).toBe(false);
  });

  it('binds to the arguments regardless of key order and of the guard fields', () => {
    const { token } = service.issue(KEY, 'note_delete', { id: 7, guildId: ARGS.guildId });
    expect(
      service.verify(token, KEY, 'note_delete', {
        ...ARGS,
        dryRun: false,
        confirmToken: token,
        confirmGuildName: 'x',
      }),
    ).toBe(true);
  });

  it('keeps a bounded number of tokens per key and drops the oldest', () => {
    const first = service.issue(KEY, 'note_delete', ARGS).token;
    for (let n = 0; n < CONFIRM_TOKENS_PER_KEY; n += 1) service.issue(KEY, 'note_delete', { n });
    expect(service.size).toBe(CONFIRM_TOKENS_PER_KEY);
    expect(service.verify(first, KEY, 'note_delete', ARGS)).toBe(false);
    const other = service.issue(OTHER_KEY, 'note_delete', ARGS).token;
    expect(service.size).toBe(CONFIRM_TOKENS_PER_KEY + 1);
    expect(service.verify(other, OTHER_KEY, 'note_delete', ARGS)).toBe(true);
  });

  it('forgets expired tokens when issuing', () => {
    service.issue(KEY, 'note_delete', ARGS);
    vi.advanceTimersByTime(CONFIRM_TOKEN_TTL_MS + 1);
    service.issue(KEY, 'note_delete', { n: 1 });
    expect(service.size).toBe(1);
  });
});
