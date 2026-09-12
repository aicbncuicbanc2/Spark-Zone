import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  askThyme,
  consumeItem,
  createCategory,
  createItem,
  createScan,
  discardItem,
  getCategories,
  getDashboard,
  getItem,
  getItems,
  getItemSuggestions,
  getMe,
  identifyProduct,
  patchItem,
  updatePreferences,
} from './dataSource';
import type {
  AskThymeRequest,
  CreateCategoryInput,
  CreateItemInput,
  Item,
  ItemStatus,
  PatchItemInput,
  PatchPreferencesInput,
} from './types';
import type { ItemsQuery } from './dataSource';

// No item's `status` column is ever actually written as "expired" (see
// pantry.tsx's comment) — a status=expired query always comes back empty,
// and "active" already includes expired-but-unresolved items anyway, so
// there's nothing for a 4th query to contribute.
const ALL_ITEM_STATUSES: ItemStatus[] = ['active', 'consumed', 'discarded'];

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  items: (query: ItemsQuery) => ['items', query] as const,
  item: (id: string) => ['items', id] as const,
  categories: ['categories'] as const,
  me: ['me'] as const,
};

export function useDashboard() {
  return useQuery({ queryKey: queryKeys.dashboard, queryFn: getDashboard });
}

export function useItems(query: ItemsQuery = {}) {
  return useQuery({ queryKey: queryKeys.items(query), queryFn: () => getItems(query) });
}

/**
 * There's no "all statuses" value on the real GET /v1/items — omitting
 * `status` defaults server-side to "active" only (see api.md), not
 * everything. So "show all together" means firing one request per status
 * and merging them client-side, not a single call.
 */
export function useAllStatusItems(query: Omit<ItemsQuery, 'status'> = {}) {
  const results = useQueries({
    queries: ALL_ITEM_STATUSES.map((status) => ({
      queryKey: queryKeys.items({ ...query, status }),
      queryFn: () => getItems({ ...query, status }),
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const error = results.find((r) => r.error)?.error;
  const refetch = () => results.forEach((r) => r.refetch());
  const isRefetching = results.some((r) => r.isRefetching);

  let items: Item[] = [];
  if (!isLoading && !error) {
    items = results.flatMap((r) => r.data?.items ?? []);
    const sort = query.sort ?? 'expiry';
    items.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'created') return b.created_at.localeCompare(a.created_at);
      return a.days_remaining - b.days_remaining;
    });
  }

  return { items, isLoading, error, refetch, isRefetching };
}

export function useItem(id: string) {
  return useQuery({ queryKey: queryKeys.item(id), queryFn: () => getItem(id), enabled: !!id });
}

export function useCategories() {
  return useQuery({ queryKey: queryKeys.categories, queryFn: getCategories });
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: PatchPreferencesInput) => updatePreferences(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => createCategory(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    },
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateItemInput) => createItem(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function usePatchItem(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: PatchItemInput) => patchItem(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useConsumeItem(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => consumeItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useDiscardItem(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => discardItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useCreateScan() {
  return useMutation({
    mutationFn: ({ uri }: { uri: string }) => createScan(uri),
  });
}

export function useIdentifyProduct() {
  return useMutation({
    mutationFn: ({ uri }: { uri: string }) => identifyProduct(uri),
  });
}

// On-demand, not a useQuery: this calls an LLM, so it should only run when
// the user actually taps "What should I use this for?", not eagerly every
// time an item's detail screen opens.
export function useItemSuggestions() {
  return useMutation({
    mutationFn: (item: Item) => getItemSuggestions(item),
  });
}

// Feature C — "Ask Thyme". Each call is stateless (the backend rebuilds
// pantry context fresh every time); the screen keeps the message list and
// passes it back as `history` so the conversation still feels continuous.
export function useAskThyme() {
  return useMutation({
    mutationFn: (request: AskThymeRequest) => askThyme(request),
  });
}
