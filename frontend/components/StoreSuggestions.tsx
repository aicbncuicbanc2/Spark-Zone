import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getStoreDetails, searchStores } from '../lib/dataSource';
import { getLastKnownLocation } from '../lib/lastKnownLocation';
import { storeMatchesCategory } from '../lib/storeCategoryTypes';
import { getRecentVisits, type VisitedStore } from '../lib/storeVisits';
import { colors, fontSize } from '../lib/theme';
import type { StoreSuggestion } from '../lib/types';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * "Where did you buy this from?" — a real, editable field (like Storage
 * location), not just a tap-through convenience. Two ways to fill it:
 * tapping a store the walk-around tracker (see useStoreVisitTracking)
 * actually detected the user visiting in the last 24h, filtered to ones
 * plausibly selling this category (a pharmacy for medicine, not the wet
 * market also walked past that day); or typing, which searches Places
 * Autocomplete live (the same UX as a food-delivery app's address search),
 * biased toward wherever the tracker last saw the user (not a fresh
 * location request of its own - just reusing its passively-collected
 * position, see lib/lastKnownLocation.ts) so a common name like "Guardian"
 * favors the nearest branches over the most nationally prominent ones.
 * Picking a suggestion or a recent visit both just fill this field with
 * that store's name, exactly like typing it by hand. Nothing shows here
 * if the tracker never detected a real visit, e.g. an item bought days ago
 * and only being recorded now, while at home.
 */
export function StoreSuggestions({
  categoryId,
  value,
  onChangeText,
}: {
  categoryId?: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const [recentVisits, setRecentVisits] = useState<VisitedStore[]>([]);
  const [suggestions, setSuggestions] = useState<StoreSuggestion[]>([]);
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  // Selecting a recent visit or a suggestion sets `value` programmatically -
  // without this, that change would immediately re-trigger the search
  // effect below and pop the dropdown right back open on the name just picked.
  const justPicked = useRef(false);

  useEffect(() => {
    setRecentVisits(getRecentVisits().filter((v) => storeMatchesCategory(v.types, categoryId)));
  }, [categoryId]);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      setSuggestions([]);
      return;
    }
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await searchStores(value.trim(), getLastKnownLocation() ?? undefined);
      if (!cancelled) setSuggestions(results);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  function selectName(name: string) {
    justPicked.current = true;
    onChangeText(name);
    setSuggestions([]);
  }

  async function pickSuggestion(suggestion: StoreSuggestion) {
    setResolvingPlaceId(suggestion.place_id);
    try {
      const store = await getStoreDetails(suggestion.place_id);
      selectName(store.name);
    } catch {
      // A stale/unresolvable suggestion - leave the field as-is so the
      // user can just try a different one, rather than surface an error
      // for what's ultimately an optional convenience feature.
    } finally {
      setResolvingPlaceId(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Where did you buy this from?</Text>
      {recentVisits.length > 0 && (
        <View style={styles.list}>
          {recentVisits.map((store) => (
            <Pressable key={store.place_id} style={styles.row} onPress={() => selectName(store.name)}>
              <Text style={styles.rowName}>{store.name}</Text>
              <Text style={styles.rowAddress} numberOfLines={1}>
                {store.address}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="e.g. Guardian Pharmacy"
        placeholderTextColor={colors.textMuted}
      />
      {suggestions.length > 0 && (
        <View style={styles.suggestionList}>
          {suggestions.map((suggestion) => (
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
          ))}
        </View>
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
    // Sized to its own content (like the category pills above), not
    // stretched to fill the row's full width - the default for a plain
    // View/Pressable inside a vertical flex column.
    alignSelf: 'flex-start',
    maxWidth: '100%',
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
