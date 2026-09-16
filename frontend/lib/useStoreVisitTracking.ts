import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { getNearbyStores } from './dataSource';
import { setLastKnownLocation } from './lastKnownLocation';
import { recordVisit } from './storeVisits';

const POLL_INTERVAL_MS = 20_000;
// Re-check only after moving this far - keeps the app from re-querying
// Places every 20s while someone's just standing still browsing the app.
const MOVE_THRESHOLD_M = 30;
// Small on purpose: this is "am I basically standing in front of a store
// right now," not a general nearby-stores search (that's the category-
// filtered lookup in getNearbyStores called from the add-item screen).
const DETECT_RADIUS_M = 50;

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Walk-around store detection. While this app's tab is open, polls the
 * device's current position every ~20s and, once it's moved far enough
 * since the last check, asks the backend "is there a real store within
 * ~50m of here right now." A hit is recorded via recordVisit() so it's
 * available later when adding/restocking an item.
 *
 * Web only, on purpose - a mobile browser only grants continuous location
 * access while its own tab is the one in the foreground (there's no
 * background variant of this on web at all), so testing this means holding
 * the phone with the Thyme tab open while walking, not backgrounding it.
 * Real background tracking would mean native "Always" location permission
 * instead - a much heavier, more sensitive ask that was deliberately ruled
 * out in favor of this foreground-only version.
 */
export function useStoreVisitTracking({ enabled }: { enabled: boolean }): void {
  const lastChecked = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function checkOnce() {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          const requested = await Location.requestForegroundPermissionsAsync();
          if (requested.status !== 'granted') return;
        }

        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const here = { lat: position.coords.latitude, lng: position.coords.longitude };
        // Kept fresh on every poll (not just when a store search actually
        // fires below) - other features (the manual store search) read
        // this as a "wherever the user actually is" bias.
        setLastKnownLocation(here);

        if (lastChecked.current && distanceMeters(lastChecked.current, here) < MOVE_THRESHOLD_M) {
          return;
        }
        lastChecked.current = here;

        const stores = await getNearbyStores({ lat: here.lat, lng: here.lng, radius_m: DETECT_RADIUS_M });
        if (cancelled) return;
        for (const store of stores) recordVisit(store);
      } catch {
        // Best-effort only - permission denied, offline, Places unavailable.
        // Never surfaced: this is a passive background convenience, not a
        // user-facing action that should show an error.
      }
    }

    checkOnce();
    timer = setInterval(checkOnce, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled]);
}
