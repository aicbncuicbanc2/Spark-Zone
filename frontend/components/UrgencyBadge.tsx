import { StyleSheet, Text, View } from 'react-native';

import type { Urgency } from '../lib/types';

const CONFIG: Record<Urgency, { label: string; bg: string; fg: string }> = {
  expired: { label: 'Expired', bg: '#fdecea', fg: '#c0392b' },
  critical: { label: 'Critical', bg: '#fdecea', fg: '#d35400' },
  soon: { label: 'Soon', bg: '#fef5e7', fg: '#b9770e' },
  upcoming: { label: 'Upcoming', bg: '#fef9e7', fg: '#9a7d0a' },
  ok: { label: 'OK', bg: '#eafaf1', fg: '#1e8449' },
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
  const { label, bg, fg } = CONFIG[urgency];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
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
