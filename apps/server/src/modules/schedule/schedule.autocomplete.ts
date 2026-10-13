import { Injectable } from '@nestjs/common';
import {
  formatIctDate,
  formatWhenIct,
  parseWhen,
  toIct,
  type SchedulePendingChoice,
} from '@sab/shared';
import { AutocompleteInterceptor } from 'necord';
import {
  withAutocompleteBudget,
  type AutocompleteInteraction,
} from '../../discord/helpers/autocomplete-budget.js';
import { translatorFor } from '../../i18n/translator.js';
import { ScheduleService } from './schedule.service.js';

type Choice = { name: string; value: string | number };

/** Discord refuses a choice whose name or value is longer than this. */
const CHOICE_MAX_LENGTH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days offered after tomorrow. */
const UPCOMING_DAYS = 7;

const RELATIVE_TIMES = ['15m', '30m', '1h', '2h'];
const FIXED_TIMES = ['08:00', '12:00', '18:00', '20:00'];

const two = (value: number): string => String(value).padStart(2, '0');

function textOption(interaction: AutocompleteInteraction, name: string): string | undefined {
  const value = interaction.options.get(name)?.value;
  return typeof value === 'string' ? value : undefined;
}

/**
 * What to offer for the `time` field. The typed text comes first when it
 * already reads as a time; the rest are common picks. Each choice shows the
 * moment it would resolve to with the `date` chosen so far, so the person sees
 * the effect before submitting. A pick that would already be in the past is
 * left out. These are suggestions only: the field accepts anything typed.
 */
export function timeChoices(typed: string, date: string | undefined, now: Date): Choice[] {
  const text = typed.trim();
  const needle = text.toLowerCase();
  const { hour } = toIct(now);

  const candidates = [text, ...RELATIVE_TIMES];
  for (let ahead = 1; ahead <= 3 && hour + ahead < 24; ahead += 1) {
    candidates.push(`${two(hour + ahead)}:00`);
  }
  candidates.push(...FIXED_TIMES);

  const choices: Choice[] = [];
  for (const candidate of new Set(candidates)) {
    if (candidate === '' || candidate.length > CHOICE_MAX_LENGTH) continue;
    if (needle !== '' && !candidate.toLowerCase().startsWith(needle)) continue;
    const result = parseWhen({ time: candidate, date }, now);
    if (!('at' in result)) continue;
    choices.push({
      name: `${candidate} → ${formatWhenIct(result.at)}`.slice(0, CHOICE_MAX_LENGTH),
      value: candidate,
    });
  }
  return choices;
}

/**
 * What to offer for the `date` field: today, tomorrow and the following week,
 * each shown with its calendar date. The value of today and tomorrow is the
 * word the parser knows, so the choice reads the same in any language.
 */
export function dateChoices(
  typed: string,
  t: (key: 'schedule.autocomplete.today' | 'schedule.autocomplete.tomorrow') => string,
  now: Date,
): Choice[] {
  const text = typed.trim();
  const needle = text.toLowerCase();
  const day = (offset: number) => formatIctDate(toIct(new Date(now.getTime() + offset * DAY_MS)));

  const candidates: Choice[] = [
    { name: `${t('schedule.autocomplete.today')} (${day(0)})`, value: 'today' },
    { name: `${t('schedule.autocomplete.tomorrow')} (${day(1)})`, value: 'tomorrow' },
  ];
  for (let offset = 2; offset < 2 + UPCOMING_DAYS; offset += 1) {
    candidates.push({ name: day(offset), value: day(offset) });
  }
  // Last, so the labelled choices win a tie: the typed text, when it is
  // already a date the parser reads.
  const echoed = parseWhen({ time: '23:59:59', date: text }, now);
  if (text !== '' && text.length <= CHOICE_MAX_LENGTH && 'at' in echoed) {
    candidates.push({ name: formatIctDate(toIct(echoed.at)), value: text });
  }

  const seen = new Set<string | number>();
  return candidates.filter((choice) => {
    const matches =
      needle === '' ||
      String(choice.value).toLowerCase().includes(needle) ||
      choice.name.toLowerCase().includes(needle);
    if (!matches || seen.has(choice.value)) return false;
    seen.add(choice.value);
    return true;
  });
}

/**
 * Suggests times and dates for the `time` and `date` options of the schedule
 * commands. Nothing here waits on Discord or the database, yet it goes through
 * the same time budget as every autocomplete so it can never be late.
 */
@Injectable()
export class ScheduleWhenAutocompleteInterceptor extends AutocompleteInterceptor {
  private readonly answer = withAutocompleteBudget<Choice[]>({
    cacheKey: () => undefined,
    load: (interaction) => {
      const focused = interaction.options.getFocused(true);
      const now = new Date();
      if (focused.name === 'time') {
        return Promise.resolve(timeChoices(focused.value, textOption(interaction, 'date'), now));
      }
      if (focused.name === 'date') {
        return Promise.resolve(dateChoices(focused.value, translatorFor(interaction.locale), now));
      }
      return Promise.resolve([]);
    },
    choices: (choices) => choices,
  });

  async transformOptions(interaction: AutocompleteInteraction): Promise<void> {
    await this.answer(interaction);
  }
}

function typedOf(interaction: AutocompleteInteraction): string {
  return String(interaction.options.getFocused()).trim();
}

export function pendingChoice(row: SchedulePendingChoice): Choice {
  const what = row.kind === 'COPY' ? 'copy' : row.preview;
  return {
    name: `${row.seq} · ${formatWhenIct(row.runAt)} · ${what}`.slice(0, CHOICE_MAX_LENGTH),
    value: row.seq,
  };
}

/**
 * Suggests the pending scheduled messages of the server for `scheduler
 * cancel`, soonest first, so nobody has to remember a number. The typed digits
 * are part of the cache key because the database does the narrowing.
 */
@Injectable()
export class ScheduleCancelAutocompleteInterceptor extends AutocompleteInterceptor {
  private readonly answer: (interaction: AutocompleteInteraction) => Promise<void>;

  constructor(schedules: ScheduleService) {
    super();
    this.answer = withAutocompleteBudget<SchedulePendingChoice[]>({
      cacheKey: (interaction) =>
        interaction.guildId === null ? undefined : `${interaction.guildId}:${typedOf(interaction)}`,
      load: async (interaction) =>
        interaction.guildId === null
          ? []
          : schedules.autocompletePending(interaction.guildId, typedOf(interaction)),
      choices: (rows) => rows.map(pendingChoice),
    });
  }

  async transformOptions(interaction: AutocompleteInteraction): Promise<void> {
    await this.answer(interaction);
  }
}
