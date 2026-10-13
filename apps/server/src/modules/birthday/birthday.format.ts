import type { BirthdayEntryView, BirthdayImportProblem } from '@sab/shared';
import type { translatorFor } from '../../i18n/translator.js';

type Translator = ReturnType<typeof translatorFor>;

/** An import reports this many skipped rows and counts the rest. */
export const MAX_REPORTED_PROBLEMS = 20;

/**
 * The list as the command always printed it, one text per month that has
 * anyone (months nobody is born in are left out):
 *
 *     ## Month 3:
 *     ### Day 15:
 *     <student id> - <name> - <discord id>
 *
 * `entries` must already be ordered by month, day, then the order they were
 * added in; the database query does that.
 */
export function formatBirthdayMonths(
  entries: readonly BirthdayEntryView[],
): Array<{ month: number; text: string }> {
  const months: Array<{ month: number; text: string }> = [];
  let month = 0;
  let day = 0;
  for (const entry of entries) {
    if (entry.month !== month) {
      month = entry.month;
      day = 0;
      months.push({ month, text: `## Month ${month}:\n` });
    }
    const current = months[months.length - 1];
    if (current === undefined) continue;
    if (entry.day !== day) {
      day = entry.day;
      current.text += `### Day ${day}:\n`;
    }
    current.text += `${entry.studentId} - ${entry.name} - ${entry.discordId}\n`;
  }
  return months;
}

function describeProblem(t: Translator, problem: BirthdayImportProblem): string {
  switch (problem.kind) {
    case 'MISSING_FIELDS':
      return t('birthday.import.problem.missingFields', { row: problem.row });
    case 'INVALID_DATE':
      return t('birthday.import.problem.invalidDate', { row: problem.row });
    case 'INVALID_DISCORD_ID':
      return t('birthday.import.problem.invalidDiscordId', { row: problem.row });
    case 'INVALID_VALUE':
      return t('birthday.import.problem.invalidValue', { row: problem.row });
    case 'DUPLICATE_ID':
      return t('birthday.import.problem.duplicateId', {
        row: problem.row,
        id: problem.studentId ?? '',
      });
  }
}

/**
 * "Added X of Y row(s).", then, when rows were skipped, how many and the first
 * few with their line, then "...and N more". `problems` are shown in line order.
 */
export function formatImportReport(
  t: Translator,
  report: { total: number; added: number; problems: readonly BirthdayImportProblem[] },
): string {
  const lines = [t('birthday.import.summary', { added: report.added, total: report.total })];
  if (report.problems.length > 0) {
    const ordered = [...report.problems].sort((a, b) => a.row - b.row);
    lines.push(t('birthday.import.skipped', { count: ordered.length }));
    for (const problem of ordered.slice(0, MAX_REPORTED_PROBLEMS)) {
      lines.push(describeProblem(t, problem));
    }
    const more = ordered.length - MAX_REPORTED_PROBLEMS;
    if (more > 0) lines.push(t('birthday.import.more', { count: more }));
  }
  return lines.join('\n');
}
