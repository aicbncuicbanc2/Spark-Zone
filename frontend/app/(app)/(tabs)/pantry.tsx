import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CategoryPicker } from '../../../components/CategoryPicker';
import { ErrorState } from '../../../components/ErrorState';
import { ItemRow } from '../../../components/ItemRow';
import { useCategories, useItems } from '../../../lib/queries';
import { colors, statusColors } from '../../../lib/theme';
import type { ItemStatus } from '../../../lib/types';

const STATUSES: ItemStatus[] = ['active', 'consumed', 'discarded', 'expired'];
const SORTS = ['expiry', 'name', 'created'] as const;

export default function PantryScreen() {
  const router = useRouter();
  // Arrives here from the dashboard's category circles / calendar days.
  const params = useLocalSearchParams<{ category?: string; expiryDate?: string }>();

  const [status, setStatus] = useState<ItemStatus>('active');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [sortIndex, setSortIndex] = useState(0);
  const sort = SORTS[sortIndex];

  useEffect(() => {
    if (params.category) setCategory(params.category);
  }, [params.category]);

  const { data: categories } = useCategories();
  const { data, isLoading, error, refetch, isRefetching } = useItems({ status, category, sort });

  const items = useMemo(() => {
    let list = data?.items ?? [];
    if (params.expiryDate) {
      list = list.filter((item) => item.effective_expiry_date === params.expiryDate);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (item) => item.name.toLowerCase().includes(q) || item.brand?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, search, params.expiryDate]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={require('../../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor={colors.textMuted}
          />
          <Ionicons name="search" size={18} color={colors.textMuted} />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {STATUSES.map((s) => {
          const isSelected = status === s;
          const c = statusColors[s];
          return (
            <Pressable
              key={s}
              style={[
                styles.statusChip,
                { borderColor: c },
                isSelected && { backgroundColor: c },
              ]}
              onPress={() => setStatus(s)}
            >
              <Text style={[styles.statusChipText, { color: isSelected ? colors.white : c }]}>
                {s[0].toUpperCase() + s.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.categoryRow}>
        <Pressable
          style={[styles.chip, !category && styles.chipActive]}
          onPress={() => setCategory(undefined)}
        >
          <Text style={[styles.chipText, !category && styles.chipTextActive]}>All</Text>
        </Pressable>
        <View style={styles.categoryPickerFlex}>
          <CategoryPicker
            categories={categories}
            selectedId={category}
            onSelect={setCategory}
            newButtonVariant="square"
          />
        </View>
      </View>

      <Pressable style={styles.sortButton} onPress={() => setSortIndex((sortIndex + 1) % SORTS.length)}>
        <Text style={styles.sortButtonText}>Sort: {sort}</Text>
      </Pressable>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : error ? (
        <ErrorState title="Couldn't load items." message={(error as Error).message} onRetry={refetch} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ItemRow item={item} onPress={() => router.push(`/item/${item.id}`)} />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.empty}>
                {search.trim()
                  ? `No items match "${search.trim()}".`
                  : status === 'active' && !category
                    ? 'No items yet — use the Scan tab to add your first one.'
                    : `No ${status} items${category ? ' in this category' : ''}.`}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logo: {
    width: 90,
    height: 30,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.white,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.navy,
  },
  chipRow: {
    flexGrow: 0,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: colors.white,
  },
  statusChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  categoryPickerFlex: {
    flex: 1,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.white,
  },
  chipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  chipText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  chipTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
  sortButton: {
    alignSelf: 'flex-end',
    marginRight: 16,
    marginBottom: 4,
  },
  sortButtonText: {
    fontSize: 12,
    color: colors.navy,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    paddingHorizontal: 32,
    marginTop: 40,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
  },
});
