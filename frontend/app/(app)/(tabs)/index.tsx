import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ItemRow } from '../../../components/ItemRow';
import { useAuth } from '../../../contexts/AuthContext';
import { alert } from '../../../lib/alert';
import { exportToCalendar } from '../../../lib/ics';
import { useDashboard, useItems } from '../../../lib/queries';
import { colors } from '../../../lib/theme';
import type { DashboardResponse, Item } from '../../../lib/types';

const BUCKETS: { key: keyof DashboardResponse['counts']; label: string; color: string }[] = [
  { key: 'expired', label: 'Expired', color: '#c0392b' },
  { key: 'critical', label: 'Critical', color: '#d35400' },
  { key: 'soon', label: 'Soon', color: '#b9770e' },
  { key: 'upcoming', label: 'Upcoming', color: '#9a7d0a' },
  { key: 'ok', label: 'OK', color: '#1e8449' },
];

// Every active item lands in exactly one group: urgency alone decides
// "Expired" and "Use within 3 days" (soon = <=3 days already, so it and
// critical cover that span). For anything not yet urgent, "past prime" only
// applies to an item with an actual once-opened rule (opened_at + pao_months)
// - an item that's merely been opened, with no PAO limit, is still fine; one
// governed by a PAO countdown is worth flagging even before it turns urgent,
// since that shorter window is easy to forget once the lid's back on.
type GroupKey = 'expired' | 'soon' | 'pastPrime' | 'fine';

const GROUP_LABELS: Record<GroupKey, string> = {
  expired: 'Expired — dispose safely',
  soon: 'Use within 3 days',
  pastPrime: 'Past prime — check before using',
  fine: 'Still fine to use',
};

function groupKeyFor(item: Item): GroupKey {
  if (item.urgency === 'expired') return 'expired';
  if (item.urgency === 'critical' || item.urgency === 'soon') return 'soon';
  return item.opened_at && item.pao_months != null ? 'pastPrime' : 'fine';
}

function groupItems(items: Item[]): { key: GroupKey; label: string; items: Item[] }[] {
  const buckets: Record<GroupKey, Item[]> = { expired: [], soon: [], pastPrime: [], fine: [] };
  for (const item of items) buckets[groupKeyFor(item)].push(item);
  return (Object.keys(GROUP_LABELS) as GroupKey[])
    .map((key) => ({ key, label: GROUP_LABELS[key], items: buckets[key] }))
    .filter((group) => group.items.length > 0);
}

export default function DashboardScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { data, isLoading, isRefetching, refetch, error } = useDashboard();
  const { data: itemsData } = useItems();

  const activeItems = itemsData?.items ?? [];
  const todayItems = useMemo(() => activeItems.filter((item) => item.days_remaining === 0), [activeItems]);
  const groups = useMemo(() => groupItems(activeItems), [activeItems]);

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
    <View style={styles.screen}>
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

      {todayItems.length > 0 && (
        <View style={styles.todayCard}>
          <Text style={styles.todayTitle}>
            {todayItems.length === 1 ? '1 item expires today' : `${todayItems.length} items expire today`}
          </Text>
          <Text style={styles.todaySubtitle}>Use it, check it, or dispose of it safely.</Text>
          <View style={styles.todayLinks}>
            {todayItems.map((item) => (
              <Pressable key={item.id} onPress={() => router.push(`/item/${item.id}`)}>
                <Text style={styles.todayItemLink}>{item.name} ›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.bucketRow}>
        {BUCKETS.map(({ key, label, color }) => (
          <Pressable
            key={key}
            style={styles.bucket}
            onPress={() => router.push({ pathname: '/pantry', params: { urgency: key } })}
          >
            <Text style={[styles.bucketCount, { color }]}>{data.counts[key]}</Text>
            <Text style={styles.bucketLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.totalLabel}>{data.counts.total_active} active items</Text>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Expiring soon</Text>
        {data.expiring_soon.length > 0 && (
          <Pressable
            onPress={() =>
              exportToCalendar(data.expiring_soon, 'expiring-soon').catch((error) =>
                alert('Could not export', (error as Error).message)
              )
            }
          >
            <Text style={styles.sectionAction}>Add all to Calendar</Text>
          </Pressable>
        )}
      </View>
      {data.expiring_soon.length === 0 ? (
        <Text style={styles.empty}>Nothing urgent — nice.</Text>
      ) : (
        data.expiring_soon.map((item) => (
          <ItemRow key={item.id} item={item} onPress={() => router.push(`/item/${item.id}`)} />
        ))
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Use it before it's gone</Text>
      </View>
      {groups.length === 0 ? (
        <Text style={styles.empty}>Nothing in your pantry yet.</Text>
      ) : (
        groups.map((group) => (
          <View key={group.key}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.items.map((item) => (
              <ItemRow key={item.id} item={item} onPress={() => router.push(`/item/${item.id}`)} />
            ))}
          </View>
        ))
      )}
      </ScrollView>

      <Pressable style={styles.askButton} onPress={() => router.push('/ask-thyme')}>
        <Text style={styles.askButtonText}>Ask Thyme</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  askButton: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    backgroundColor: colors.navy,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  askButtonText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
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
  todayCard: {
    backgroundColor: colors.navy,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    gap: 8,
  },
  todayTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  todaySubtitle: {
    fontSize: 13,
    color: '#C9CEEF',
  },
  todayLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  todayItemLink: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
    textDecorationLine: 'underline',
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
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.navy,
  },
  sectionAction: {
    fontSize: 13,
    color: colors.navy,
    fontWeight: '600',
  },
  empty: {
    color: colors.textMuted,
    paddingHorizontal: 16,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.navyMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 2,
  },
});
