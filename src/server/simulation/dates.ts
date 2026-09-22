/**
 * Fixture dates are stored as "days ago" offsets and resolved against a clock at CALL time, so the demo
 * always looks fresh ("announced 3 days ago") no matter when it is run. The clock is the ONLY impure input
 * in the simulation layer; everything else is a pure function of its arguments.
 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

const DAY_MS = 86_400_000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `YYYY-MM-DD` (UTC) for `daysAgo` days before `now`. */
export function isoDaysAgo(daysAgo: number, now: Date): string {
  return new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** "September 12, 2026" — formatted by hand (no Intl) so output never depends on the host locale. */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Full ISO timestamp at noon UTC — keeps the calendar day stable when the UI formats it in any time zone. */
export function isoNoon(isoDate: string): string {
  return `${isoDate.slice(0, 10)}T12:00:00.000Z`;
}
