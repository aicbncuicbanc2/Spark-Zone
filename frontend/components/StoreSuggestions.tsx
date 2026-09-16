import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getStoreDetails, searchStores } from '../lib/dataSource';
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
 * useStoreVisitTracking) has actually detected the user being at in the
 * last 24h, filtered to ones plausibly selling this category (a pharmacy
 * for medicine, not the wet market also walked past that day) — nothing
 * shows here if the tracker never detected a real visit, e.g. an item
 * bought days ago and only being recorded now, while at home. Deliberately
 * no live "stores near you right now" search: that would suggest stores
 * near wherever the phone happens to be at add-time, which has nothing to
 * do with where the item was actually bought. The type-to-search box
 * below (Places Autocomplete) is the fallback for that case — the same
 * UX as a food-delivery app's address search. Purely a tap-through-to-Maps
 * convenience — not persisted against the item, and never a stock check.
 */
export function StoreSuggestions({ categoryId }: { categoryId?: string }) {
  const [stores, setStores] = useState<Store[]>([]);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<StoreSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);

  useEffect(() => {
    setStores(getRecentVisits().filter((v) => storeMatchesCategory(v.types, categoryId)));
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
        const results = await searchStores(query.trim());
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
          placeholder="Search by store name or address"
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
    marginBottom: 4,
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
});
