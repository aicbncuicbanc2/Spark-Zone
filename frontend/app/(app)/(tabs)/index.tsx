import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ItemRow } from '../../../components/ItemRow';
import { useAuth } from '../../../contexts/AuthContext';
import { useDashboard } from '../../../lib/queries';
import { colors } from '../../../lib/theme';
import type { DashboardResponse } from '../../../lib/types';

const BUCKETS: { key: keyof DashboardResponse['counts']; label: string; color: string }[] = [
  { key: 'expired', label: 'Expired', color: '#c0392b' },
  { key: 'critical', label: 'Critical', color: '#d35400' },
  { key: 'soon', label: 'Soon', color: '#b9770e' },
  { key: 'upcoming', label: 'Upcoming', color: '#9a7d0a' },
  { key: 'ok', label: 'OK', color: '#1e8449' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { data, isLoading, isRefetching, refetch, error } = useDashboard();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn't load the dashboard.</Text>
        <Text style={styles.errorDetail}>{(error as Error)?.message}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Your pantry</Text>
        <Pressable onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.bucketRow}>
        {BUCKETS.map(({ key, label, color }) => (
          <View key={key} style={styles.bucket}>
            <Text style={[styles.bucketCount, { color }]}>{data.counts[key]}</Text>
            <Text style={styles.bucketLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.totalLabel}>{data.counts.total_active} active items</Text>

      <Text style={styles.sectionTitle}>Expiring soon</Text>
      {data.expiring_soon.length === 0 ? (
        <Text style={styles.empty}>Nothing urgent — nice.</Text>
      ) : (
        data.expiring_soon.map((item) => (
          <ItemRow key={item.id} item={item} onPress={() => router.push(`/item/${item.id}`)} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
    backgroundColor: colors.cream,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.navy,
  },
  errorDetail: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.navy,
  },
  signOut: {
    color: colors.danger,
    fontSize: 14,
  },
  bucketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 20,
  },
  bucket: {
    alignItems: 'center',
    gap: 4,
  },
  bucketCount: {
    fontSize: 22,
    fontWeight: '700',
  },
  bucketLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  totalLabel: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 16,
    color: colors.navy,
  },
  empty: {
    color: colors.textMuted,
    paddingHorizontal: 16,
  },
});
