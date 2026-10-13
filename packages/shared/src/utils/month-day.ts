/**
 * Days per month with February at 29: someone born on 29 February is greeted in
 * the years that have it. The database CHECK on BirthdayEntry encodes the same
 * table, so the two must change together.
 */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isValidMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  const days = DAYS_IN_MONTH[month - 1];
  return days !== undefined && day >= 1 && day <= days;
}
