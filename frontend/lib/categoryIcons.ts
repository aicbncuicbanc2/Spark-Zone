import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// Approximate stand-ins for the illustrated circular icons in the Figma
// mockup — those are custom artwork, not something buildable in code.
// Swap these for real exported icon assets when available.
const ICON_BY_CATEGORY: Record<string, IoniconName> = {
  food: 'restaurant-outline',
  beauty: 'sparkles-outline',
  health: 'medkit-outline',
  personal_care: 'water-outline',
};

export function iconForCategory(categoryId: string): IoniconName {
  return ICON_BY_CATEGORY[categoryId] ?? 'pricetag-outline';
}
