import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../lib/theme';
import type { Item } from '../lib/types';
import { UrgencyBadge, urgencyLabel } from './UrgencyBadge';

export function ItemRow({ item, onPress }: { item: Item; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[item.brand, item.storage_location].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.right}>
        <UrgencyBadge urgency={item.urgency} />
        <Text style={styles.days}>{urgencyLabel(item.urgency, item.days_remaining)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  main: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.navy,
  },
  meta: {
    fontSize: 13,
    color: colors.textMuted,
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
  },
  days: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
