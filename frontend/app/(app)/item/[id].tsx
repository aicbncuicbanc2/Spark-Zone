import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UrgencyBadge, urgencyLabel } from '../../../components/UrgencyBadge';
import { useCategories, useItem, usePatchItem } from '../../../lib/queries';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item, isLoading, error } = useItem(id);
  const { data: categories } = useCategories();
  const patchMutation = usePatchItem(id);

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
  },
  brand: {
    fontSize: 15,
    color: '#777',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  daysText: {
    color: '#888',
  },
  card: {
    backgroundColor: '#f7f7f7',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: '#777',
    fontSize: 14,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  notice: {
    fontSize: 12,
    color: '#c0392b',
  },
  openButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  openButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  notes: {
    fontStyle: 'italic',
    color: '#555',
  },
});
