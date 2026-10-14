import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api/api-response';
import { GENERAL, GUILD, MESSAGE_LINK } from './api-stub';
import {
  buildCopy,
  buildEdit,
  buildPoll,
  buildReact,
  buildSend,
  readMessageRef,
  refProblem,
  requireBuilt,
} from './requests';

const MESSAGE = '7'.repeat(18);

describe('readMessageRef', () => {
  it('reads a Discord message link and a channel/message pair', () => {
    const expected = { ok: true, target: { channelId: GENERAL, messageId: MESSAGE } };
    expect(readMessageRef(MESSAGE_LINK)).toEqual(expected);
    expect(readMessageRef(`${GENERAL}/${MESSAGE}`)).toEqual(expected);
  });

  it('refuses a bare message id, which names no channel', () => {
    expect(readMessageRef(MESSAGE)).toEqual({ ok: false, reason: 'CHANNEL_REQUIRED' });
  });

  it('says nothing about an empty field and names the problem of a typed one', () => {
    expect(refProblem('  ')).toBeUndefined();
    expect(refProblem(undefined)).toBeUndefined();
    expect(refProblem('hello')).toBe('MALFORMED');
    expect(refProblem(MESSAGE_LINK)).toBeUndefined();
  });
});

describe('buildSend', () => {
  it('builds the request, with the reply target when one is given', () => {
    expect(buildSend({ channelId: GENERAL, content: 'hi' })).toEqual({
      ok: true,
      value: { channelId: GENERAL, content: 'hi' },
    });
    expect(buildSend({ channelId: GENERAL, content: 'hi', replyTo: MESSAGE_LINK })).toMatchObject({
      ok: true,
      value: { replyTo: { channelId: GENERAL, messageId: MESSAGE } },
    });
  });

  it('is not ready without a channel, with blank text or with a reply link that is wrong', () => {
    expect(buildSend({ content: 'hi' }).ok).toBe(false);
    expect(buildSend({ channelId: GENERAL, content: '   ' }).ok).toBe(false);
    expect(buildSend({ channelId: GENERAL, content: 'x'.repeat(2001) }).ok).toBe(false);
    expect(buildSend({ channelId: GENERAL, content: 'hi', replyTo: 'nope' }).ok).toBe(false);
  });
});

describe('the other builders', () => {
  it('copy needs a source link and a channel', () => {
    expect(buildCopy({ source: MESSAGE_LINK, channelId: GUILD }).ok).toBe(true);
    expect(buildCopy({ source: MESSAGE_LINK }).ok).toBe(false);
    expect(buildCopy({ channelId: GUILD }).ok).toBe(false);
  });

  it('react defaults to no poll choices and refuses more than ten', () => {
    expect(buildReact({ target: MESSAGE_LINK, emoji: '👍' })).toMatchObject({
      ok: true,
      value: { pollChoices: 0 },
    });
    expect(buildReact({ target: MESSAGE_LINK, emoji: '👍', pollChoices: 11 }).ok).toBe(false);
    expect(buildReact({ target: MESSAGE_LINK, emoji: ' ' }).ok).toBe(false);
  });

  it('poll takes a channel for a new message and a link for an existing one', () => {
    expect(buildPoll({ mode: 'new', channelId: GENERAL, choices: 3 })).toEqual({
      ok: true,
      value: { channelId: GENERAL, choices: 3 },
    });
    expect(buildPoll({ mode: 'new', choices: 3 }).ok).toBe(false);
    expect(buildPoll({ mode: 'existing', message: MESSAGE_LINK, choices: 3 })).toEqual({
      ok: true,
      value: { channelId: GENERAL, messageId: MESSAGE, choices: 3 },
    });
    expect(buildPoll({ mode: 'existing', choices: 3 }).ok).toBe(false);
    expect(buildPoll({ mode: 'new', channelId: GENERAL, choices: 0 }).ok).toBe(false);
  });

  it('edit needs the message and non-blank text', () => {
    expect(buildEdit({ message: MESSAGE_LINK, content: 'new' })).toEqual({
      ok: true,
      value: { target: { channelId: GENERAL, messageId: MESSAGE }, content: 'new' },
    });
    expect(buildEdit({ message: MESSAGE_LINK, content: ' ' }).ok).toBe(false);
    expect(buildEdit({ content: 'new' }).ok).toBe(false);
  });
});

describe('requireBuilt', () => {
  it('fails like the server validation when the form was not ready', () => {
    expect(() => requireBuilt({ ok: false })).toThrow(ApiRequestError);
    expect(requireBuilt({ ok: true, value: 5 })).toBe(5);
  });
});
