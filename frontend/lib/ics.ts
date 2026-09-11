import { Platform } from 'react-native';

import { alert } from './alert';
import type { Item } from './types';

// Two ways to get an item onto the user's calendar. Preferred, native only:
// write directly into the device calendar via expo-calendar - one tap, no
// confirmation screen, once permission is granted. Everywhere else (web, or
// native if permission is denied): hand over a standard .ics (iCalendar,
// RFC 5545) file instead - every phone already knows what to do with one
// ("add to calendar", landing in whichever app is the user's default,
// Google Calendar included) - with no OAuth login of our own to build or
// maintain on top of the existing Supabase auth.

function eventLabel(item: Item): string {
  return item.brand &&
    !item.brand.toLowerCase().includes(item.name.toLowerCase()) &&
    !item.name.toLowerCase().includes(item.brand.toLowerCase())
    ? `${item.brand} ${item.name}`
    : item.name;
}

function eventDescription(item: Item): string | null {
  const parts = [item.storage_location ? `Stored: ${item.storage_location}` : null, item.notes].filter(
    (part): part is string => !!part
  );
  return parts.length ? parts.join('\n') : null;
}

function addOneDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}

// --- .ics fallback (all platforms) --------------------------------------

function escapeIcsText(value: string): string {
  // RFC 5545 §3.3.11 - backslash, semicolon and comma are structural
  // characters in a TEXT value and must be escaped; a literal newline
  // becomes the two-character sequence \n.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toIcsDate(isoDate: string): string {
  return isoDate.replace(/-/g, ''); // "2026-12-31" -> "20261231"
}

function timestampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildEvent(item: Item): string {
  const description = eventDescription(item);
  return [
    'BEGIN:VEVENT',
    // Stable across re-exports of the same item, so re-adding it updates
    // the existing calendar entry instead of creating a duplicate.
    `UID:${item.id}@thyme-expiry-guardian`,
    `DTSTAMP:${timestampNow()}`,
    // VALUE=DATE (no time) makes this an all-day event; DTEND is exclusive
    // per RFC 5545, so a one-day event's end is the following day.
    `DTSTART;VALUE=DATE:${toIcsDate(item.effective_expiry_date)}`,
    `DTEND;VALUE=DATE:${toIcsDate(addOneDay(item.effective_expiry_date))}`,
    `SUMMARY:${escapeIcsText(`${eventLabel(item)} expires`)}`,
    ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
    'END:VEVENT',
  ].join('\r\n');
}

export function buildIcsCalendar(items: Item[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Thyme//Expiry Guardian//EN',
    'CALSCALE:GREGORIAN',
    ...items.map(buildEvent),
    'END:VCALENDAR',
  ].join('\r\n');
}

async function exportAsIcsFile(items: Item[], filenameHint: string): Promise<void> {
  const content = buildIcsCalendar(items);
  const filename = `${slugify(filenameHint)}.ics`;

  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);

  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(content);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/calendar',
      dialogTitle: 'Add to calendar',
      UTI: 'com.apple.ical.ics',
    });
  }
}

// --- Direct write (native only) -----------------------------------------

async function getWritableCalendar(Calendar: typeof import('expo-calendar')) {
  if (Platform.OS === 'ios') {
    try {
      return Calendar.getDefaultCalendarSync();
    } catch {
      return null;
    }
  }
  // Android has no single "default" calendar - pick the first one the
  // device actually allows writing to (a purely local phone, a synced
  // Google account, etc. can all appear here).
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return calendars.find((cal) => cal.allowsModifications) ?? null;
}

/** True on success. False (never throws) means the caller should fall back
 * to the .ics file instead - permission denied, no writable calendar found,
 * or anything else that goes wrong along the way. */
async function tryDirectCalendarWrite(items: Item[]): Promise<boolean> {
  try {
    const Calendar = await import('expo-calendar');
    const { status } = await Calendar.requestCalendarPermissions();
    if (status !== 'granted') return false;

    const calendar = await getWritableCalendar(Calendar);
    if (!calendar) return false;

    for (const item of items) {
      await calendar.createEvent({
        title: `${eventLabel(item)} expires`,
        notes: eventDescription(item) ?? undefined,
        startDate: new Date(`${item.effective_expiry_date}T00:00:00`),
        endDate: new Date(`${addOneDay(item.effective_expiry_date)}T00:00:00`),
        allDay: true,
      });
    }
    return true;
  } catch (error) {
    console.warn('[calendar] direct write failed, falling back to .ics file', error);
    return false;
  }
}

/**
 * Gets one or more items onto the user's calendar. Tries a direct,
 * one-tap write into the device calendar first (native only); falls back
 * to handing over a .ics file - a real download on web, the share sheet
 * on native - whenever that isn't possible.
 */
export async function exportToCalendar(items: Item[], filenameHint: string): Promise<void> {
  if (items.length === 0) return;

  if (Platform.OS !== 'web') {
    const wrote = await tryDirectCalendarWrite(items);
    if (wrote) {
      alert(
        'Added to Calendar',
        items.length === 1 ? `"${eventLabel(items[0])}" is on your calendar.` : `${items.length} items are on your calendar.`
      );
      return;
    }
  }

  await exportAsIcsFile(items, filenameHint);
}
