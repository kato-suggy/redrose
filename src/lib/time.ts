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
