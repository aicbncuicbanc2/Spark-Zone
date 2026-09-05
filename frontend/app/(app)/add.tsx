import { useRouter } from 'expo-router';
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

import { useCategories, useCreateItem } from '../../lib/queries';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function AddItemScreen() {
  const router = useRouter();
  const { data: categories } = useCategories();
  const createMutation = useCreateItem();

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && DATE_RE.test(expiryDate) && !createMutation.isPending;

  function handleSubmit() {
    setFormError(null);
    if (!name.trim()) return setFormError('Name is required.');
    if (!DATE_RE.test(expiryDate)) return setFormError('Expiry date must be YYYY-MM-DD.');

    createMutation.mutate(
      {
        name: name.trim(),
        brand: brand.trim() || null,
        category_id: categoryId ?? null,
        expiry_date: expiryDate,
        quantity: Number(quantity) || 1,
        unit: unit.trim() || null,
        storage_location: storageLocation.trim() || null,
        notes: notes.trim() || null,
        date_source: 'user',
      },
      {
        onSuccess: () => router.back(),
        onError: (err) => setFormError((err as Error).message),
      }
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Name *</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Panadol Extra" />

      <Text style={styles.label}>Brand</Text>
      <TextInput style={styles.input} value={brand} onChangeText={setBrand} placeholder="Haleon" />

      <Text style={styles.label}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {categories?.map((c) => (
          <Pressable
            key={c.id}
            style={[styles.chip, categoryId === c.id && styles.chipActive]}
            onPress={() => setCategoryId(c.id)}
          >
            <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>
              {c.label_en}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.label}>Expiry date * (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        value={expiryDate}
        onChangeText={setExpiryDate}
        placeholder="2026-12-31"
        keyboardType="numbers-and-punctuation"
      />

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
          <ActivityIndicator color="#fff" />
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
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  label: {
    fontSize: 13,
    color: '#777',
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
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
  chipRow: {
    flexGrow: 0,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: '#2e7d32',
    borderColor: '#2e7d32',
  },
  chipText: {
    fontSize: 13,
    color: '#555',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  error: {
    color: '#c0392b',
    marginTop: 14,
    textAlign: 'center',
  },
  submit: {
    backgroundColor: '#2e7d32',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
