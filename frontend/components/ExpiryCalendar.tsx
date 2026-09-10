import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../lib/theme';
import type { Item } from '../lib/types';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

type Props = {
  /** Active items — used to mark which days have something expiring. */
  items: Item[];
  onSelectDate?: (isoDate: string) => void;
};

/**
 * A simple hand-built month calendar (no date library) — marks any day
 * that has at least one active item's effective_expiry_date on it. There's
 * no month/year picker wheel, just the prev/next arrows; the mockup showed
 * dropdown chevrons but a full picker is extra scope for a v1.
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

  function isoFor(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable
          hitSlop={10}
          onPress={() => setViewDate(new Date(year, month - 1, 1))}
        >
          <Ionicons name="chevron-back" size={20} color={colors.navy} />
        </Pressable>
        <Text style={styles.headerText}>
          {MONTH_NAMES[month]} {year}
        </Text>
        <Pressable
          hitSlop={10}
          onPress={() => setViewDate(new Date(year, month + 1, 1))}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.navy} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d) => (
          <Text key={d} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, idx) => {
          if (day == null) return <View key={`empty-${idx}`} style={styles.cell} />;
          const iso = isoFor(day);
          const isMarked = markedDays.has(iso);
          const isToday = iso === todayIso;
          return (
            <Pressable
              key={iso}
              style={styles.cell}
              onPress={() => onSelectDate?.(iso)}
            >
              <View style={[styles.dayCircle, isMarked && styles.dayCircleMarked]}>
                <Text
                  style={[
                    styles.dayText,
                    isMarked && styles.dayTextMarked,
                    isToday && !isMarked && styles.dayTextToday,
                  ]}
                >
                  {day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const CELL_SIZE = 36;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 8,
  },
  headerText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.navy,
    minWidth: 90,
    textAlign: 'center',
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekday: {
    width: CELL_SIZE,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleMarked: {
    backgroundColor: colors.navy,
  },
  dayText: {
    fontSize: 14,
    color: colors.navy,
  },
  dayTextMarked: {
    color: colors.white,
    fontWeight: '700',
  },
  dayTextToday: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
