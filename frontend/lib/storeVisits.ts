import { Platform } from 'react-native';

import type { Store } from './types';

// Bumped to v2: the walk-around detector used to record every store within
// a much wider radius than intended (a real bug, since fixed in
// places_client.py's nearby_stores) - v1 data already sitting in a
// browser's storage is exactly that over-broad, incorrect set. Changing
// the key orphans it automatically (reads just see nothing under v2, no
// migration needed) rather than requiring anyone to manually clear site
// data or wait up to 24h for it to age out on its own.
const STORAGE_KEY = 'thyme.storeVisits.v2';
const EXPIRY_MS = 24 * 60 * 60 * 1000;

export type VisitedStore = Store & { visited_at: number };

// Browser-local on purpose, not a backend table: this is a rolling 24h
// walking log for one phone's session, not data that needs to sync across
// devices or survive a reinstall. Web only, same as the tracking hook that
// feeds it - native never calls into this at all.
function readAll(): VisitedStore[] {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as VisitedStore[];
    const cutoff = Date.now() - EXPIRY_MS;
    return parsed.filter((visit) => visit.visited_at >= cutoff);
  } catch {
    return [];
  }
}

function writeAll(visits: VisitedStore[]): void {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visits));
  } catch {
    // Best-effort only - a full or blocked localStorage should never crash
    // the app over a "nice to have" suggestion feature.
  }
}

/**
 * Adds or refreshes a visited store's timestamp, pruning anything older
 * than 24h in the same pass - so the stored list is always exactly "what
 * I've walked past in the last day," never a growing, unbounded history.
 */
export function recordVisit(store: Store): void {
  const visits = readAll().filter((v) => v.place_id !== store.place_id);
  writeAll([...visits, { ...store, visited_at: Date.now() }]);
}

/** Stores visited within the last 24h, most recent first. */
export function getRecentVisits(): VisitedStore[] {
  return readAll().sort((a, b) => b.visited_at - a.visited_at);
}
