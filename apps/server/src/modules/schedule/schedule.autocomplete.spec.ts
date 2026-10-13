import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutocompleteInteraction } from '../../discord/helpers/autocomplete-budget.js';
import { translatorFor } from '../../i18n/translator.js';
import {
  ScheduleCancelAutocompleteInterceptor,
  ScheduleWhenAutocompleteInterceptor,
  dateChoices,
  pendingChoice,
  timeChoices,
} from './schedule.autocomplete.js';
import type { ScheduleService } from './schedule.service.js';

// Tuesday 13 October 2026, 10:00 in Vietnam.
const NOW = new Date('2026-10-13T03:00:00.000Z');
const GUILD = '1'.repeat(18);

const values = (choices: Array<{ value: string | number }>) => choices.map((c) => c.value);

describe('timeChoices', () => {
  it('offers spans from now, the coming hours and fixed times, each with where it lands', () => {
    const choices = timeChoices('', undefined, NOW);
    expect(values(choices)).toEqual([
      '15m',
      '30m',
      '1h',
      '2h',
      '11:00',
      '12:00',
      '13:00',
      // 08:00 has passed today; 12:00 is already offered above.
      '18:00',
      '20:00',
    ]);
    expect(choices[0]?.name).toBe('15m → 13/10/2026 10:15');
    expect(choices.find((c) => c.value === '18:00')?.name).toBe('18:00 → 13/10/2026 18:00');
  });

  it('shows the effect of the date already chosen', () => {
    const choices = timeChoices('', 'tomorrow', NOW);
    expect(choices.find((c) => c.value === '08:00')?.name).toBe('08:00 → 14/10/2026 08:00');
    // A span cannot be combined with a date, so none is offered.
    expect(values(choices)).not.toContain('15m');
  });

  it('puts what was typed first when it already reads as a time', () => {
    const choices = timeChoices('14:45', undefined, NOW);
    expect(values(choices)).toEqual(['14:45']);
    expect(choices[0]?.name).toBe('14:45 → 13/10/2026 14:45');
  });

  it('narrows the picks to what was typed', () => {
    expect(values(timeChoices('1', undefined, NOW))).toEqual([
      '15m',
      '1h',
      '11:00',
      '12:00',
      '13:00',
      '18:00',
    ]);
    expect(values(timeChoices('zzz', undefined, NOW))).toEqual([]);
  });

  it('leaves out a time that has passed and does not offer hours past midnight', () => {
    const lateEvening = new Date('2026-10-13T15:30:00.000Z');
    const picks = values(timeChoices('', undefined, lateEvening));
    expect(picks).not.toContain('08:00');
    expect(picks).not.toContain('00:00');
    expect(picks).toContain('23:00');
  });

  it('never returns a value longer than Discord takes', () => {
    expect(timeChoices('1'.repeat(150), undefined, NOW)).toEqual([]);
  });
});

describe('dateChoices', () => {
  const t = translatorFor('en');

  it('offers today, tomorrow and the following week with their dates', () => {
    const choices = dateChoices('', t, NOW);
    expect(choices.slice(0, 3)).toEqual([
      { name: 'Today (13/10/2026)', value: 'today' },
      { name: 'Tomorrow (14/10/2026)', value: 'tomorrow' },
      { name: '15/10/2026', value: '15/10/2026' },
    ]);
    expect(choices).toHaveLength(9);
  });

  it('answers in the language of the invoker', () => {
    const choices = dateChoices('', translatorFor('vi'), NOW);
    expect(choices[0]?.name).toBe('Hôm nay (13/10/2026)');
    expect(choices[0]?.value).toBe('today');
  });

  it('keeps the labelled choice when the typed text is one of them', () => {
    const choices = dateChoices('tomorrow', t, NOW);
    expect(choices).toEqual([{ name: 'Tomorrow (14/10/2026)', value: 'tomorrow' }]);
  });

  it('echoes a date that is typed in full and that the parser reads', () => {
    const choices = dateChoices('05/11/2026', t, NOW);
    expect(choices).toEqual([{ name: '05/11/2026', value: '05/11/2026' }]);
  });

  it('echoes nothing for text that is not a date, or a date that is gone', () => {
    expect(dateChoices('banana', t, NOW)).toEqual([]);
    expect(dateChoices('01/01/2020', t, NOW)).toEqual([]);
  });
});

describe('pendingChoice', () => {
  const runAt = new Date('2026-10-20T02:30:00.000Z');

  it('shows the number, when it goes out and the start of the text', () => {
    expect(pendingChoice({ seq: 12, kind: 'SEND', runAt, preview: 'Meeting at 9' })).toEqual({
      name: '12 · 20/10/2026 09:30 · Meeting at 9',
      value: 12,
    });
  });

  it('says copy for a copy and stays within the length Discord takes', () => {
    expect(pendingChoice({ seq: 1, kind: 'COPY', runAt, preview: 'copy' }).name).toBe(
      '1 · 20/10/2026 09:30 · copy',
    );
    expect(
      pendingChoice({ seq: 1, kind: 'SEND', runAt, preview: 'x'.repeat(300) }).name,
    ).toHaveLength(100);
  });
});

