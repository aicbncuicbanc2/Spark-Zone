import { StyleSheet, Text, View } from 'react-native';

import { urgencyColors } from '../lib/theme';
import type { Urgency } from '../lib/types';

const LABELS: Record<Urgency, string> = {
  expired: 'Expired',
  critical: 'Critical',
  soon: 'Soon',
  upcoming: 'Upcoming',
  ok: 'Good',
};

// Light tints of the same urgencyColors used everywhere else (bucket cards,
// tip card date text) — kept as one pairing here rather than computed, so
// bg/fg always read as a matched pair.
const BG: Record<Urgency, string> = {
  expired: '#F8E2E2',
  critical: '#FBE0DD',
  soon: '#FBE7D3',
  upcoming: '#EAF0DA',
  ok: '#DFF3E7',
};

export function urgencyLabel(urgency: Urgency, daysRemaining: number): string {
  if (urgency === 'expired') {
    const daysAgo = Math.abs(daysRemaining);
    return daysAgo === 0 ? 'Expired today' : `Expired ${daysAgo}d ago`;
  }
  if (daysRemaining === 0) return 'Expires today';
  if (daysRemaining === 1) return 'Expires tomorrow';
  return `${daysRemaining}d left`;
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <View style={[styles.badge, { backgroundColor: BG[urgency] }]}>
      <Text style={[styles.text, { color: urgencyColors[urgency] }]}>{LABELS[urgency]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
