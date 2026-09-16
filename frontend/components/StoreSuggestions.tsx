import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getNearbyStores, getStoreDetails, searchStores } from '../lib/dataSource';
import { storeMatchesCategory } from '../lib/storeCategoryTypes';
import { getRecentVisits } from '../lib/storeVisits';
import { colors, fontSize } from '../lib/theme';
import type { Store, StoreSuggestion } from '../lib/types';

const SEARCH_DEBOUNCE_MS = 300;

function openInMaps(store: Store) {
  const query = encodeURIComponent(`${store.name} ${store.address}`);
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
}

/**
 * "Where did you buy this from?" — stores the walk-around tracker (see
 * useStoreVisitTracking) has seen in the last 24h, filtered to ones
 * plausibly selling this category (a pharmacy for medicine, not the wet
 * market also walked past that day); a button for a live GPS-based nearby
 * search; and a type-to-search box (Places Autocomplete) for picking an
 * exact store by name/address, the same UX as a food-delivery app's
 * address search — the fallback for when GPS is unavailable or too
 * imprecise, which desktop browsers commonly are. Purely a
 * tap-through-to-Maps convenience — not persisted against the item, and
 * never a stock check.
 */
export function StoreSuggestions({ categoryId }: { categoryId?: string }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const lastKnownLocation = useRef<{ lat: number; lng: number } | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<StoreSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);

  useEffect(() => {
    const recent = getRecentVisits().filter((v) => storeMatchesCategory(v.types, categoryId));
    setStores(recent);
    setSearched(false);
  }, [categoryId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setSuggestionsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchStores(query.trim(), lastKnownLocation.current ?? undefined);
        if (!cancelled) setSuggestions(results);
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function addStore(store: Store) {
    setStores((current) => (current.some((s) => s.place_id === store.place_id) ? current : [...current, store]));
  }

  async function pickSuggestion(suggestion: StoreSuggestion) {
    setResolvingPlaceId(suggestion.place_id);
    try {
      const store = await getStoreDetails(suggestion.place_id);
      addStore(store);
      setQuery('');
      setSuggestions([]);
    } catch {
      // A stale/unresolvable suggestion - leave the search box as-is so
      // the user can just try a different one, rather than surface an error
      // for what's ultimately an optional convenience feature.
    } finally {
      setResolvingPlaceId(null);
    }
  }

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
      lastKnownLocation.current = { lat: position.coords.latitude, lng: position.coords.longitude };
      const found = await getNearbyStores({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        category_id: categoryId,
      });
      for (const store of found) addStore(store);
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

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Or search by store name or address"
          placeholderTextColor={colors.textMuted}
        />
        {(suggestionsLoading || suggestions.length > 0) && (
          <View style={styles.suggestionList}>
            {suggestionsLoading && suggestions.length === 0 ? (
              <View style={styles.suggestionRow}>
                <ActivityIndicator color={colors.navy} size="small" />
              </View>
            ) : (
              suggestions.map((suggestion) => (
                <Pressable
                  key={suggestion.place_id}
                  style={styles.suggestionRow}
                  onPress={() => pickSuggestion(suggestion)}
                  disabled={resolvingPlaceId === suggestion.place_id}
                >
                  {resolvingPlaceId === suggestion.place_id ? (
                    <ActivityIndicator color={colors.navy} size="small" />
                  ) : (
                    <>
                      <Text style={styles.rowName}>{suggestion.main_text}</Text>
                      <Text style={styles.rowAddress} numberOfLines={1}>
                        {suggestion.secondary_text}
                      </Text>
                    </>
                  )}
                </Pressable>
              ))
            )}
          </View>
        )}
      </View>

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
  searchWrap: {
    marginBottom: 8,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: colors.white,
  },
  suggestionList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginTop: 6,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
