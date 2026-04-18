export const APP_TIMEZONE = 'Europe/Kiev';

function getFormatterOptions(timeZone: string): Intl.DateTimeFormatOptions {
  return {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
}

export function resolveTimezone(timeZone?: string | null): string {
  if (!timeZone) {
    return APP_TIMEZONE;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return APP_TIMEZONE;
  }
}

function getDateParts(date: Date, timeZone: string = APP_TIMEZONE): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', getFormatterOptions(resolveTimezone(timeZone)));
  return formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
}

// Returns current date in configured timezone as "YYYY-MM-DD"
export function todayInAppTimezone(date: Date = new Date()): string {
  const parts = getDateParts(date, APP_TIMEZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function todayInTimezone(date: Date = new Date(), timeZone?: string | null): string {
  const parts = getDateParts(date, resolveTimezone(timeZone));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Format a Date object to "HH:MM" in configured timezone
export function formatTimeInAppTimezone(date: Date): string {
  const parts = getDateParts(date, APP_TIMEZONE);
  return `${parts.hour}:${parts.minute}`;
}

export function formatTimeInTimezone(date: Date, timeZone?: string | null): string {
  const parts = getDateParts(date, resolveTimezone(timeZone));
  return `${parts.hour}:${parts.minute}`;
}

// Validate and normalise wake-up time input (e.g. "5:30" → "05:30")
export function parseWakeTime(input: string): string | null {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, h, m] = match;
  const hh = parseInt(h, 10);
  const mm = parseInt(m, 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${m}`;
}

// Format Date to human-readable "HH:MM"
export function displayTime(date: Date, timeZone?: string | null): string {
  return formatTimeInTimezone(date, timeZone);
}

export function formatHumanDate(dateKey: string, timeZone?: string | null): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: resolveTimezone(timeZone),
    day: 'numeric',
    month: 'long',
  }).format(date);
}

export function formatHumanDateTime(date: Date, timeZone?: string | null): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: resolveTimezone(timeZone),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
