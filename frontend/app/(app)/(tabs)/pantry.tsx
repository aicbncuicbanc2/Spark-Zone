import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryPicker } from '../../../components/CategoryPicker';
import { ErrorState } from '../../../components/ErrorState';
import { ItemRow } from '../../../components/ItemRow';
import { useAllStatusItems, useCategories, useItems } from '../../../lib/queries';
import { colors, fontSize, logoSize, statusColors, urgencyColors } from '../../../lib/theme';
import type { ItemStatus, Urgency } from '../../../lib/types';

type StatusFilter = ItemStatus | 'all';
const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'consumed', 'discarded', 'expired'];
const SORTS = ['expiry', 'name', 'created'] as const;

// Same 5 states and colors as HomeScreen's bucket row - kept as a separate
// constant (not imported) since urgency here drives a chip filter, not a
// count display, and the two screens' styling needs may drift independently.
const URGENCIES: { key: Urgency; label: string; color: string }[] = [
  { key: 'expired', label: 'Expired', color: urgencyColors.expired },
  { key: 'critical', label: 'Critical', color: urgencyColors.critical },
  { key: 'soon', label: 'Soon', color: urgencyColors.soon },
  { key: 'upcoming', label: 'Upcoming', color: urgencyColors.upcoming },
  { key: 'ok', label: 'OK', color: urgencyColors.ok },
];

