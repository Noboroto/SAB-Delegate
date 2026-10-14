import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { DiscordTimestamp } from './discord-timestamp';

// 17:30 UTC on 1 January is 00:30 on 2 January in Asia/Ho_Chi_Minh (UTC+7).
const INSTANT = '2026-01-01T17:30:00Z';
const MACHINE_ZONE = process.env.TZ;

afterEach(() => {
  if (MACHINE_ZONE === undefined) delete process.env.TZ;
  else process.env.TZ = MACHINE_ZONE;
});

describe('DiscordTimestamp', () => {
  it.each(['UTC', 'Asia/Ho_Chi_Minh'])(
    'prints the business-zone time when the machine zone is %s',
    (zone) => {
      process.env.TZ = zone;
      renderWithProviders(<DiscordTimestamp value={INSTANT} />, 'en');
      const time = screen.getByText('2 Jan 2026, 00:30');
      expect(time.tagName).toBe('TIME');
      expect(time).toHaveAttribute('dateTime', '2026-01-01T17:30:00.000Z');
    },
  );

  it('prints the same instant in the page language', () => {
    renderWithProviders(<DiscordTimestamp value={new Date(INSTANT)} />, 'vi');
    expect(screen.getByRole('time')).toHaveTextContent('00:30');
  });
});
