import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../lib/theme';
import type { Item } from '../lib/types';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Props = {
  /** Active items — used to mark which days have something expiring. */
  items: Item[];
  onSelectDate?: (isoDate: string) => void;
};

/**
 * A hand-built month calendar (no date library) — 7 even columns spanning
 * the full card width like a real calendar app, not a small fixed-size
 * cluster. Marks any day with at least one active item's
 * effective_expiry_date on it.
 */
export function ExpiryCalendar({ items, onSelectDate }: Props) {
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const markedDays = useMemo(() => {
    const marks = new Set<string>();
    for (const item of items) {
      marks.add(item.effective_expiry_date);
    }
    return marks;
  }, [items]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to a whole number of weeks so every row has 7 cells, like a real
  // calendar grid (not a ragged last row).
  while (cells.length % 7 !== 0) cells.push(null);

  function isoFor(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => setViewDate(new Date(year, month - 1, 1))}>
          <Ionicons name="chevron-back" size={20} color={colors.navy} />
        </Pressable>
        <Text style={styles.headerText}>
          {MONTH_NAMES[month]} {year}
        </Text>
        <Pressable hitSlop={10} onPress={() => setViewDate(new Date(year, month + 1, 1))}>
          <Ionicons name="chevron-forward" size={20} color={colors.navy} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d) => (
          <View key={d} style={styles.cell}>
            <Text style={styles.weekday}>{d}</Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, idx) => {
          if (day == null) return <View key={`empty-${idx}`} style={styles.cell} />;
          const iso = isoFor(day);
          const isMarked = markedDays.has(iso);
          const isToday = iso === todayIso;
          return (
            <View key={iso} style={styles.cell}>
              <Pressable
                style={[
                  styles.dayCircle,
                  isMarked && styles.dayCircleMarked,
                  isToday && !isMarked && styles.dayCircleToday,
                ]}
                onPress={() => onSelectDate?.(iso)}
              >
                <Text style={[styles.dayText, isMarked && styles.dayTextMarked]}>{day}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginBottom: 10,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.navy,
  },
  weekRow: {
    flexDirection: 'row',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekday: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  dayCircle: {
    width: '78%',
    height: '78%',
    maxWidth: 36,
    maxHeight: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleMarked: {
    backgroundColor: colors.navy,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  dayText: {
    fontSize: 14,
    color: colors.navy,
  },
  dayTextMarked: {
    color: colors.white,
    fontWeight: '700',
  },
});
