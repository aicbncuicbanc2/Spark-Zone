import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UrgencyBadge, urgencyLabel } from '../../../components/UrgencyBadge';
import { alert } from '../../../lib/alert';
import { exportToCalendar } from '../../../lib/ics';
import {
  useCategories,
  useConsumeItem,
  useDiscardItem,
  useItem,
  useItemSuggestions,
  usePatchItem,
} from '../../../lib/queries';
import { colors } from '../../../lib/theme';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function ItemDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item, isLoading, error } = useItem(id);
  const { data: categories } = useCategories();
  const patchMutation = usePatchItem(id);
  const consumeMutation = useConsumeItem(id);
  const discardMutation = useDiscardItem(id);
  const suggestionsMutation = useItemSuggestions();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !item) {
    return (
      <View style={styles.center}>
        <Text>Couldn't load this item.</Text>
      </View>
    );
  }

  const category = categories?.find((c) => c.id === item.category_id);
  const dateWasShortened = item.effective_expiry_date !== item.expiry_date;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{item.name}</Text>
      {item.brand && <Text style={styles.brand}>{item.brand}</Text>}

      <View style={styles.badgeRow}>
        <UrgencyBadge urgency={item.urgency} />
        <Text style={styles.daysText}>{urgencyLabel(item.urgency, item.days_remaining)}</Text>
      </View>

      <View style={styles.card}>
        <Row label="Effective expiry" value={item.effective_expiry_date} />
        <Row label="Printed expiry" value={item.expiry_date} />
        {dateWasShortened && (
          <Text style={styles.notice}>
            Shortened by opening — period-after-opening runs out before the printed date.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Row label="Category" value={category?.label_en ?? item.category_id ?? 'Uncategorised'} />
        <Row label="Quantity" value={`${item.quantity} ${item.unit ?? ''}`.trim()} />
        {item.storage_location && <Row label="Storage" value={item.storage_location} />}
        <Row label="Date source" value={item.date_source === 'ocr' ? 'Scanned (OCR)' : 'Entered manually'} />
        <Row label="Status" value={item.status} />
      </View>

      <View style={styles.card}>
        {item.opened_at ? (
          <Row label="Opened" value={`${item.opened_at}${item.pao_months ? ` · PAO ${item.pao_months}mo` : ''}`} />
        ) : (
          <Pressable
            style={styles.openButton}
            disabled={patchMutation.isPending}
            onPress={() =>
              patchMutation.mutate({
                opened_at: new Date().toISOString().slice(0, 10),
                pao_months: category?.default_pao_months ?? null,
              })
            }
          >
            <Text style={styles.openButtonText}>
              {patchMutation.isPending ? 'Marking opened…' : 'Mark as opened'}
            </Text>
          </Pressable>
        )}
      </View>

      {item.notes && (
        <View style={styles.card}>
          <Text style={styles.notes}>{item.notes}</Text>
        </View>
      )}

      <View style={styles.aiCard}>
        <Text style={styles.aiLabel}>AI suggestion</Text>
        {suggestionsMutation.data ? (
          suggestionsMutation.data.suggestions.length > 0 ? (
            <View style={styles.aiList}>
              {suggestionsMutation.data.suggestions.map((suggestion, index) => (
                <Text key={index} style={styles.aiSuggestion}>
                  •  {suggestion}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.aiEmpty}>No suggestions available right now.</Text>
          )
        ) : (
          <Pressable
            style={styles.aiButton}
            disabled={suggestionsMutation.isPending}
            onPress={() => suggestionsMutation.mutate(item)}
          >
            <Text style={styles.aiButtonText}>
              {suggestionsMutation.isPending ? 'Thinking…' : 'What should I use this for?'}
            </Text>
          </Pressable>
        )}
        {suggestionsMutation.isError && (
          <Text style={styles.aiEmpty}>Couldn't get a suggestion — try again in a moment.</Text>
        )}
      </View>

      <Pressable
        style={styles.calendarButton}
        onPress={() =>
          exportToCalendar([item], item.name).catch((error) =>
            alert('Could not export', (error as Error).message)
          )
        }
      >
        <Text style={styles.calendarButtonText}>Add to Calendar</Text>
      </Pressable>

      {item.status === 'active' ? (
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionButton, styles.consumeButton]}
            disabled={consumeMutation.isPending || discardMutation.isPending}
            onPress={() => consumeMutation.mutate(undefined, { onSuccess: () => router.back() })}
          >
            <Text style={styles.actionButtonText}>
              {consumeMutation.isPending ? 'Marking used…' : 'Used it'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.discardButton]}
            disabled={consumeMutation.isPending || discardMutation.isPending}
            onPress={() =>
              alert('Bin this item?', `"${item.name}" will be marked as discarded.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Bin it',
                  style: 'destructive',
                  onPress: () => discardMutation.mutate(undefined, { onSuccess: () => router.back() }),
                },
              ])
            }
          >
            <Text style={styles.actionButtonText}>
              {discardMutation.isPending ? 'Binning…' : 'Binned it'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.resolvedNotice}>
          Marked {item.status} {item.resolved_at ? `on ${item.resolved_at.slice(0, 10)}` : ''}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.navy,
  },
  brand: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  daysText: {
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.creamCard,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
    color: colors.navy,
  },
  notice: {
    fontSize: 12,
    color: colors.danger,
  },
  openButton: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  openButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  notes: {
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  aiCard: {
    backgroundColor: colors.creamCard,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.navy,
  },
  aiLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.navyMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiButton: {
    alignSelf: 'flex-start',
  },
  aiButtonText: {
    color: colors.navy,
    fontWeight: '600',
    fontSize: 15,
  },
  aiList: {
    gap: 6,
  },
  aiSuggestion: {
    fontSize: 14,
    color: colors.navy,
    lineHeight: 20,
  },
  aiEmpty: {
    fontSize: 13,
    color: colors.textMuted,
  },
  calendarButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  calendarButtonText: {
    color: colors.navy,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  consumeButton: {
    backgroundColor: '#1e8449',
  },
  discardButton: {
    backgroundColor: colors.danger,
  },
  actionButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  resolvedNotice: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 13,
  },
});
