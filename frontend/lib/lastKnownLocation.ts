// The passive walk-around tracker (useStoreVisitTracking) already gets a
// fresh device position every ~20s while the app is open - this just
// remembers the latest one in memory so other features (the manual store
// search) can bias toward "wherever the user actually is" without asking
// for a new location fix of their own.
let current: { lat: number; lng: number } | null = null;

export function setLastKnownLocation(location: { lat: number; lng: number }): void {
  current = location;
}

export function getLastKnownLocation(): { lat: number; lng: number } | null {
  return current;
}
