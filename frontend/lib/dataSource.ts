import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { apiRequest } from './api';
import { USE_MOCKS } from './config';
import { mockStore } from './mockStore';
import type {
  AskThymeRequest,
  AskThymeResponse,
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
  PatchPreferencesInput,
  ProductIdentifyResponse,
  ScanResponse,
  SuggestionsResponse,
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

export async function updatePreferences(patch: PatchPreferencesInput): Promise<MePreferences> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.updatePreferences(patch);
  }
  return apiRequest<MePreferences>('/v1/me/preferences', { method: 'PATCH', body: patch });
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

export async function getItemSuggestions(item: Item): Promise<SuggestionsResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.getItemSuggestions(item);
  }
  return apiRequest<SuggestionsResponse>(`/v1/ai/items/${item.id}/suggestions`);
}

export async function askThyme(request: AskThymeRequest): Promise<AskThymeResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.askThyme(request);
  }
  return apiRequest<AskThymeResponse>('/v1/ai/ask', { method: 'POST', body: request });
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

const SCAN_POLL_INTERVAL_MS = 1500;
//: A real scan on the backend dev's machine hit 289s under memory pressure
//: (PaddleOCR degrades badly when free RAM is low) - a scan that is still
//: genuinely working must not be reported as failed just because this
//: laptop is slow tonight. Generous on purpose; the backend itself is what
//: actually gives up, this is only a safety net against a truly stuck scan.
const SCAN_POLL_TIMEOUT_MS = 5 * 60_000;
//: A wait this long is dozens of polls over a phone's mobile/hotspot
//: connection - one of them dropping is routine, not a real failure. Only
//: give up after several in a row fail, so a single blip mid-scan doesn't
//: report a scan that is still working fine as failed.
const SCAN_POLL_MAX_CONSECUTIVE_FAILURES = 5;

/** GET /v1/scans/{id}. */
export async function getScan(scanId: string): Promise<ScanResponse> {
  return apiRequest<ScanResponse>(`/v1/scans/${scanId}`);
}

/**
 * Wraps a local file:// (native) or blob:/data: (web) image URI from
 * expo-image-picker into a FormData part named "image", the shape every
 * multipart endpoint here (/v1/scans, /v1/products/identify-photo) expects.
 */
async function buildImageFormData(imageUri: string): Promise<FormData> {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // expo-file-system's File is native-only (Android/iOS/tvOS) - it does
    // not support web at all, so it can't wrap a browser blob: URI. The
    // standard cross-platform way to turn an ImagePicker web URI into
    // something FormData can send is to fetch it back into a real Blob.
    const blob = await (await fetch(imageUri)).blob();
    formData.append('image', blob, 'photo.jpg');
  } else {
    // expo-file-system's File is Blob-like, which native fetch's FormData
    // requires — a plain {uri,name,type} object throws "Unsupported
    // FormDataPart implementation" on SDK 57.
    const file = new File(imageUri);
    formData.append('image', file);
  }
  return formData;
}

/**
 * POST /v1/scans. `imageUri` is a local file:// URI from expo-image-picker.
 *
 * The backend replies 202 immediately with status "processing" — OCR runs
 * afterward in a background task, so that first response never carries a
 * real result (extracted_expiry_date and suggested_item are always empty).
 * This polls GET /v1/scans/{id} until the scan resolves, so every caller
 * always receives the real, finished result — never the just-created row.
 */
export async function createScan(imageUri: string): Promise<ScanResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.createScan();
  }
  const formData = await buildImageFormData(imageUri);
  let scan = await apiRequest<ScanResponse>('/v1/scans', { method: 'POST', formData });

  const deadline = Date.now() + SCAN_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;
  while (scan.status === 'pending' || scan.status === 'processing') {
    if (Date.now() > deadline) {
      throw new Error('The scan is taking longer than expected. Please try again.');
    }
    await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_INTERVAL_MS));
    try {
      scan = await getScan(scan.scan_id);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= SCAN_POLL_MAX_CONSECUTIVE_FAILURES) throw error;
    }
  }
  return scan;
}

/**
 * POST /v1/products/identify-photo — a photo of the product's own
 * front/branding (not the expiry date). Unlike createScan, this is
 * synchronous: Vision-only, no local PaddleOCR, so it resolves in ~1-2s
 * with no polling needed. `brand` is null on a miss — that's a normal
 * result, not an error, so always still let the user type/confirm it.
 */
export async function identifyProduct(imageUri: string): Promise<ProductIdentifyResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockStore.identifyProduct();
  }
  const formData = await buildImageFormData(imageUri);
  return apiRequest<ProductIdentifyResponse>('/v1/products/identify-photo', { method: 'POST', formData });
}
