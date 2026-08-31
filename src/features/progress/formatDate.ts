const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `2026-08-31` → `31 Aug 2026`.
 *
 * Formatted from the calendar parts directly. Passing the string to `Date` and
 * reading local parts back would shift the date by a day for anyone west of
 * UTC — the stored value is already the user's own local date.
 */
export function formatLocalDate(date: string): string {
  const match = PATTERN.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return date;
  return `${Number(day)} ${monthName} ${year}`;
}

/** `2026-08-31` → `31 Aug`. For axis ends, where the year is noise. */
export function formatShortDate(date: string): string {
  const match = PATTERN.exec(date);
  if (!match) return date;
  const [, , month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return date;
  return `${Number(day)} ${monthName}`;
}
