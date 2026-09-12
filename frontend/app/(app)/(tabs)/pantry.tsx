import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ItemRow } from '../../../components/ItemRow';
import { useCategories, useItems } from '../../../lib/queries';
import { colors } from '../../../lib/theme';
import type { ItemStatus, Urgency } from '../../../lib/types';

const STATUSES: ItemStatus[] = ['active', 'consumed', 'discarded', 'expired'];
const SORTS = ['expiry', 'name', 'created'] as const;

// Same 5 states and colors as HomeScreen's bucket row - kept as a separate
// constant (not imported) since urgency here drives a chip filter, not a
// count display, and the two screens' styling needs may drift independently.
const URGENCIES: { key: Urgency; label: string; color: string }[] = [
  { key: 'expired', label: 'Expired', color: '#c0392b' },
  { key: 'critical', label: 'Critical', color: '#d35400' },
  { key: 'soon', label: 'Soon', color: '#b9770e' },
  { key: 'upcoming', label: 'Upcoming', color: '#9a7d0a' },
  { key: 'ok', label: 'OK', color: '#1e8449' },
];

export default function PantryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ urgency?: Urgency }>();
  const [status, setStatus] = useState<ItemStatus>('active');
  const [category, setCategory] = useState<string | undefined>(undefined);
  // Seeded from the ?urgency= param Home's bucket row passes in, so tapping
  // "Critical" there lands here pre-filtered; still just local UI state
  // afterwards; the user can change or clear it like any other chip.
  const [urgency, setUrgency] = useState<Urgency | undefined>(params.urgency);
  const [sortIndex, setSortIndex] = useState(0);
  const sort = SORTS[sortIndex];

  const { data: categories } = useCategories();
  // No item's `status` column is ever actually written as "expired" - only
  // /consume and /discard exist as resolution actions, so a real backend
  // filter on status=expired always comes back empty. The "Expired" chip
  // instead means "active, but its date has already passed" - fetch the
  // real active bucket and split it client-side by urgency instead.
  const backendStatus = status === 'expired' ? 'active' : status;
  const { data, isLoading, error, refetch, isRefetching } = useItems({ status: backendStatus, category, sort });
  const statusFiltered =
    status === 'active'
      ? (data?.items ?? []).filter((item) => item.urgency !== 'expired')
      : status === 'expired'
        ? (data?.items ?? []).filter((item) => item.urgency === 'expired')
        : data?.items ?? [];
  // Urgency isn't a backend filter (ItemsQuery has no such param) - every
  // item already carries its own computed `urgency`, so this narrows the
  // already-fetched page client-side, same as the HomeScreen grouping.
  const items = urgency ? statusFiltered.filter((item) => item.urgency === urgency) : statusFiltered;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pantry</Text>
        <Pressable style={styles.addButton} onPress={() => router.push('/add')}>
          <Text style={styles.addButtonText}>+ Add</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {STATUSES.map((s) => (
          <Pressable
            key={s}
            style={[styles.chip, status === s && styles.chipActive]}
            onPress={() => setStatus(s)}
          >
            <Text style={[styles.chipText, status === s && styles.chipTextActive]}>
              {s[0].toUpperCase() + s.slice(1)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        <Pressable
          style={[styles.chip, !category && styles.chipActive]}
          onPress={() => setCategory(undefined)}
        >
          <Text style={[styles.chipText, !category && styles.chipTextActive]}>All</Text>
        </Pressable>
        {categories?.map((c) => (
          <Pressable
            key={c.id}
            style={[styles.chip, category === c.id && styles.chipActive]}
            onPress={() => setCategory(c.id)}
          >
            <Text style={[styles.chipText, category === c.id && styles.chipTextActive]}>
              {c.label_en}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        <Pressable
          style={[styles.chip, !urgency && styles.chipActive]}
          onPress={() => setUrgency(undefined)}
        >
          <Text style={[styles.chipText, !urgency && styles.chipTextActive]}>All</Text>
        </Pressable>
        {URGENCIES.map((u) => (
          <Pressable
            key={u.key}
            style={[
              styles.chip,
              urgency === u.key && { backgroundColor: u.color, borderColor: u.color },
            ]}
            onPress={() => setUrgency(u.key)}
          >
            <Text style={[styles.chipText, urgency === u.key && styles.chipTextActive]}>
              {u.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable style={styles.sortButton} onPress={() => setSortIndex((sortIndex + 1) % SORTS.length)}>
        <Text style={styles.sortButtonText}>Sort: {sort}</Text>
      </Pressable>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text>Couldn't load items.</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ItemRow item={item} onPress={() => router.push(`/item/${item.id}`)} />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListEmptyComponent={<Text style={styles.empty}>No items here.</Text>}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    flexShrink: 0,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.navy,
  },
  addButton: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  chipRow: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
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
    flexShrink: 0,
  },
  sortButtonText: {
    fontSize: 12,
    color: colors.navy,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
  },
});
