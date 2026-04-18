export type TimezoneRegionKey = 'europe' | 'americas' | 'asia' | 'other';

export interface TimezoneRegionDefinition {
  key: TimezoneRegionKey;
  title: string;
  zones: string[];
}

export interface TimezonePage {
  region: TimezoneRegionDefinition;
  page: number;
  pageCount: number;
  zones: string[];
}

export const TIMEZONES_PER_PAGE = 8;

export const TIMEZONE_REGIONS = {
  europe: {
    key: 'europe',
    title: 'Europe',
    zones: [
      'Europe/Kiev',
      'Europe/Warsaw',
      'Europe/Berlin',
      'Europe/Prague',
      'Europe/Vienna',
      'Europe/Paris',
      'Europe/Riga',
      'Europe/Vilnius',
      'Europe/Tallinn',
      'Europe/Helsinki',
      'Europe/Bucharest',
      'Europe/Athens',
      'Europe/Istanbul',
      'Europe/London',
      'Europe/Dublin',
      'Europe/Madrid',
      'Europe/Rome',
      'Europe/Lisbon',
    ],
  },
  americas: {
    key: 'americas',
    title: 'Americas',
    zones: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Toronto',
      'America/Vancouver',
      'America/Mexico_City',
      'America/Bogota',
      'America/Lima',
      'America/Santiago',
      'America/Sao_Paulo',
      'America/Argentina/Buenos_Aires',
    ],
  },
  asia: {
    key: 'asia',
    title: 'Asia',
    zones: [
      'Asia/Dubai',
      'Asia/Tbilisi',
      'Asia/Yerevan',
      'Asia/Almaty',
      'Asia/Tashkent',
      'Asia/Bishkek',
      'Asia/Karachi',
      'Asia/Kolkata',
      'Asia/Dhaka',
      'Asia/Bangkok',
      'Asia/Jakarta',
      'Asia/Singapore',
      'Asia/Hong_Kong',
      'Asia/Shanghai',
      'Asia/Manila',
      'Asia/Seoul',
      'Asia/Tokyo',
    ],
  },
  other: {
    key: 'other',
    title: 'Other',
    zones: [
      'Africa/Cairo',
      'Africa/Johannesburg',
      'Indian/Maldives',
      'Australia/Perth',
      'Australia/Adelaide',
      'Australia/Sydney',
      'Pacific/Auckland',
    ],
  },
} as const satisfies Record<TimezoneRegionKey, TimezoneRegionDefinition>;

const TIMEZONE_LABELS: Record<string, string> = {
  'Europe/Kiev': 'Kyiv',
  'Europe/Warsaw': 'Warsaw',
  'Europe/Berlin': 'Berlin',
  'Europe/Prague': 'Prague',
  'Europe/Vienna': 'Vienna',
  'Europe/Paris': 'Paris',
  'Europe/Riga': 'Riga',
  'Europe/Vilnius': 'Vilnius',
  'Europe/Tallinn': 'Tallinn',
  'Europe/Helsinki': 'Helsinki',
  'Europe/Bucharest': 'Bucharest',
  'Europe/Athens': 'Athens',
  'Europe/Istanbul': 'Istanbul',
  'Europe/London': 'London',
  'Europe/Dublin': 'Dublin',
  'Europe/Madrid': 'Madrid',
  'Europe/Rome': 'Rome',
  'Europe/Lisbon': 'Lisbon',
  'America/New_York': 'New York',
  'America/Chicago': 'Chicago',
  'America/Denver': 'Denver',
  'America/Los_Angeles': 'Los Angeles',
  'America/Toronto': 'Toronto',
  'America/Vancouver': 'Vancouver',
  'America/Mexico_City': 'Mexico City',
  'America/Bogota': 'Bogota',
  'America/Lima': 'Lima',
  'America/Santiago': 'Santiago',
  'America/Sao_Paulo': 'Sao Paulo',
  'America/Argentina/Buenos_Aires': 'Buenos Aires',
  'Asia/Dubai': 'Dubai',
  'Asia/Tbilisi': 'Tbilisi',
  'Asia/Yerevan': 'Yerevan',
  'Asia/Almaty': 'Almaty',
  'Asia/Tashkent': 'Tashkent',
  'Asia/Bishkek': 'Bishkek',
  'Asia/Karachi': 'Karachi',
  'Asia/Kolkata': 'Kolkata',
  'Asia/Dhaka': 'Dhaka',
  'Asia/Bangkok': 'Bangkok',
  'Asia/Jakarta': 'Jakarta',
  'Asia/Singapore': 'Singapore',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Shanghai': 'Shanghai',
  'Asia/Manila': 'Manila',
  'Asia/Seoul': 'Seoul',
  'Asia/Tokyo': 'Tokyo',
  'Africa/Cairo': 'Cairo',
  'Africa/Johannesburg': 'Johannesburg',
  'Indian/Maldives': 'Maldives',
  'Australia/Perth': 'Perth',
  'Australia/Adelaide': 'Adelaide',
  'Australia/Sydney': 'Sydney',
  'Pacific/Auckland': 'Auckland',
};

export function getTimezoneLabel(timeZone: string): string {
  return TIMEZONE_LABELS[timeZone] ?? timeZone.split('/').slice(-1)[0].replace(/_/g, ' ');
}

export function getTimezonePage(regionKey: TimezoneRegionKey, page: number): TimezonePage {
  const region = TIMEZONE_REGIONS[regionKey];
  const pageCount = Math.ceil(region.zones.length / TIMEZONES_PER_PAGE);
  const safePage = Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));
  const startIndex = safePage * TIMEZONES_PER_PAGE;

  return {
    region,
    page: safePage,
    pageCount,
    zones: region.zones.slice(startIndex, startIndex + TIMEZONES_PER_PAGE),
  };
}

export function getTimezoneByRegionIndex(regionKey: TimezoneRegionKey, index: number): string | null {
  const region = TIMEZONE_REGIONS[regionKey];
  return region.zones[index] ?? null;
}