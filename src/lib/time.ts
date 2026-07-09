/**
 * All storage is unix-epoch UTC; all display is Europe/London.
 * Intl handles the BST/GMT switch — no offset arithmetic anywhere.
 */

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/** "Friday 10 July" — day headings on the slot picker. */
export function formatLondonDay(epochSeconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(epochSeconds * 1000));
}

/** "10:00" — slot start/end times. */
export function formatLondonTime(epochSeconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

/**
 * Convert London wall-clock ("2026-07-20", "10:00") to epoch UTC.
 *
 * There's no direct API for "parse in a named timezone", so: pretend the
 * wall time is UTC, ask Intl what London shows at that instant, and use the
 * difference as the offset. One re-check handles the case where subtracting
 * the offset lands on the other side of a BST/GMT switch. Nonexistent wall
 * times (the spring-forward gap) resolve to the post-switch instant.
 */
export function londonToEpoch(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const guessMs = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(guessMs)) return null;
  const guess = guessMs / 1000;

  const offset = londonWallAsUTC(guess) - guess;
  let epoch = guess - offset;
  const offset2 = londonWallAsUTC(epoch) - epoch;
  if (offset2 !== offset) epoch = guess - offset2;
  return epoch;
}

/** What London's wall clock reads at `epoch`, re-encoded as if it were UTC. */
function londonWallAsUTC(epoch: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epoch * 1000));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return (
    Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`
    ) / 1000
  );
}

/** "Sat 14 Mar 2026, 10:00" — for emails and booking pages. */
export function formatLondon(epochSeconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}
