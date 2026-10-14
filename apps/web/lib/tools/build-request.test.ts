import { describe, expect, it } from 'vitest';
import { PurgeRequestSchema } from '@sab/shared';
import { blankToUndefined, buildRequest, readMessageRef } from './build-request';

const CHANNEL = '2'.repeat(18);
const MESSAGE = '7'.repeat(18);

describe('buildRequest', () => {
  it('returns the request the shared schema accepts, defaults applied', () => {
    const request = buildRequest(PurgeRequestSchema, {
      mode: 'last',
      channelId: CHANNEL,
      count: 5,
      dryRun: true,
      confirm: false,
    });
    expect(request).toMatchObject({ mode: 'last', channelId: CHANNEL, count: 5, dryRun: true });
  });

  it('refuses a request the server would turn away', () => {
    expect(
      buildRequest(PurgeRequestSchema, { mode: 'last', channelId: 'abc', count: 5 }),
    ).toBeUndefined();
    expect(
      buildRequest(PurgeRequestSchema, { mode: 'last', channelId: CHANNEL, count: 5 }),
    ).toBeUndefined();
    expect(
      buildRequest(PurgeRequestSchema, {
        mode: 'last',
        channelId: CHANNEL,
        count: 5000,
        dryRun: true,
        confirm: false,
      }),
    ).toBeUndefined();
  });
});

describe('blankToUndefined', () => {
  it('treats blank text as not given and trims the rest', () => {
    expect(blankToUndefined(undefined)).toBeUndefined();
    expect(blankToUndefined('   ')).toBeUndefined();
    expect(blankToUndefined('  hello ')).toBe('hello');
  });
});

describe('readMessageRef', () => {
  it('reads a copied message link and a channel/message pair', () => {
    expect(
      readMessageRef(`https://discord.com/channels/${'1'.repeat(18)}/${CHANNEL}/${MESSAGE}`),
    ).toEqual({
      channelId: CHANNEL,
      messageId: MESSAGE,
    });
    expect(readMessageRef(`${CHANNEL}/${MESSAGE}`)).toEqual({
      channelId: CHANNEL,
      messageId: MESSAGE,
    });
  });

  it('needs a channel for a bare message id', () => {
    expect(readMessageRef(MESSAGE)).toBeUndefined();
    expect(readMessageRef(MESSAGE, CHANNEL)).toEqual({ channelId: CHANNEL, messageId: MESSAGE });
    expect(readMessageRef(MESSAGE, null)).toBeUndefined();
  });

  it('refuses text that is not a message reference', () => {
    expect(readMessageRef(undefined)).toBeUndefined();
    expect(readMessageRef('hello')).toBeUndefined();
  });
});
