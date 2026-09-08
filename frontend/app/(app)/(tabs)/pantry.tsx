import { useRouter } from 'expo-router';
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
import type { ItemStatus } from '../../../lib/types';

const STATUSES: ItemStatus[] = ['active', 'consumed', 'discarded', 'expired'];
const SORTS = ['expiry', 'name', 'created'] as const;

export default function PantryScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ItemStatus>('active');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [sortIndex, setSortIndex] = useState(0);
  const sort = SORTS[sortIndex];

  const { data: categories } = useCategories();
  const { data, isLoading, error, refetch, isRefetching } = useItems({ status, category, sort });

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
          data={data?.items ?? []}
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
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
  },
});
