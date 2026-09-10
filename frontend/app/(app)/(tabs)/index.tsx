import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../../components/ErrorState';
import { ExpiryCalendar } from '../../../components/ExpiryCalendar';
import { ItemRow } from '../../../components/ItemRow';
import { useAuth } from '../../../contexts/AuthContext';
import { iconForCategory } from '../../../lib/categoryIcons';
import { useCategories, useDashboard, useItems } from '../../../lib/queries';
import { colors, urgencyColors } from '../../../lib/theme';
import type { DashboardResponse, Item } from '../../../lib/types';

const BUCKETS: { key: keyof DashboardResponse['counts']; label: string; color: string }[] = [
  { key: 'expired', label: 'Expired', color: urgencyColors.expired },
  { key: 'critical', label: 'Critical', color: urgencyColors.critical },
  { key: 'soon', label: 'Soon', color: urgencyColors.soon },
  { key: 'upcoming', label: 'Upcoming', color: urgencyColors.upcoming },
  { key: 'ok', label: 'Good', color: urgencyColors.ok },
];

const AUTO_SWIPE_MS = 10_000;

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TipCardBody({ item }: { item: Item }) {
  const dateText = formatShortDate(item.effective_expiry_date);
  const dateSpan = <Text style={{ color: urgencyColors[item.urgency], fontWeight: '700' }}>{dateText}</Text>;

  if (item.urgency === 'expired') {
    return (
      <>
        <Text style={styles.tipTitle}>
          {item.name} reached its end date on {dateSpan}.
        </Text>
        <Text style={styles.tipBody}>Please replace with a fresh one!</Text>
      </>
    );
  }
  return (
    <>
      <Text style={styles.tipTitle}>Time to finish {item.name}!</Text>
      <Text style={styles.tipBody}>Best used before {dateSpan}</Text>
    </>
  );
}

function TipCarousel({ items }: { items: Item[] }) {
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = windowWidth - 32; // matches the 16px screen padding each side
  const [pageIndex, setPageIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const pageIndexRef = useRef(0);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    pageIndexRef.current = idx;
    setPageIndex(idx);
  }

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      const next = (pageIndexRef.current + 1) % items.length;
      pageIndexRef.current = next;
      scrollRef.current?.scrollTo({ x: next * pageWidth, animated: true });
      setPageIndex(next);
    }, AUTO_SWIPE_MS);
    return () => clearInterval(timer);
  }, [items.length, pageWidth]);

  if (items.length === 0) return null;

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={styles.tipScroll}
      >
        {items.map((item) => (
          <View key={item.id} style={[styles.tipCard, { width: pageWidth }]}>
            <TipCardBody item={item} />
          </View>
        ))}
      </ScrollView>
      {items.length > 1 && (
        <View style={styles.dots}>
          {items.map((item, i) => (
            <View key={item.id} style={[styles.dot, i === pageIndex && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { data, isLoading, isRefetching, refetch, error } = useDashboard();
  const { data: categories } = useCategories();
  // The dashboard response only carries the top-10 expiring_soon items;
  // the calendar and the "Expired" list below both need every active
  // item, not just that capped top 10.
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

  const expiredItems = (activeItems?.items ?? []).filter((item) => item.urgency === 'expired');
  // expiring_soon is already sorted ascending by days_remaining, so expired
  // (negative days) naturally sort before critical (0-1 days) — filtering
  // preserves that "all expired, then critical" order without re-sorting.
  const bannerItems = data.expiring_soon.filter(
    (item) => item.urgency === 'expired' || item.urgency === 'critical'
  );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Image source={require('../../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
        <Pressable hitSlop={10} onPress={signOut}>
          <Ionicons name="log-out-outline" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bucketRow}>
        {BUCKETS.map(({ key, label, color }) => (
          <Pressable
            key={key}
            style={[styles.bucketCard, { borderColor: color }]}
            onPress={() => router.push({ pathname: '/pantry', params: { urgency: key } })}
          >
            <Text style={[styles.bucketLabel, { color }]}>{label}</Text>
            <Text style={[styles.bucketCount, { color }]}>{data.counts[key]}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <TipCarousel items={bannerItems} />

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
          onSelectDate={(iso) => router.push({ pathname: '/pantry', params: { expiryDate: iso } })}
        />
      </View>

      <Text style={styles.sectionTitle2}>Expired</Text>
      {expiredItems.length === 0 ? (
        <Text style={styles.empty}>Nothing expired — nice.</Text>
      ) : (
        expiredItems.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            showBadge={false}
            onPress={() => router.push(`/item/${item.id}`)}
          />
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
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  bucketLabel: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  bucketCount: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  tipScroll: {
    marginTop: 16,
  },
  tipCard: {
    backgroundColor: colors.tipCard,
    borderRadius: 20,
    marginHorizontal: 16,
    padding: 24,
    minHeight: 130,
    justifyContent: 'center',
    gap: 8,
  },
  tipTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.navy,
    lineHeight: 25,
  },
  tipBody: {
    fontSize: 15,
    color: colors.textMuted,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.navy,
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
