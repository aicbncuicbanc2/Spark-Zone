import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CategoryPicker } from '../../components/CategoryPicker';
import { useCategories, useCreateItem } from '../../lib/queries';
import { colors, fontSize } from '../../lib/theme';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Accepts a single-digit month/day while the user is still typing (e.g.
// "2026-9-1") so the submit button doesn't lock up before normalizeDate
// pads it — canSubmit is checked against this, not the strict DATE_RE.
const LOOSE_DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

// "2026-9-1" -> "2026-09-01". Users naturally skip the leading zero on a
// single-digit month or day; the API and DATE_RE both require it.
function normalizeExpiryDate(raw: string): string {
  const match = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return raw;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

type ScanParams = {
  scan_id?: string;
  name?: string;
  brand?: string;
  category_id?: string;
  expiry_date?: string;
  needs_review?: string;
  review_reason?: string;
  alternatives?: string;
};

export default function AddItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<ScanParams>();
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const createMutation = useCreateItem();

  const scanId = params.scan_id || null;
  // The value OCR suggested, so we can tell on submit whether the user kept
  // it (date_source: "ocr") or corrected it (date_source: "user") — that's
  // how the team measures OCR accuracy.
  const [ocrExpiryDate] = useState(params.expiry_date ?? '');
  const alternativeDates: string[] = params.alternatives ? JSON.parse(params.alternatives) : [];

  const [name, setName] = useState(params.name ?? '');
  const [brand, setBrand] = useState(params.brand ?? '');
  const [categoryId, setCategoryId] = useState<string | undefined>(params.category_id || undefined);
  const [expiryDate, setExpiryDate] = useState(params.expiry_date ?? '');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && LOOSE_DATE_RE.test(expiryDate) && !createMutation.isPending;

  function handleSubmit() {
    setFormError(null);
    if (!name.trim()) return setFormError('Name is required.');

    const normalizedDate = normalizeExpiryDate(expiryDate);
    if (!DATE_RE.test(normalizedDate)) return setFormError('Expiry date must be YYYY-MM-DD.');
    if (normalizedDate !== expiryDate) setExpiryDate(normalizedDate);

    const dateWasEdited = normalizedDate !== ocrExpiryDate;

    createMutation.mutate(
      {
        name: name.trim(),
        brand: brand.trim() || null,
        category_id: categoryId ?? null,
        expiry_date: normalizedDate,
        scan_id: scanId,
        quantity: Number(quantity) || 1,
        unit: unit.trim() || null,
        storage_location: storageLocation.trim() || null,
        notes: notes.trim() || null,
        date_source: scanId && !dateWasEdited ? 'ocr' : 'user',
      },
      {
        onSuccess: () => router.back(),
        onError: (err) => setFormError((err as Error).message),
      }
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {params.needs_review === '1' && (
        <View style={styles.reviewBanner}>
          <Text style={styles.reviewBannerTitle}>Confirm this date</Text>
          <Text style={styles.reviewBannerText}>
            {params.review_reason || 'The scan could not confidently read an expiry date.'}
          </Text>
        </View>
      )}

      <Text style={styles.label}>Name *</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Panadol Extra" />

      <Text style={styles.label}>Brand</Text>
      <TextInput style={styles.input} value={brand} onChangeText={setBrand} placeholder="Haleon" />

      <Text style={styles.label}>Category</Text>
      <CategoryPicker
        categories={categories}
        isLoading={categoriesLoading}
        selectedId={categoryId}
        onSelect={setCategoryId}
      />

      <Text style={styles.label}>Expiry date * (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        value={expiryDate}
        onChangeText={setExpiryDate}
        onBlur={() => setExpiryDate((current) => normalizeExpiryDate(current))}
        placeholder="2026-12-31"
        keyboardType="numbers-and-punctuation"
      />
      {alternativeDates.length > 0 && (
        <View style={styles.altRow}>
          <Text style={styles.altLabel}>Other readings:</Text>
          {alternativeDates.map((date) => (
            <Pressable key={date} style={styles.altChip} onPress={() => setExpiryDate(date)}>
              <Text style={styles.altChipText}>{date}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.inlineRow}>
        <View style={styles.inlineField}>
          <Text style={styles.label}>Quantity</Text>
          <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
        </View>
        <View style={styles.inlineField}>
          <Text style={styles.label}>Unit</Text>
          <TextInput style={styles.input} value={unit} onChangeText={setUnit} placeholder="bottle" />
        </View>
      </View>

      <Text style={styles.label}>Storage location</Text>
      <TextInput
        style={styles.input}
        value={storageLocation}
        onChangeText={setStorageLocation}
        placeholder="Bathroom cabinet"
      />

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, styles.notesInput]} value={notes} onChangeText={setNotes} multiline />

      {formError && <Text style={styles.error}>{formError}</Text>}

      <Pressable style={[styles.submit, !canSubmit && styles.submitDisabled]} disabled={!canSubmit} onPress={handleSubmit}>
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.submitText}>Add item</Text>
        )}
      </Pressable>
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
    paddingBottom: 40,
  },
  reviewBanner: {
    backgroundColor: '#fef5e7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  reviewBannerTitle: {
    fontWeight: '700',
    color: '#9a7d0a',
  },
  reviewBannerText: {
    fontSize: fontSize.caption,
    color: '#7a6108',
  },
  label: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: colors.white,
  },
  notesInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inlineField: {
    flex: 1,
  },
  altRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  altLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  altChip: {
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  altChipText: {
    fontSize: 12,
    color: colors.navy,
  },
  error: {
    color: colors.danger,
    marginTop: 14,
    textAlign: 'center',
  },
  submit: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
