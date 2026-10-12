const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** `YYYY-MM-DD` → "Oct 12". Dates are calendar dates, so format in UTC. */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function todayISO(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function isOverdue(date: string, now = new Date()): boolean {
  return date < todayISO(now);
}
