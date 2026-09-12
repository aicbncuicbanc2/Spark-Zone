import categoriesJson from '../mocks/categories.json';
import dashboardJson from '../mocks/dashboard.json';
import itemsListJson from '../mocks/items-list.json';
import meJson from '../mocks/me.json';
import scanNeedsReviewJson from '../mocks/scan-needs-review.json';
import scanSucceededJson from '../mocks/scan-succeeded.json';
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
  MePreferences,
  PatchItemInput,
  ProductIdentifyResponse,
  ScanResponse,
  SuggestionsResponse,
} from './types';

// In-memory copy seeded from the real captured responses, so add/edit
// actions are visible for the rest of the session without a backend.
// This is a stand-in for the server — not a pattern to reuse once real
// calls are wired up.
let items: Item[] = structuredClone((itemsListJson as { items: Item[] }).items);
let categories = categoriesJson as Category[];
const me = meJson as MePreferences;
let devices: Device[] = [];
let scanCount = 0;

function computeEffective(item: Pick<Item, 'expiry_date' | 'opened_at' | 'pao_months'>): string {
  if (!item.opened_at || item.pao_months == null) return item.expiry_date;
  const paoDate = new Date(item.opened_at);
  paoDate.setMonth(paoDate.getMonth() + item.pao_months);
  const paoIso = paoDate.toISOString().slice(0, 10);
  return paoIso < item.expiry_date ? paoIso : item.expiry_date;
}

function computeUrgency(effectiveExpiryDate: string): { urgency: Item['urgency']; days: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(effectiveExpiryDate);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { urgency: 'expired', days };
  if (days <= 1) return { urgency: 'critical', days };
  if (days <= 3) return { urgency: 'soon', days };
  if (days <= 7) return { urgency: 'upcoming', days };
  return { urgency: 'ok', days };
}

