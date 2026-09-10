import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  consumeItem,
  createItem,
  createScan,
  discardItem,
  getCategories,
  getDashboard,
  getItem,
  getItems,
  identifyProduct,
  patchItem,
} from './dataSource';
import type { CreateItemInput, PatchItemInput } from './types';
import type { ItemsQuery } from './dataSource';

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  items: (query: ItemsQuery) => ['items', query] as const,
  item: (id: string) => ['items', id] as const,
  categories: ['categories'] as const,
};

export function useDashboard() {
  return useQuery({ queryKey: queryKeys.dashboard, queryFn: getDashboard });
}

export function useItems(query: ItemsQuery = {}) {
  return useQuery({ queryKey: queryKeys.items(query), queryFn: () => getItems(query) });
}

export function useItem(id: string) {
  return useQuery({ queryKey: queryKeys.item(id), queryFn: () => getItem(id), enabled: !!id });
}

export function useCategories() {
  return useQuery({ queryKey: queryKeys.categories, queryFn: getCategories });
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
