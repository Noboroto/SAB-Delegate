import { describe, expect, it } from 'vitest';
import { hasTurnFilter, parseTurnsQuery, turnsQueryString } from './turns-query';

const USER = '5'.repeat(18);
const CHANNEL = '3'.repeat(18);

describe('parseTurnsQuery', () => {
  it('lists the newest exchanges first, ten to a page, without a filter', () => {
    const query = parseTurnsQuery({});
    expect(query).toMatchObject({ page: 1, pageSize: 10, order: 'desc' });
    expect(hasTurnFilter(query)).toBe(false);
  });

  it('reads every filter from the URL', () => {
    const query = parseTurnsQuery({
      userId: USER,
      channelId: CHANNEL,
      status: 'FAILED',
      from: '2026-10-15T17:00:00.000Z',
      to: '2026-10-16T16:59:59.999Z',
      order: 'asc',
    });
    expect(query).toMatchObject({
      userId: USER,
      channelId: CHANNEL,
      status: 'FAILED',
      order: 'asc',
    });
    expect(hasTurnFilter(query)).toBe(true);
  });

  it('drops only the filter that is wrong and keeps the others', () => {
    const query = parseTurnsQuery({ userId: USER, status: 'NOPE', channelId: 'not-an-id' });
    expect(query.userId).toBe(USER);
    expect(query.status).toBeUndefined();
    expect(query.channelId).toBeUndefined();
  });

  it('drops a start that is after the end', () => {
    const query = parseTurnsQuery({
      from: '2026-10-17T00:00:00.000Z',
      to: '2026-10-16T00:00:00.000Z',
    });
    expect(query.from).toBeUndefined();
    expect(query.to).toBe('2026-10-16T00:00:00.000Z');
  });

  it('treats an empty filter as not set', () => {
    expect(parseTurnsQuery({ userId: '', status: '' })).toMatchObject({ page: 1 });
  });
});

describe('turnsQueryString', () => {
  it('writes only the filters that are set', () => {
    expect(turnsQueryString(parseTurnsQuery({}))).toBe('page=1&pageSize=10&order=desc');
    expect(turnsQueryString(parseTurnsQuery({ userId: USER, status: 'OK', page: '2' }))).toBe(
      `page=2&pageSize=10&order=desc&userId=${USER}&status=OK`,
    );
  });
});