type Target = {
  guildId: string | null;
  locale: string;
  respond: ReturnType<typeof vi.fn>;
  options: { getFocused: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
};

function interactionFor(
  focused: { name: string; value: string },
  others: Record<string, string> = {},
  guildId: string | null = GUILD,
): { target: AutocompleteInteraction; respond: ReturnType<typeof vi.fn> } {
  const respond = vi.fn().mockResolvedValue(undefined);
  const target: Target = {
    guildId,
    locale: 'en-US',
    respond,
    options: {
      getFocused: vi.fn((full?: boolean) => (full === true ? focused : focused.value)),
      get: vi.fn((name: string) => (name in others ? { value: others[name] } : null)),
    },
  };
  return { target: target as unknown as AutocompleteInteraction, respond };
}

describe('ScheduleWhenAutocompleteInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('suggests times for the time field, using the date chosen so far', async () => {
    const interceptor = new ScheduleWhenAutocompleteInterceptor();
    const { target, respond } = interactionFor({ name: 'time', value: '08' }, { date: 'tomorrow' });
    await interceptor.transformOptions(target);
    expect(respond).toHaveBeenCalledWith([{ name: '08:00 → 14/10/2026 08:00', value: '08:00' }]);
  });

  it('suggests dates for the date field', async () => {
    const interceptor = new ScheduleWhenAutocompleteInterceptor();
    const { target, respond } = interactionFor({ name: 'date', value: 'tom' });
    await interceptor.transformOptions(target);
    expect(respond).toHaveBeenCalledWith([{ name: 'Tomorrow (14/10/2026)', value: 'tomorrow' }]);
  });

  it('suggests nothing for another field and works outside a server', async () => {
    const interceptor = new ScheduleWhenAutocompleteInterceptor();
    const { target, respond } = interactionFor({ name: 'message', value: 'x' }, {}, null);
    await interceptor.transformOptions(target);
    expect(respond).toHaveBeenCalledWith([]);
  });

  it('is not undone by an interaction that expired', async () => {
    const interceptor = new ScheduleWhenAutocompleteInterceptor();
    const { target, respond } = interactionFor({ name: 'date', value: '' });
    respond.mockRejectedValueOnce(Object.assign(new Error('Unknown interaction'), { code: 10062 }));
    await expect(interceptor.transformOptions(target)).resolves.toBeUndefined();
    expect(respond).toHaveBeenCalledTimes(1);
  });
});

describe('ScheduleCancelAutocompleteInterceptor', () => {
  const runAt = new Date('2026-10-20T02:30:00.000Z');
  const rows = [
    { seq: 4, kind: 'SEND' as const, runAt, preview: 'Hello' },
    { seq: 9, kind: 'COPY' as const, runAt, preview: 'copy' },
  ];

  function build(autocompletePending = vi.fn().mockResolvedValue(rows)) {
    const interceptor = new ScheduleCancelAutocompleteInterceptor({
      autocompletePending,
    } as unknown as ScheduleService);
    return { interceptor, autocompletePending };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('suggests the pending messages of the server by number', async () => {
    const { interceptor, autocompletePending } = build();
    const { target, respond } = interactionFor({ name: 'id', value: ' 4 ' });
    await interceptor.transformOptions(target);

    expect(autocompletePending).toHaveBeenCalledWith(GUILD, '4');
    expect(respond).toHaveBeenCalledWith([
      { name: '4 · 20/10/2026 09:30 · Hello', value: 4 },
      { name: '9 · 20/10/2026 09:30 · copy', value: 9 },
    ]);
  });

  it('reads once for repeated identical input and again when the text changes', async () => {
    const { interceptor, autocompletePending } = build();
    await interceptor.transformOptions(interactionFor({ name: 'id', value: '4' }).target);
    await interceptor.transformOptions(interactionFor({ name: 'id', value: '4' }).target);
    expect(autocompletePending).toHaveBeenCalledTimes(1);
    await interceptor.transformOptions(interactionFor({ name: 'id', value: '49' }).target);
    expect(autocompletePending).toHaveBeenCalledTimes(2);
  });

  it('keeps the servers apart in the cache', async () => {
    const { interceptor, autocompletePending } = build();
    await interceptor.transformOptions(interactionFor({ name: 'id', value: '' }).target);
    await interceptor.transformOptions(
      interactionFor({ name: 'id', value: '' }, {}, '9'.repeat(18)).target,
    );
    expect(autocompletePending).toHaveBeenCalledTimes(2);
  });

  it('suggests nothing, and reads nothing, outside a server', async () => {
    const { interceptor, autocompletePending } = build();
    const { target, respond } = interactionFor({ name: 'id', value: '' }, {}, null);
    await interceptor.transformOptions(target);
    expect(respond).toHaveBeenCalledWith([]);
    expect(autocompletePending).not.toHaveBeenCalled();
  });

  it('answers an empty list when the read is slower than the budget, without throwing', async () => {
    vi.useFakeTimers();
    const slow = vi.fn(() => new Promise(() => undefined));
    const { interceptor } = build(slow);
    const { target, respond } = interactionFor({ name: 'id', value: '' });

    const pending = interceptor.transformOptions(target);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBeUndefined();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith([]);
  });

  it('does not answer twice or throw when the interaction died while it worked', async () => {
    const { interceptor } = build();
    const { target, respond } = interactionFor({ name: 'id', value: '' });
    respond.mockRejectedValueOnce(Object.assign(new Error('Unknown interaction'), { code: 10062 }));
    await expect(interceptor.transformOptions(target)).resolves.toBeUndefined();
    expect(respond).toHaveBeenCalledTimes(1);
  });
});
