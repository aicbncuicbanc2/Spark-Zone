import categoriesJson from '../mocks/categories.json';
import dashboardJson from '../mocks/dashboard.json';
import itemsListJson from '../mocks/items-list.json';
import meJson from '../mocks/me.json';
import type {
  Category,
  CreateItemInput,
  DashboardResponse,
  Device,
  DeviceInput,
  Item,
  MePreferences,
  PatchItemInput,
} from './types';

// In-memory copy seeded from the real captured responses, so add/edit
// actions are visible for the rest of the session without a backend.
// This is a stand-in for the server — not a pattern to reuse once real
// calls are wired up.
let items: Item[] = structuredClone((itemsListJson as { items: Item[] }).items);
const categories = categoriesJson as Category[];
const me = meJson as MePreferences;
let devices: Device[] = [];

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
};