export const mockStore = {
  listItems(): Item[] {
    return items;
  },

  getItem(id: string): Item | undefined {
    return items.find((item) => item.id === id);
  },

  getCategories(): Category[] {
    return categories;
  },

  createCategory(input: CreateCategoryInput): Category {
    const id = `custom-${input.label_en.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
    const category: Category = {
      id,
      label_en: input.label_en.trim(),
      label_ms: input.label_en.trim(),
      label_zh: input.label_en.trim(),
      default_pao_months: null,
      icon: input.icon ?? 'tag',
      sort_order: (categories[categories.length - 1]?.sort_order ?? 0) + 10,
      isCustom: true,
    };
    categories = [...categories, category];
    return category;
  },

  getMe(): MePreferences {
    return me;
  },

  getDashboard(): DashboardResponse {
    // counts/expiring_soon are recomputed from the live item list so
    // adding/opening items in the mock is visible on the dashboard too.
    const active = items.filter((item) => item.status === 'active');
    const counts = { expired: 0, critical: 0, soon: 0, upcoming: 0, ok: 0 };
    for (const item of active) counts[item.urgency] += 1;
    const expiringSoon = [...active].sort((a, b) => a.days_remaining - b.days_remaining).slice(0, 10);
    return {
      counts: { ...counts, total_active: active.length },
      expiring_soon: expiringSoon,
      generated_at: new Date().toISOString(),
      timezone: (dashboardJson as DashboardResponse).timezone,
    };
  },

  createItem(input: CreateItemInput): Item {
    const now = new Date().toISOString();
    const effective_expiry_date = computeEffective({
      expiry_date: input.expiry_date,
      opened_at: input.opened_at ?? null,
      pao_months: input.pao_months ?? null,
    });
    const { urgency, days } = computeUrgency(effective_expiry_date);
    const item: Item = {
      id: `mock-${Date.now()}`,
      name: input.name,
      brand: input.brand ?? null,
      category_id: input.category_id ?? null,
      expiry_date: input.expiry_date,
      opened_at: input.opened_at ?? null,
      pao_months: input.pao_months ?? null,
      effective_expiry_date,
      days_remaining: days,
      urgency,
      quantity: input.quantity ?? 1,
      unit: input.unit ?? null,
      storage_location: input.storage_location ?? null,
      notes: input.notes ?? null,
      scan_id: input.scan_id ?? null,
      product_id: input.product_id ?? null,
      date_source: input.date_source ?? 'user',
      status: 'active',
      resolved_at: null,
      created_at: now,
      updated_at: now,
      image_url: null,
    };
    items = [item, ...items];
    return item;
  },

  patchItem(id: string, patch: PatchItemInput): Item {
    const existing = items.find((item) => item.id === id);
    if (!existing) throw new Error(`Mock item ${id} not found`);
    const merged: Item = {
      ...existing,
      ...patch,
      category_id: patch.category_id ?? existing.category_id,
      updated_at: new Date().toISOString(),
    };
    merged.effective_expiry_date = computeEffective(merged);
    const { urgency, days } = computeUrgency(merged.effective_expiry_date);
    merged.urgency = urgency;
    merged.days_remaining = days;
    items = items.map((item) => (item.id === id ? merged : item));
    return merged;
  },

  resolveItem(id: string, status: 'consumed' | 'discarded'): Item {
    const existing = items.find((item) => item.id === id);
    if (!existing) throw new Error(`Mock item ${id} not found`);
    const resolved: Item = { ...existing, status, resolved_at: new Date().toISOString() };
    items = items.map((item) => (item.id === id ? resolved : item));
    return resolved;
  },

  registerDevice(input: DeviceInput): Device {
    const now = new Date().toISOString();
    const existing = devices.find((d) => d.fcm_token === input.fcm_token);
    const device: Device = {
      id: existing?.id ?? `mock-device-${Date.now()}`,
      fcm_token: input.fcm_token,
      platform: input.platform,
      device_name: input.device_name ?? null,
      app_version: input.app_version ?? null,
      last_seen_at: now,
      created_at: existing?.created_at ?? now,
    };
    devices = [...devices.filter((d) => d.fcm_token !== input.fcm_token), device];
    return device;
  },

  unregisterDevice(token: string): void {
    devices = devices.filter((d) => d.fcm_token !== token);
  },

  createScan(): ScanResponse {
    // Alternates so both the happy path and the needs_review path (a
    // manufacture-date-only pack) get exercised without any setup.
    scanCount += 1;
    const sample = scanCount % 2 === 1 ? scanSucceededJson : scanNeedsReviewJson;
    return { ...(sample as ScanResponse), scan_id: `mock-scan-${Date.now()}` };
  },

  identifyProduct(): ProductIdentifyResponse {
    // Real Logo/Label Detection each miss independently, so the mock
    // alternates too — brand and category can each be null on their own,
    // not just together.
    scanCount += 1;
    if (scanCount % 2 === 1) {
      return {
        brand: 'Kopiko',
        brand_confidence: 0.99,
        raw_text: 'KOPIKO Coffee Candy',
        category_id: 'food',
        category_confidence: 0.91,
        brand_box: { x: 0.15, y: 0.22, width: 0.4, height: 0.18 },
      };
    }
    return {
      brand: null,
      brand_confidence: null,
      raw_text: 'Anessa Perfect UV Sunscreen',
      category_id: 'skincare',
      category_confidence: 0.8,
      brand_box: null,
    };
  },

  getItemSuggestions(item: Item): SuggestionsResponse {
    return {
      suggestions: [
        `Move ${item.name} to the front of the shelf so it gets used first.`,
        item.category_id === 'food'
          ? "Turn it into tonight's dinner rather than letting it sit any longer."
          : 'A quick reminder to actually use this one soon.',
      ],
    };
  },

  askThyme(request: AskThymeRequest): AskThymeResponse {
    const expiringSoon = items.filter((item) => item.status === 'active' && item.days_remaining <= 7);
    if (expiringSoon.length === 0) {
      return { answer: "Nothing in your pantry is expiring within a week right now — you're all clear." };
    }
    const names = expiringSoon.map((item) => item.name).join(', ');
    return { answer: `Expiring within a week: ${names}. Worth using those up first.` };
  },
};
