import { describe, expect, it } from 'vitest';
import type { GuildSettings } from '@sab/shared';
import { diffSettings, toFormValues } from './settings-diff';

const CHANNEL = '3'.repeat(18);
const OTHER = '4'.repeat(18);

const stored: GuildSettings = {
  introChannelId: CHANNEL,
  logChannelId: null,
  birthdayChannelId: null,
  activityCategoryId: null,
  wordChannelId: null,
  wordMaxWords: 1500,
  locale: 'vi',
};

describe('diffSettings', () => {
  it('is empty when nothing changed', () => {
    expect(diffSettings(stored, toFormValues(stored))).toEqual({});
  });

  it('carries only the fields that changed', () => {
    const patch = diffSettings(stored, {
      ...toFormValues(stored),
      locale: 'en',
      logChannelId: OTHER,
    });
    expect(patch).toEqual({ locale: 'en', logChannelId: OTHER });
  });

  it('turns a cleared channel into null, not a missing key', () => {
    expect(diffSettings(stored, { ...toFormValues(stored), introChannelId: undefined })).toEqual({
      introChannelId: null,
    });
  });

  it('does not report an untouched empty channel as a change', () => {
    expect(diffSettings(stored, { ...toFormValues(stored), logChannelId: undefined })).toEqual({});
  });

  it('ignores an emptied word limit instead of sending it', () => {
    expect(diffSettings(stored, { ...toFormValues(stored), wordMaxWords: null })).toEqual({});
  });

  it('sends a changed word limit', () => {
    expect(diffSettings(stored, { ...toFormValues(stored), wordMaxWords: 300 })).toEqual({
      wordMaxWords: 300,
    });
  });
});
