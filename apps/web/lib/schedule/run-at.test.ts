import { describe, expect, it } from 'vitest';
import { errorField, resolveRunAt, toRunAtIso } from './run-at';

// Noon in Vietnam on 14 October 2026.
const NOW = new Date('2026-10-14T05:00:00Z');

describe('toRunAtIso', () => {
  it('writes the moment in Vietnam time with the +07:00 offset', () => {
    expect(toRunAtIso(new Date('2026-10-20T02:30:00Z'))).toBe('2026-10-20T09:30:00+07:00');
  });
});

describe('resolveRunAt', () => {
  it('turns a date and a time into the ISO text the API takes', () => {
    const result = resolveRunAt('20/10/2026', '09:30', NOW);
    expect(result).toMatchObject({ ok: true, iso: '2026-10-20T09:30:00+07:00' });
  });

  it('reads an empty date as today', () => {
    expect(resolveRunAt('', '18:00', NOW)).toMatchObject({
      ok: true,
      iso: '2026-10-14T18:00:00+07:00',
    });
  });

  it('reads a span from now', () => {
    expect(resolveRunAt('', '1h', NOW)).toMatchObject({
      ok: true,
      iso: '2026-10-14T13:00:00+07:00',
    });
  });

  it('refuses a day that is not on the calendar', () => {
    expect(resolveRunAt('31/02/2027', '09:00', NOW)).toEqual({
      ok: false,
      error: 'NONEXISTENT_DATE',
    });
    expect(resolveRunAt('31/02', '09:00', NOW)).toEqual({ ok: false, error: 'NONEXISTENT_DATE' });
  });

  it('refuses a moment that has passed', () => {
    expect(resolveRunAt('01/01/2020', '09:00', NOW)).toEqual({ ok: false, error: 'PAST' });
    expect(resolveRunAt('', '11:00', NOW)).toEqual({ ok: false, error: 'PAST' });
  });

  it('refuses a missing or unreadable time', () => {
    expect(resolveRunAt('20/10/2026', '', NOW)).toEqual({ ok: false, error: 'TIME_REQUIRED' });
    expect(resolveRunAt('20/10/2026', '25:99', NOW)).toEqual({ ok: false, error: 'INVALID_TIME' });
  });

  it('refuses a span next to a date', () => {
    expect(resolveRunAt('20/10/2026', '30m', NOW)).toEqual({
      ok: false,
      error: 'RELATIVE_WITH_DATE',
    });
  });

  it('refuses a moment beyond what the server accepts', () => {
    expect(resolveRunAt('20/10/2028', '09:00', NOW)).toEqual({ ok: false, error: 'TOO_FAR' });
  });
});

describe('errorField', () => {
  it('shows a date mistake on the date and every other one on the time', () => {
    expect(errorField('NONEXISTENT_DATE')).toBe('date');
    expect(errorField('INVALID_DATE')).toBe('date');
    expect(errorField('PAST')).toBe('time');
    expect(errorField('TIME_REQUIRED')).toBe('time');
  });
});
