import { apiRequest } from './api';
import { USE_MOCKS } from './config';
import { mockStore } from './mockStore';
import type {
  Category,
  CreateItemInput,
  DashboardResponse,
  Device,
  DeviceInput,
  Item,
  ItemsListResponse,
  MePreferences,
  PatchItemInput,
} from './types';

// Every function here has one job: return the same shape whether it's
// reading a mock or calling the backend. Screens call these, never
// `apiRequest` or `mockStore` directly — flipping USE_MOCKS is then the
// only change needed to go live.

const mockDelay = () => new Promise((resolve) => setTimeout(resolve, 200));

export type ItemsQuery = {
  status?: Item['status'];
  category?: string;
  expiring_within_days?: number;
  sort?: 'expiry' | 'created' | 'name';
};

export async function getDashboard(): Promise<DashboardResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.getDashboard();
  }
  return apiRequest<DashboardResponse>('/v1/dashboard');
}

export async function getItems(query: ItemsQuery = {}): Promise<ItemsListResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    let items = mockStore.listItems();
    const status = query.status ?? 'active';
    items = items.filter((item) => item.status === status);
    if (query.category) items = items.filter((item) => item.category_id === query.category);
    if (query.expiring_within_days != null) {
      items = items.filter((item) => item.days_remaining <= query.expiring_within_days!);
    }
    const sort = query.sort ?? 'expiry';
    items = [...items].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'created') return b.created_at.localeCompare(a.created_at);
      return a.days_remaining - b.days_remaining;
    });
    return { items, page: { total: items.length, limit: 50, offset: 0 } };
  }
  return apiRequest<ItemsListResponse>('/v1/items', { query });
}

export async function getItem(id: string): Promise<Item> {
  if (USE_MOCKS) {
    await mockDelay();
    const item = mockStore.getItem(id);
    if (!item) throw new Error(`Item ${id} not found in mock data`);
    return item;
  }
  return apiRequest<Item>(`/v1/items/${id}`);
}

export async function getCategories(): Promise<Category[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.getCategories();
  }
  return apiRequest<Category[]>('/v1/categories');
}

export async function getMe(): Promise<MePreferences> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.getMe();
  }
  return apiRequest<MePreferences>('/v1/me');
}

export async function createItem(input: CreateItemInput): Promise<Item> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.createItem(input);
  }
  return apiRequest<Item>('/v1/items', { method: 'POST', body: input });
}

export async function patchItem(id: string, patch: PatchItemInput): Promise<Item> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.patchItem(id, patch);
  }
  return apiRequest<Item>(`/v1/items/${id}`, { method: 'PATCH', body: patch });
}

export async function consumeItem(id: string): Promise<Item> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.resolveItem(id, 'consumed');
  }
  return apiRequest<Item>(`/v1/items/${id}/consume`, { method: 'POST' });
}

export async function discardItem(id: string): Promise<Item> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.resolveItem(id, 'discarded');
  }
  return apiRequest<Item>(`/v1/items/${id}/discard`, { method: 'POST' });
}

export async function registerDevice(input: DeviceInput): Promise<Device> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.registerDevice(input);
  }
  return apiRequest<Device>('/v1/devices', { method: 'POST', body: input });
}

export async function unregisterDevice(token: string): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay();
    mockStore.unregisterDevice(token);
    return;
  }
  await apiRequest<void>('/v1/devices', { method: 'DELETE', query: { token } });
}
