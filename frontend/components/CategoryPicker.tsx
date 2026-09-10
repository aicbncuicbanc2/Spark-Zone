import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCreateCategory } from '../lib/queries';
import { colors } from '../lib/theme';
import type { Category } from '../lib/types';

type Props = {
  categories: Category[] | undefined;
  isLoading?: boolean;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /** 'pill' (default) is the dashed "+ New" chip used on the add-item form;
   * 'square' is the bordered icon-only "+" button used in filter contexts. */
  newButtonVariant?: 'pill' | 'square';
};

export function CategoryPicker({
  categories,
  isLoading,
  selectedId,
  onSelect,
  newButtonVariant = 'pill',
}: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const createMutation = useCreateCategory();

  function handleCreate() {
    if (!newLabel.trim()) return;
    createMutation.mutate(
      { label_en: newLabel.trim() },
      {
        onSuccess: (category) => {
          onSelect(category.id);
          setNewLabel('');
          setIsCreating(false);
        },
        onError: (error) => Alert.alert("Couldn't create category", (error as Error).message),
      }
    );
  }

  if (isLoading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.navy} />
        <Text style={styles.loadingText}>Loading categories…</Text>
      </View>
    );
  }

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {categories?.map((c) => (
          <Pressable
            key={c.id}
            style={[styles.chip, selectedId === c.id && styles.chipActive]}
            onPress={() => onSelect(c.id)}
          >
            <Text style={[styles.chipText, selectedId === c.id && styles.chipTextActive]}>
              {c.label_en}
            </Text>
          </Pressable>
        ))}
        {newButtonVariant === 'square' ? (
          <Pressable style={styles.squareNewButton} onPress={() => setIsCreating((v) => !v)}>
            <Ionicons name={isCreating ? 'close' : 'add'} size={18} color={colors.navy} />
          </Pressable>
        ) : (
          <Pressable style={[styles.chip, styles.newChip]} onPress={() => setIsCreating((v) => !v)}>
            <Text style={styles.newChipText}>{isCreating ? '× Cancel' : '+ New'}</Text>
          </Pressable>
        )}
      </ScrollView>

      {isCreating && (
        <View style={styles.createRow}>
          <TextInput
            style={styles.createInput}
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder="Category name"
            placeholderTextColor={colors.textMuted}
            autoFocus
            onSubmitEditing={handleCreate}
          />
          <Pressable
            style={[styles.createButton, !newLabel.trim() && styles.createButtonDisabled]}
            disabled={!newLabel.trim() || createMutation.isPending}
            onPress={handleCreate}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.createButtonText}>Add</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  chipRow: {
    flexGrow: 0,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: colors.white,
  },
  chipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  chipText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  chipTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
  newChip: {
    borderStyle: 'dashed',
    borderColor: colors.navy,
  },
  squareNewButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  newChipText: {
    fontSize: 13,
    color: colors.navy,
    fontWeight: '600',
  },
  createRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  createInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: colors.white,
  },
  createButton: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
});
