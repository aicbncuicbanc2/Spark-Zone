import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
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
import { HeaderLogo } from '../../../components/HeaderLogo';
import { useAuth } from '../../../contexts/AuthContext';
import { iconForCategory } from '../../../lib/categoryIcons';
import { useCategories, useDashboard, useItems } from '../../../lib/queries';
import { colors, fontSize, urgencyColors } from '../../../lib/theme';
import type { DashboardResponse, Item } from '../../../lib/types';

const BUCKETS: { key: keyof DashboardResponse['counts']; label: string; color: string }[] = [
  { key: 'expired', label: 'Expired', color: urgencyColors.expired },
  { key: 'critical', label: 'Critical', color: urgencyColors.critical },
  { key: 'soon', label: 'Soon', color: urgencyColors.soon },
  { key: 'upcoming', label: 'Upcoming', color: urgencyColors.upcoming },
  { key: 'ok', label: 'Good', color: urgencyColors.ok },
];

const AUTO_SWIPE_MS = 5_000;

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
  // pagingEnabled snaps to the ScrollView's OWN width, not each child's
  // width — the previous version made pages (windowWidth - 32) wide (to
  // leave a margin) while the ScrollView itself stayed windowWidth wide,
  // so every snap landed mid-gap and showed two half cards. Fix: each page
  // is the full window width, and the 16px gutter is padding *inside* the
  // page instead of a margin around a narrower card.
  const { width: windowWidth } = useWindowDimensions();
  const [pageIndex, setPageIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const pageIndexRef = useRef(0);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    pageIndexRef.current = idx;
    setPageIndex(idx);
  }

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      const next = (pageIndexRef.current + 1) % items.length;
      pageIndexRef.current = next;
      scrollRef.current?.scrollTo({ x: next * windowWidth, animated: true });
      setPageIndex(next);
    }, AUTO_SWIPE_MS);
    return () => clearInterval(timer);
  }, [items.length, windowWidth]);

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
          <View key={item.id} style={[styles.tipPage, { width: windowWidth }]}>
            <View style={styles.tipCard}>
              <TipCardBody item={item} />
            </View>
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

// Pressable's children-as-function form reports `hovered` on web only (it's
// always undefined on native, where hover has no meaning) - so this is a
// no-op there, not a bug. Icon color flips to white alongside the
// background so it stays visible against navy instead of vanishing.
function CategoryCircleButton({
  icon,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.categoryItem} onPress={onPress}>
      {({ hovered }: { hovered?: boolean }) => (
        <>
          <View style={[styles.categoryCircle, hovered && styles.categoryCircleHovered]}>
            <Ionicons name={icon} size={26} color={hovered ? colors.white : colors.navy} />
          </View>
          <Text style={styles.categoryLabel} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { data, isLoading, isRefetching, refetch, error } = useDashboard();
  const { data: categories } = useCategories();
  // The dashboard response only carries the top-10 expiring_soon items; the
  // calendar, category/location rows, and the "Use it before it's gone"
  // grouping below all need every active item, not just that capped top 10.
  const { data: activeItemsData } = useItems({ status: 'active' });
  const activeItems = activeItemsData?.items ?? [];

  const todayItems = useMemo(
    () => activeItems.filter((item) => item.days_remaining === 0),
    [activeItems]
  );

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

  // expiring_soon is already sorted ascending by days_remaining, so expired
  // (negative days) naturally sort before critical (0-1 days) — filtering
  // preserves that "all expired, then critical" order without re-sorting.
  const bannerItems = data.expiring_soon.filter(
    (item) => item.urgency === 'expired' || item.urgency === 'critical'
  );
  // storage_location is free text the user sets on Add — no backend list of
  // locations to fetch, so this is just whatever distinct values exist.
  const locations = Array.from(
    new Set(activeItems.map((item) => item.storage_location).filter((v): v is string => !!v))
  ).sort();

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <HeaderLogo />
          <View style={styles.headerActions}>
            <Pressable hitSlop={10} onPress={() => router.push('/settings')}>
              <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
            </Pressable>
            <Pressable hitSlop={10} onPress={signOut}>
              <Ionicons name="log-out-outline" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
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

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bucketRow}
          contentContainerStyle={styles.bucketRowContent}
        >
          {BUCKETS.map(({ key, label, color }) => (
            <Pressable
              key={key}
              style={({ hovered }) => [
                styles.bucketCard,
                { borderColor: color },
                hovered && styles.bucketCardHovered,
              ]}
              onPress={() =>
                router.push({
                  pathname: '/pantry',
                  // Pantry's "Active" status tab excludes expired-urgency
                  // items by definition, so the expired bucket needs its
                  // own status tab rather than an urgency filter on top of
                  // Active — anything else stays active + urgency-filtered.
                  params:
                    key === 'expired' ? { status: 'expired' } : { status: 'active', urgency: key },
                })
              }
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
            <CategoryCircleButton
              key={c.id}
              icon={iconForCategory(c.id)}
              label={c.label_en}
              onPress={() => router.push({ pathname: '/pantry', params: { category: c.id } })}
            />
          ))}
        </ScrollView>

        {locations.length > 0 && (
          <>
            <Pressable style={styles.sectionHeader} onPress={() => router.push('/pantry')}>
              <Text style={styles.sectionTitle}>Locations</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.navy} />
            </Pressable>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryRow}>
              {locations.map((loc) => (
                <CategoryCircleButton
                  key={loc}
                  icon="location-outline"
                  label={loc}
                  onPress={() => router.push({ pathname: '/pantry', params: { location: loc } })}
                />
              ))}
            </ScrollView>
          </>
        )}

        <View style={styles.calendarWrap}>
          <ExpiryCalendar
            items={activeItems}
            onSelectDate={(iso) => router.push({ pathname: '/pantry', params: { expiryDate: iso } })}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
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
    flexGrow: 0,
    // 6px less than the visual gap actually wanted - bucketRowContent's
    // paddingTop below makes up the difference, so the hover lift's
    // upward translateY (and its shadow) has room inside the scroll
    // container's own bounds instead of getting clipped by it.
    marginTop: 10,
  },
  bucketRowContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
  },
  bucketCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
    alignItems: 'center',
    backgroundColor: colors.white,
    // web-only, same as the category circles' hover fade - harmless no-op
    // on native, which has no hover state to transition into.
    ...(Platform.OS === 'web' ? { transitionProperty: 'box-shadow, transform', transitionDuration: '150ms' } : null),
  },
  bucketCardHovered: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    transform: [{ translateY: -2 }],
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
  tipPage: {
    paddingHorizontal: 16,
  },
  tipCard: {
    backgroundColor: colors.tipCard,
    borderRadius: 20,
    padding: 24,
    minHeight: 130,
    justifyContent: 'center',
    gap: 8,
  },
  tipTitle: {
    fontSize: fontSize.subheading,
    fontWeight: '700',
    color: colors.navy,
    lineHeight: 22,
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
    fontSize: fontSize.heading,
    fontWeight: '700',
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
    // transitionProperty/-Duration are web-only (react-native-web passes
    // them straight through as CSS) - harmless no-ops on native, where
    // there's no hover state to transition into in the first place.
    ...(Platform.OS === 'web' ? { transitionProperty: 'background-color', transitionDuration: '150ms' } : null),
  },
  categoryCircleHovered: {
    backgroundColor: colors.navy,
  },
  categoryLabel: {
    fontSize: 12,
    color: colors.navy,
    textAlign: 'center',
  },
  calendarWrap: {
    marginTop: 20,
    marginBottom: 32,
  },
});
