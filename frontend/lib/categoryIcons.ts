import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// Approximate stand-ins for the illustrated circular icons in the Figma
// mockup — those are custom artwork, not something buildable in code.
// Swap these for real exported icon assets when available.
//
// Keyed on the real backend's category ids (docs/api-samples), not the
// mock data's old ids — those used to differ (mocks had "beauty"/"health"/
// "personal_care", which don't exist on the real API), so every real
// category except "food" fell through to the generic pricetag icon on the
// deployed build while local mock-data testing showed a full set of
// distinct icons. mocks/categories.json now mirrors this same id list so
// local dev and production always agree on which icon a category gets.
const ICON_BY_CATEGORY: Record<string, IoniconName> = {
  medicine: 'medkit-outline',
  supplement: 'flask-outline',
  skincare: 'water-outline',
  cosmetic: 'sparkles-outline',
  food: 'restaurant-outline',
  aerosol: 'cloud-outline',
  household: 'home-outline',
};

export function iconForCategory(categoryId: string): IoniconName {
  return ICON_BY_CATEGORY[categoryId] ?? 'pricetag-outline';
}