export default function PantryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Arrives here from the dashboard's bucket cards, category/location
  // circles, or calendar days.
  const params = useLocalSearchParams<{
    category?: string;
    location?: string;
    expiryDate?: string;
    urgency?: Urgency;
    status?: StatusFilter;
  }>();

  const [status, setStatus] = useState<StatusFilter>(params.status ?? 'active');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [location, setLocation] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  // Seeded from the ?urgency= param Home's bucket row / calendar passes in,
  // so tapping "Critical" there lands here pre-filtered; after that it's
  // just local UI state the user can change or clear like any other chip.
  const [urgency, setUrgency] = useState<Urgency | undefined>(params.urgency);
  // storage_location has no backend list to create against (see the
  // `locations` useMemo below) — a location a user "adds" here just gets
  // remembered locally for the rest of this session so it's selectable as
  // a filter immediately, the same way it'd show up once a real item
  // actually used it.
  const [customLocations, setCustomLocations] = useState<string[]>([]);
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [sortIndex, setSortIndex] = useState(0);
  const sort = SORTS[sortIndex];
  // All the filter controls (status/category/location/urgency/sort) live
  // inside one modal sheet behind a single "Filters" button instead of
  // five permanently-visible rows stacked above the list — that stack was
  // the actual clutter, not any one filter on its own.
  const [filtersVisible, setFiltersVisible] = useState(false);

  useEffect(() => {
    if (params.category) setCategory(params.category);
  }, [params.category]);

  useEffect(() => {
    if (params.location) setLocation(params.location);
  }, [params.location]);

  // Pantry is a tab screen, so it stays mounted while the user is on Home —
  // tapping a dashboard bucket doesn't remount this screen, it just updates
  // these params in place. Without syncing on every change (not just at
  // mount, like the initial useState above covers), a second bucket tap
  // landed on whatever status/urgency was already showing: tapping
  // "Expired" after "Critical" combined status=active (stale) with
  // urgency=expired, and since Active excludes expired-urgency items by
  // definition, that combination always rendered an empty list.
  useEffect(() => {
    setStatus(params.status ?? 'active');
  }, [params.status]);

  useEffect(() => {
    setUrgency(params.urgency);
  }, [params.urgency]);

  const { data: categories } = useCategories();

  // No item's `status` column is ever actually written as "expired" - only
  // /consume and /discard exist as resolution actions, so a real backend
  // filter on status=expired always comes back empty. "Expired" instead
  // means "active, but its date has already passed", split client-side by
  // urgency; "All" merges the three *real* statuses (active/consumed/
  // discarded) - fetching "active" already includes expired-but-unresolved
  // items too, so there's no separate backend status to fetch for
  // "expired" either.
  const showAllStatuses = status === 'all';
  const backendStatus = showAllStatuses || status === 'expired' ? 'active' : status;
  const singleStatusQuery = useItems(showAllStatuses ? undefined : { status: backendStatus, category, sort });
  const allStatusQuery = useAllStatusItems({ category, sort });

  const fetchedItems = showAllStatuses ? allStatusQuery.items : singleStatusQuery.data?.items ?? [];
  const isLoading = showAllStatuses ? allStatusQuery.isLoading : singleStatusQuery.isLoading;
  const isRefetching = showAllStatuses ? allStatusQuery.isRefetching : singleStatusQuery.isRefetching;
  const error = showAllStatuses ? allStatusQuery.error : singleStatusQuery.error;
  const refetch = showAllStatuses ? allStatusQuery.refetch : singleStatusQuery.refetch;

  const categoryLabel = (id: string) => categories?.find((c) => c.id === id)?.label_en ?? '';

  // storage_location is already a free-text field on every item (users set
  // it themselves via the Add form, no backend list to manage) — the list
  // of "locations" to filter by is just whatever distinct values are
  // actually in use, derived from what's loaded rather than a fixed set.
  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const item of fetchedItems) {
      if (item.storage_location) set.add(item.storage_location);
    }
    for (const loc of customLocations) set.add(loc);
    return Array.from(set).sort();
  }, [fetchedItems, customLocations]);

  function handleAddLocation() {
    const trimmed = newLocation.trim();
    if (!trimmed) return;
    setCustomLocations((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setLocation(trimmed);
    setNewLocation('');
    setIsAddingLocation(false);
  }

  const items = useMemo(() => {
    let list = fetchedItems;
    if (status === 'active') {
      list = list.filter((item) => item.urgency !== 'expired');
    } else if (status === 'expired') {
      list = list.filter((item) => item.urgency === 'expired');
    }
    if (params.expiryDate) {
      list = list.filter((item) => item.effective_expiry_date === params.expiryDate);
    }
    if (urgency) {
      list = list.filter((item) => item.urgency === urgency);
    }
    if (location) {
      list = list.filter((item) => item.storage_location === location);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((item) =>
        [
          item.name,
          item.brand,
          item.storage_location,
          item.notes,
          item.expiry_date,
          item.effective_expiry_date,
          categoryLabel(item.category_id ?? ''),
        ]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(q))
      );
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedItems, search, params.expiryDate, status, urgency, location, categories]);

  const activeFilterCount =
    (status !== 'active' ? 1 : 0) +
    (category ? 1 : 0) +
    (location ? 1 : 0) +
    (urgency ? 1 : 0) +
    (sort !== 'expiry' ? 1 : 0);

  function resetFilters() {
    setStatus('active');
    setCategory(undefined);
    setLocation(undefined);
    setUrgency(undefined);
    setSortIndex(0);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Image source={require('../../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, brand, date…"
            placeholderTextColor={colors.textMuted}
          />
          <Ionicons name="search" size={18} color={colors.textMuted} />
        </View>
      </View>

      {params.expiryDate && (
        <View style={styles.filterBanner}>
          <Text style={styles.filterBannerText}>Filtered: expiring {params.expiryDate}</Text>
          <Pressable onPress={() => router.setParams({ expiryDate: undefined })}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      <View style={styles.filterBar}>
        <Pressable style={styles.filterButton} onPress={() => setFiltersVisible(true)}>
          <Ionicons name="options-outline" size={16} color={colors.navy} />
          <Text style={styles.filterButtonText}>Filters</Text>
          {activeFilterCount > 0 && (
            <View style={styles.filterCountBadge}>
              <Text style={styles.filterCountText}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
        <Text style={styles.resultCount}>
          {items.length} item{items.length === 1 ? '' : 's'}
        </Text>
      </View>

      <Modal
        visible={filtersVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFiltersVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setFiltersVisible(false)} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filters</Text>
            <Pressable hitSlop={10} onPress={() => setFiltersVisible(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalSectionTitle}>Status</Text>
            <View style={styles.wrapRow}>
              {STATUS_FILTERS.map((s) => {
                const isSelected = status === s;
                const c = s === 'all' ? colors.navy : statusColors[s];
                return (
                  <Pressable
                    key={s}
                    style={[styles.statusChip, { borderColor: c }, isSelected && { backgroundColor: c }]}
                    onPress={() => setStatus(s)}
                  >
                    <Text style={[styles.statusChipText, { color: isSelected ? colors.white : c }]}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modalSectionTitle}>Category</Text>
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

            <Text style={styles.modalSectionTitle}>Location</Text>
            <View style={styles.wrapRow}>
              <Pressable
                style={[styles.chip, styles.chipRowContent, !location && styles.chipActive]}
                onPress={() => setLocation(undefined)}
              >
                <Ionicons
                  name="location-outline"
                  size={13}
                  color={!location ? colors.white : colors.textMuted}
                />
                <Text style={[styles.chipText, !location && styles.chipTextActive]}>Any location</Text>
              </Pressable>
              {locations.map((loc) => (
                <Pressable
                  key={loc}
                  style={[styles.chip, location === loc && styles.chipActive]}
                  onPress={() => setLocation(loc)}
                >
                  <Text style={[styles.chipText, location === loc && styles.chipTextActive]}>{loc}</Text>
                </Pressable>
              ))}
              <Pressable
                style={styles.squareNewButton}
                onPress={() => setIsAddingLocation((v) => !v)}
              >
                <Ionicons name={isAddingLocation ? 'close' : 'add'} size={18} color={colors.navy} />
              </Pressable>
            </View>
            {isAddingLocation && (
              <View style={styles.createRow}>
                <TextInput
                  style={styles.createInput}
                  value={newLocation}
                  onChangeText={setNewLocation}
                  placeholder="e.g. Fridge door"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                  onSubmitEditing={handleAddLocation}
                />
                <Pressable
                  style={[styles.createButton, !newLocation.trim() && styles.createButtonDisabled]}
                  disabled={!newLocation.trim()}
                  onPress={handleAddLocation}
                >
                  <Text style={styles.createButtonText}>Add</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.modalSectionTitle}>Urgency</Text>
            <View style={styles.wrapRow}>
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
            </View>

            <Text style={styles.modalSectionTitle}>Sort by</Text>
            <View style={styles.wrapRow}>
              {SORTS.map((s, i) => (
                <Pressable
                  key={s}
                  style={[styles.chip, sortIndex === i && styles.chipActive]}
                  onPress={() => setSortIndex(i)}
                >
                  <Text style={[styles.chipText, sortIndex === i && styles.chipTextActive]}>
                    {s === 'expiry' ? 'Expiry date' : s === 'name' ? 'Name' : 'Newest'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <Pressable style={styles.resetButton} onPress={resetFilters}>
              <Text style={styles.resetButtonText}>Reset filters</Text>
            </Pressable>
            <Pressable style={styles.doneButton} onPress={() => setFiltersVisible(false)}>
              <Text style={styles.doneButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : error ? (
        <ErrorState title="Couldn't load items." message={(error as Error).message} onRetry={refetch} />
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
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.empty}>
                {search.trim()
                  ? `No items match "${search.trim()}".`
                  : status === 'active' && !category
                    ? 'No items yet — use the Scan tab to add your first one.'
                    : `No ${status === 'all' ? '' : status} items${category ? ' in this category' : ''}.`}
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
    paddingBottom: 8,
    flexShrink: 0,
  },
  logo: {
    width: logoSize.width,
    height: logoSize.height,
    // The adjacent searchBox below is flex:1, competing for the row's
    // space - without this, the logo (a normal flex child with the
    // default flexShrink:1) got compressed smaller than its real
    // width/height to make room for it, which is why this was the one
    // header of the three where the wordmark rendered visibly smaller.
    flexShrink: 0,
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
  filterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.creamCard,
  },
  filterBannerText: {
    fontSize: 12,
    color: colors.navy,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
    flexShrink: 0,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.navy,
  },
  filterCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
  },
  resultCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalSheet: {
    maxHeight: '80%',
    backgroundColor: colors.cream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: fontSize.subheading,
    fontWeight: '700',
    color: colors.navy,
  },
  modalContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  modalSectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 18,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  resetButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  doneButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 12,
  },
  doneButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.white,
  },
  statusChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  chipRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  squareNewButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  createRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  createInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: fontSize.body,
    backgroundColor: colors.white,
  },
  createButton: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: colors.white,
    fontWeight: '600',
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
  list: {
    flex: 1,
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
    fontSize: fontSize.body,
    textAlign: 'center',
    color: colors.textMuted,
  },
});
