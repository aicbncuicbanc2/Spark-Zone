// Mirrors backend/app/services/places_client.py's _CATEGORY_STORE_TYPES -
// duplicated here (not fetched) so filtering an already-cached list of
// today's visited stores by category doesn't need a network round trip.
// Keep the two in sync if the built-in categories or their store types
// ever change.
export const CATEGORY_STORE_TYPES: Record<string, string[]> = {
  medicine: ['pharmacy', 'drugstore'],
  supplement: ['pharmacy', 'drugstore', 'supermarket'],
  skincare: ['pharmacy', 'drugstore'],
  cosmetic: ['drugstore', 'pharmacy'],
  food: ['supermarket', 'grocery_store', 'convenience_store'],
  aerosol: ['supermarket', 'hardware_store'],
  household: ['supermarket', 'hardware_store', 'home_goods_store'],
};

/**
 * True if `types` (a store's Places types) plausibly sells items in
 * `categoryId`. A category with no entry here (a custom, user-created one)
 * matches everything - there's nothing to filter against, so showing every
 * recently-visited store beats showing none.
 */
export function storeMatchesCategory(storeTypes: string[], categoryId: string | undefined): boolean {
  const wanted = categoryId ? CATEGORY_STORE_TYPES[categoryId] : undefined;
  if (!wanted) return true;
  return storeTypes.some((type) => wanted.includes(type));
}
