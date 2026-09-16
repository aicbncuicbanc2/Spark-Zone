import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { colors, fontSize } from '../lib/theme';
import type { Item } from '../lib/types';
import { UrgencyBadge, urgencyLabel } from './UrgencyBadge';

/** Renders `text` with every case-insensitive occurrence of `query` bolded
 * - so a search result doesn't just get a "why this matched" line, the
 * actual matched letters are visibly called out wherever they appear. */
function Highlighted({
  text,
  query,
  style,
  numberOfLines,
}: {
  text: string;
  query: string;
  style: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  if (!query) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lowerText.indexOf(lowerQuery, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <Text key={key++} style={styles.highlight}>
        {text.slice(idx, idx + query.length)}
      </Text>
    );
    i = idx + query.length;
  }

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts}
    </Text>
  );
}

type Props = {
  item: Item;
  onPress: () => void;
  /** False on lists that are already scoped to one urgency (e.g. a
   * dashboard "Expired" list) — repeating the same badge on every row there
   * is just noise. The "Xd left/ago" text still shows either way. */
  showBadge?: boolean;
  /** Why this item is in a search's results, when that reason isn't
   * already visible above (name/brand/storage_location) - e.g. "Bought at
   * Guardian Pharmacy" when the match came from purchase_location. Absent
   * when no search is active or the match is already obvious. */
  matchLabel?: string;
  /** The active search text (if any) - bolded wherever it appears in
   * name/brand/storage_location/matchLabel below. */
  highlightQuery?: string;
};

export function ItemRow({ item, onPress, showBadge = true, matchLabel, highlightQuery = '' }: Props) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.main}>
        <Highlighted text={item.name} query={highlightQuery} style={styles.name} numberOfLines={1} />
        <Highlighted
          text={[item.brand, item.storage_location].filter(Boolean).join(' · ')}
          query={highlightQuery}
          style={styles.meta}
          numberOfLines={1}
        />
        {matchLabel && (
          <Highlighted text={matchLabel} query={highlightQuery} style={styles.matchLabel} numberOfLines={1} />
        )}
      </View>
      <View style={styles.right}>
        {showBadge && <UrgencyBadge urgency={item.urgency} />}
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
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  matchLabel: {
    fontSize: fontSize.caption,
    color: colors.navy,
    fontStyle: 'italic',
  },
  highlight: {
    fontWeight: '800',
    color: colors.navy,
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
