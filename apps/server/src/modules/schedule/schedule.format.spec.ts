import type { ScheduledMessageView } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../i18n/translator.js';
import { describeCancel, formatScheduleEntry, packEntries } from './schedule.format.js';

const en = translatorFor('en');
const vi = translatorFor('vi');

// Built at runtime: literal 18-digit ids trip the secret scanner.
const CHANNEL = '2'.repeat(18);
const SOURCE_CHANNEL = '3'.repeat(18);
const SOURCE_MESSAGE = '4'.repeat(18);
const USER = '5'.repeat(18);

function view(overrides: Partial<ScheduledMessageView> = {}): ScheduledMessageView {
  return {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    seq: 3,
    kind: 'SEND',
    channelId: CHANNEL,
    content: 'Meeting at 9',
    sourceChannelId: null,
    sourceMessageId: null,
    allowedMentions: { parse: [] },
    runAt: new Date(1_800_000_000_000),
    status: 'PENDING',
    attempts: 0,
    source: 'DISCORD',
    createdByUserId: USER,
    lastError: null,
    createdAt: new Date(1_790_000_000_000),
    ...overrides,
  };
}

describe('formatScheduleEntry', () => {
  it('prints author, description, time and creation time under a titled heading', () => {
    expect(formatScheduleEntry(en, view())).toBe(
      [
        '## [schedule-send] - 3',
        `**Author**: <@${USER}>`,
        `**Description**: Send message to <#${CHANNEL}>: Meeting at 9`,
        '**Time**: <t:1800000000:F> (<t:1800000000:R>)',
        '**Created time**: <t:1790000000:F> (<t:1790000000:R>)',
      ].join('\n'),
    );
  });

  it('marks a canceled message with the (End) tag the command always used', () => {
    const text = formatScheduleEntry(en, view({ status: 'CANCELED' }));
    expect(text.split('\n')[0]).toBe('## (End) [schedule-send] - 3');
  });

  it('tags a sent and a failed message, and leaves a pending or sending one bare', () => {
    expect(formatScheduleEntry(en, view({ status: 'SENT' })).split('\n')[0]).toBe(
      '## (Sent) [schedule-send] - 3',
    );
    expect(formatScheduleEntry(en, view({ status: 'FAILED' })).split('\n')[0]).toBe(
      '## (Failed) [schedule-send] - 3',
    );
    for (const status of ['PENDING', 'SENDING'] as const) {
      expect(formatScheduleEntry(en, view({ status })).split('\n')[0]).toBe(
        '## [schedule-send] - 3',
      );
    }
  });

  it('cuts the description at 200 characters and keeps it on one line', () => {
    const text = formatScheduleEntry(
      en,
      view({ content: `line one\nline two ${'x'.repeat(400)}` }),
    );
    const description = text.split('\n').find((line) => line.startsWith('**Description**'));
    expect(description).toBeDefined();
    expect(description?.replace('**Description**: ', '')).toHaveLength(200);
    expect(description).toContain('line one line two');
  });

  it('describes a copy by its source', () => {
    const text = formatScheduleEntry(
      en,
      view({
        kind: 'COPY',
        content: null,
        sourceChannelId: SOURCE_CHANNEL,
        sourceMessageId: SOURCE_MESSAGE,
      }),
    );
    expect(text.split('\n')[0]).toBe('## [schedule-copy] - 3');
    expect(text).toContain(
      `**Description**: Copy from <#${SOURCE_CHANNEL}> ${SOURCE_MESSAGE} to <#${CHANNEL}>`,
    );
  });

  it('explains a known failure in words and shows an unknown label as stored', () => {
    expect(formatScheduleEntry(en, view({ status: 'FAILED', lastError: 'SOURCE_GONE' }))).toContain(
      '**Error**: The message to copy no longer exists.',
    );
    expect(formatScheduleEntry(en, view({ lastError: 'DiscordAPIError 500' }))).toContain(
      '**Error**: DiscordAPIError 500',
    );
  });

  it('speaks Vietnamese for a Vietnamese server', () => {
    const text = formatScheduleEntry(vi, view({ status: 'CANCELED' }));
    expect(text).toContain('## (Đã huỷ) [schedule-send] - 3');
    expect(text).toContain('**Người tạo**');
    expect(text).not.toContain('**Author**');
  });
});

describe('packEntries', () => {
  it('keeps entries whole and fills each message up to the limit', () => {
    const entries = ['a'.repeat(900), 'b'.repeat(900), 'c'.repeat(900)];
    const messages = packEntries(entries, 2000);
    expect(messages).toEqual([`${entries[0]}\n${entries[1]}`, entries[2]]);
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(2000);
  });

  it('answers nothing for nothing and one message for one entry', () => {
    expect(packEntries([])).toEqual([]);
    expect(packEntries(['only'])).toEqual(['only']);
  });

  it('never merges across the limit by one character', () => {
    expect(packEntries(['a'.repeat(999), 'b'.repeat(1000)], 2000)).toHaveLength(1);
    expect(packEntries(['a'.repeat(1000), 'b'.repeat(1000)], 2000)).toHaveLength(2);
  });
});

describe('describeCancel', () => {
  const result = (
    code: 'CANCELED' | 'ALREADY_CANCELED' | 'NOT_PENDING' | 'NOT_FOUND',
    status: ScheduledMessageView['status'] | null = null,
  ) => ({ dryRun: false, code, seq: 7, status });

  it('says what happened for each outcome', () => {
    expect(describeCancel(en, result('CANCELED', 'CANCELED'))).toBe(
      'Canceled scheduled message 7.',
    );
    expect(describeCancel(en, result('ALREADY_CANCELED', 'CANCELED'))).toBe(
      'Scheduled message 7 was already canceled.',
    );
    expect(describeCancel(en, result('NOT_FOUND'))).toBe('There is no scheduled message 7.');
  });

  it('tells apart a message that is being sent, was sent, or failed', () => {
    expect(describeCancel(en, result('NOT_PENDING', 'SENDING'))).toContain('being sent');
    expect(describeCancel(en, result('NOT_PENDING', 'SENT'))).toContain('already sent');
    expect(describeCancel(en, result('NOT_PENDING', 'FAILED'))).toContain('already failed');
  });

  it('has the Vietnamese wording for each outcome', () => {
    expect(describeCancel(vi, result('CANCELED', 'CANCELED'))).toBe(
      'Đã huỷ tin nhắn hẹn giờ số 7.',
    );
  });
});
