import { File } from 'expo-file-system';

import { apiRequest } from './api';
import { USE_MOCKS } from './config';
import { mockStore } from './mockStore';
import type {
  Category,
  CreateCategoryInput,
  CreateItemInput,
  DashboardResponse,
  Device,
  DeviceInput,
  Item,
  ItemsListResponse,
  MePreferences,
  PatchItemInput,
  ScanResponse,
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

export async function createCategory(input: CreateCategoryInput): Promise<Category> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.createCategory(input);
  }
  // No POST /v1/categories on the real backend yet — fail clearly instead
  // of hitting a 404 that would look like a network bug.
  throw new Error(
    "Custom categories aren't supported by the backend yet — ask the team to add POST /v1/categories."
  );
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

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;
const STILL_PROCESSING: ScanResponse['status'][] = ['pending', 'processing'];

/**
 * POST /v1/scans now returns instantly (202) with status: "processing" —
 * the backend used to hold the connection open for the whole OCR run, which
 * real devices (and the tunnel) would cancel mid-request on a slow scan.
 * This polls GET /v1/scans/{id} until a terminal status, per api.md, and
 * resolves with that final result — same contract callers see as before,
 * the polling is just an implementation detail.
 */
async function pollScan(scanId: string, onPoll?: (elapsedMs: number) => void): Promise<ScanResponse> {
  const startedAt = Date.now();
  while (true) {
    const result = await apiRequest<ScanResponse>(`/v1/scans/${scanId}`);
    if (!STILL_PROCESSING.includes(result.status)) return result;

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > POLL_TIMEOUT_MS) {
      throw new Error('Scan is taking longer than expected. Try again, or add the item manually.');
    }
    onPoll?.(elapsedMs);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** `imageUri` is a local file:// URI from expo-image-picker. */
export async function createScan(
  imageUri: string,
  onPoll?: (elapsedMs: number) => void
): Promise<ScanResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.createScan();
  }
  // expo-file-system's File is Blob-like, which native fetch's FormData
  // requires — a plain {uri,name,type} object throws "Unsupported
  // FormDataPart implementation" on SDK 57.
  const file = new File(imageUri);
  const formData = new FormData();
  formData.append('image', file);
  const initial = await apiRequest<ScanResponse>('/v1/scans', { method: 'POST', formData });
  if (!STILL_PROCESSING.includes(initial.status)) return initial;
  return pollScan(initial.scan_id, onPoll);
}
