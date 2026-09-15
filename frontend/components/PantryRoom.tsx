import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { iconForCategory } from '../lib/categoryIcons';
import { colors, room, urgencyColors } from '../lib/theme';
import type { Category, Item, Urgency } from '../lib/types';

const URGENCY_PRIORITY: Urgency[] = ['expired', 'critical', 'soon', 'upcoming', 'ok'];
// How far up the character can be dragged before it stops following the
// finger, in px.
const TRAVEL_RANGE = 46;

type Props = {
  categories: Category[] | undefined;
  items: Item[];
  onSelectCategory: (categoryId: string) => void;
};

function worstUrgency(items: Item[]): Urgency | null {
  for (const u of URGENCY_PRIORITY) {
    if (items.some((item) => item.urgency === u)) return u;
  }
  return null;
}

function ShelfSlot({
  category,
  count,
  urgency,
  onPress,
}: {
  category: Category;
  count: number;
  urgency: Urgency | null;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.shelf} onPress={onPress}>
      <View style={styles.shelfIconWrap}>
        <Ionicons name={iconForCategory(category.id)} size={22} color={colors.navy} />
        {urgency && <View style={[styles.shelfDot, { backgroundColor: urgencyColors[urgency] }]} />}
      </View>
      <Text style={styles.shelfLabel} numberOfLines={1}>
        {category.label_en}
      </Text>
      <Text style={styles.shelfCount}>{count}</Text>
    </Pressable>
  );
}

/**
 * A stylised "shelves either side of an aisle" take on the category
 * browser - each shelf is a real category (icon, item count, and a dot for
 * the most urgent item it holds, reusing the same urgency palette as
 * everywhere else in the app), tapping one opens Pantry filtered to it,
 * same as the plain icon row this replaces. The figure in the aisle
 * follows a vertical drag (swipe up) within a small range, then eases
 * back to rest on release - a small delight layered on top of the same
 * real data, not a separate view to keep in sync.
 */
export function PantryRoom({ categories, items, onSelectCategory }: Props) {
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderMove: (_evt, gesture) => {
        // Only follows an upward swipe (negative dy) - a downward drag is
        // clamped to the resting position rather than pushing the figure
        // below where it started.
        const dy = Math.min(0, Math.max(-TRAVEL_RANGE, gesture.dy));
        translateY.setValue(dy);
      },
      onPanResponderRelease: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 5 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 5 }).start();
      },
    })
  ).current;

  const { left, right } = useMemo(() => {
    const sorted = [...(categories ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const l: Category[] = [];
    const r: Category[] = [];
    sorted.forEach((c, i) => (i % 2 === 0 ? l : r).push(c));
    return { left: l, right: r };
  }, [categories]);

  function statsFor(categoryId: string) {
    const inCategory = items.filter((item) => item.category_id === categoryId);
    return { count: inCategory.length, urgency: worstUrgency(inCategory) };
  }

  if (!categories || categories.length === 0) return null;

  return (
    <View style={styles.room}>
      <View style={styles.wall} />
      <View style={styles.floor} />
      <View style={styles.row}>
        <View style={styles.column}>
          {left.map((c) => {
            const { count, urgency } = statsFor(c.id);
            return (
              <ShelfSlot
                key={c.id}
                category={c}
                count={count}
                urgency={urgency}
                onPress={() => onSelectCategory(c.id)}
              />
            );
          })}
        </View>

        <View style={styles.aisle} {...panResponder.panHandlers}>
          <View style={styles.rug} />
          <Animated.View style={[styles.character, { transform: [{ translateY }] }]}>
            <View style={styles.characterHead} />
            <View style={styles.characterBody}>
              <Ionicons name="shirt-outline" size={16} color={colors.white} style={styles.characterBodyIcon} />
            </View>
          </Animated.View>
          <Text style={styles.aisleHint}>Swipe up</Text>
        </View>

        <View style={styles.column}>
          {right.map((c) => {
            const { count, urgency } = statsFor(c.id);
            return (
              <ShelfSlot
                key={c.id}
                category={c}
                count={count}
                urgency={urgency}
                onPress={() => onSelectCategory(c.id)}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  room: {
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  wall: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 36,
    backgroundColor: room.wall,
  },
  floor: {
    position: 'absolute',
    top: 36,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: room.floor,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 44,
    paddingBottom: 12,
    gap: 8,
  },
  column: {
    flex: 1,
    gap: 8,
  },
  shelf: {
    backgroundColor: room.shelf,
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  shelfIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: room.aisle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  shelfDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: room.shelf,
  },
  shelfLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.white,
  },
  shelfCount: {
    fontSize: 11,
    color: '#E7DACB',
  },
  aisle: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  rug: {
    position: 'absolute',
    bottom: 6,
    width: 52,
    height: 22,
    borderRadius: 999,
    backgroundColor: room.aisle,
  },
  character: {
    alignItems: 'center',
    marginBottom: 10,
  },
  characterHead: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E8C39E',
    marginBottom: -2,
    zIndex: 1,
  },
  characterBody: {
    width: 26,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.navy,
    alignItems: 'center',
    paddingTop: 6,
  },
  characterBodyIcon: {
    opacity: 0.85,
  },
  aisleHint: {
    position: 'absolute',
    top: 4,
    fontSize: 10,
    color: colors.textMuted,
  },
});
