import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { getNearbyStores } from '../lib/dataSource';
import { storeMatchesCategory } from '../lib/storeCategoryTypes';
import { getRecentVisits } from '../lib/storeVisits';
import { colors, fontSize } from '../lib/theme';
import type { Store } from '../lib/types';

function openInMaps(store: Store) {
  const query = encodeURIComponent(`${store.name} ${store.address}`);
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
}

/**
 * "Where did you buy this from?" — stores the walk-around tracker (see
 * useStoreVisitTracking) has seen in the last 24h, filtered to ones
 * plausibly selling this category (a pharmacy for medicine, not the wet
 * market also walked past that day), plus a button for a live nearby
 * search if nothing recent matches. Purely a tap-through-to-Maps
 * convenience — not persisted against the item, and never a stock check.
 */
export function StoreSuggestions({ categoryId }: { categoryId?: string }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const recent = getRecentVisits().filter((v) => storeMatchesCategory(v.types, categoryId));
    setStores(recent);
    setSearched(false);
  }, [categoryId]);

  async function findNearby() {
    setSearching(true);
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      const granted =
        permission.status === 'granted'
          ? permission
          : await Location.requestForegroundPermissionsAsync();
      if (granted.status !== 'granted') return;

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const found = await getNearbyStores({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        category_id: categoryId,
      });
      setStores((current) => {
        const merged = [...current];
        for (const store of found) {
          if (!merged.some((s) => s.place_id === store.place_id)) merged.push(store);
        }
        return merged;
      });
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Where did you buy this from?</Text>
      {stores.length > 0 && (
        <View style={styles.list}>
          {stores.map((store) => (
            <Pressable key={store.place_id} style={styles.row} onPress={() => openInMaps(store)}>
              <Text style={styles.rowName}>{store.name}</Text>
              <Text style={styles.rowAddress} numberOfLines={1}>
                {store.address}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable style={styles.findButton} onPress={findNearby} disabled={searching}>
        {searching ? (
          <ActivityIndicator color={colors.navy} size="small" />
        ) : (
          <Text style={styles.findButtonText}>
            {stores.length > 0 ? 'Find more nearby' : 'Find nearby stores'}
          </Text>
        )}
      </Pressable>
      {searched && stores.length === 0 && (
        <Text style={styles.empty}>No nearby stores found — try again once you're outdoors.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 14,
  },
  label: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginBottom: 6,
  },
  list: {
    gap: 8,
    marginBottom: 8,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.white,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  rowAddress: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  findButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  findButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.navy,
  },
  empty: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
});
