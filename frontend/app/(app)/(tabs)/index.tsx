import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ErrorState } from '../../../components/ErrorState';
import { ExpiryCalendar } from '../../../components/ExpiryCalendar';
import { ItemRow } from '../../../components/ItemRow';
import { useAuth } from '../../../contexts/AuthContext';
import { iconForCategory } from '../../../lib/categoryIcons';
import { useCategories, useDashboard, useItems } from '../../../lib/queries';
import { colors, urgencyColors } from '../../../lib/theme';
import type { DashboardResponse } from '../../../lib/types';

const BUCKETS: { key: keyof DashboardResponse['counts']; label: string; color: string }[] = [
  { key: 'expired', label: 'Expired', color: urgencyColors.expired },
  { key: 'critical', label: 'Critical', color: urgencyColors.critical },
  { key: 'soon', label: 'Soon', color: urgencyColors.soon },
  { key: 'upcoming', label: 'Upcoming', color: urgencyColors.upcoming },
  { key: 'ok', label: 'Good', color: urgencyColors.ok },
];

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function DashboardScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { data, isLoading, isRefetching, refetch, error } = useDashboard();
  const { data: categories } = useCategories();
  // The dashboard response only carries the top-10 expiring_soon items;
  // the calendar needs every active item's date to mark the full month.
  const { data: activeItems } = useItems({ status: 'active' });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.navy} />
      </View>
    );
  }

  if (error || !data) {
    return (
      <ErrorState
        title="Couldn't load the dashboard."
        message={(error as Error)?.message}
        onRetry={refetch}
      />
    );
  }

  const featuredItem = data.expiring_soon[0];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <View style={styles.header}>
        <Image source={require('../../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
        <Pressable hitSlop={10} onPress={signOut}>
          <Ionicons name="log-out-outline" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bucketRow}>
        {BUCKETS.map(({ key, label, color }) => (
          <View key={key} style={[styles.bucketCard, { borderColor: color }]}>
            <Text style={[styles.bucketLabel, { color }]}>{label}</Text>
            <Text style={[styles.bucketCount, { color }]}>{data.counts[key]}</Text>
          </View>
        ))}
      </ScrollView>

      {featuredItem && (
        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>Use {featuredItem.name} while it's at its best!</Text>
          <Text style={styles.tipBody}>
            Enjoy by <Text style={styles.tipDate}>{formatShortDate(featuredItem.effective_expiry_date)}</Text>
          </Text>
        </View>
      )}

      <Pressable style={styles.sectionHeader} onPress={() => router.push('/pantry')}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.navy} />
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryRow}>
        {categories?.map((c) => (
          <Pressable
            key={c.id}
            style={styles.categoryItem}
            onPress={() => router.push({ pathname: '/pantry', params: { category: c.id } })}
          >
            <View style={styles.categoryCircle}>
              <Ionicons name={iconForCategory(c.id)} size={26} color={colors.navy} />
            </View>
            <Text style={styles.categoryLabel} numberOfLines={1}>
              {c.label_en}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.calendarWrap}>
        <ExpiryCalendar
          items={activeItems?.items ?? []}
          onSelectDate={(iso) =>
            router.push({ pathname: '/pantry', params: { expiryDate: iso } })
          }
        />
      </View>

      <Text style={styles.sectionTitle2}>Expiring soon</Text>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  logo: {
    width: 110,
    height: 36,
  },
  bucketRow: {
    flexGrow: 0,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  bucketCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
    alignItems: 'flex-start',
    backgroundColor: colors.white,
  },
  bucketLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  bucketCount: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  tipCard: {
    backgroundColor: colors.tipCard,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 18,
    gap: 6,
  },
  tipTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.navy,
    lineHeight: 22,
  },
  tipBody: {
    fontSize: 13,
    color: colors.textMuted,
  },
  tipDate: {
    color: urgencyColors.soon,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.navy,
  },
  sectionTitle2: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 16,
    color: colors.navy,
  },
  categoryRow: {
    flexGrow: 0,
    paddingHorizontal: 16,
  },
  categoryItem: {
    alignItems: 'center',
    width: 80,
    marginRight: 8,
    gap: 6,
  },
  categoryCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.creamCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: {
    fontSize: 12,
    color: colors.navy,
    textAlign: 'center',
  },
  calendarWrap: {
    marginTop: 20,
  },
  empty: {
    color: colors.textMuted,
    paddingHorizontal: 16,
  },
});
