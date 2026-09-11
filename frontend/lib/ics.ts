import { Platform } from 'react-native';

import type { Item } from './types';

// A standard .ics (iCalendar, RFC 5545) file, so "add to calendar" works
// identically everywhere - Google Calendar, Apple Calendar, Outlook - with
// no OAuth login of our own to build or maintain. Every phone already knows
// what to do when it sees one.

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
  // "2026-12-31" -> "20261231"
  return isoDate.replace(/-/g, '');
}

function addOneDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function timestampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildEvent(item: Item): string {
  const label = item.brand && !item.brand.toLowerCase().includes(item.name.toLowerCase()) && !item.name.toLowerCase().includes(item.brand.toLowerCase())
    ? `${item.brand} ${item.name}`
    : item.name;

  const descriptionParts = [
    item.storage_location ? `Stored: ${item.storage_location}` : null,
    item.notes,
  ].filter((part): part is string => !!part);

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
    `SUMMARY:${escapeIcsText(`${label} expires`)}`,
    ...(descriptionParts.length
      ? [`DESCRIPTION:${escapeIcsText(descriptionParts.join('\\n'))}`]
      : []),
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

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}

/**
 * Hands the user a .ics file for one or more items. On web this triggers a
 * normal file download - the OS then offers to open it with whatever
 * calendar app is default. On native it writes a temp file and opens the
 * share sheet, since there's no browser download step to hook into.
 */
export async function exportToCalendar(items: Item[], filenameHint: string): Promise<void> {
  if (items.length === 0) return;
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

  const [{ File, Paths }, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);

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
