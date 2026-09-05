// Shapes here match the REAL captured responses in docs/api-samples/, which
// carry more fields than api.md's trimmed examples show (e.g. quantity, unit,
// storage_location, notes, scan_id, product_id, resolved_at, updated_at all
// appear on every item but aren't in api.md's sample). image_url, conversely,
// is documented as always present but is absent (not null — omitted) on every
// seeded item, since none came from a scan. Typed as optional here; flagged
// to the team as a doc gap, not worked around.

export type Urgency = 'expired' | 'critical' | 'soon' | 'upcoming' | 'ok';
export type ItemStatus = 'active' | 'consumed' | 'discarded' | 'expired';
export type DateSource = 'ocr' | 'user';

export interface Item {
  id: string;
  name: string;
  brand: string | null;
  category_id: string;
  expiry_date: string;
  opened_at: string | null;
  pao_months: number | null;
  effective_expiry_date: string;
  days_remaining: number;
  urgency: Urgency;
  quantity: number;
  unit: string | null;
  storage_location: string | null;
  notes: string | null;
  scan_id: string | null;
  product_id: string | null;
  date_source: DateSource;
  status: ItemStatus;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  image_url?: string;
}

export interface ItemsListResponse {
  items: Item[];
  page: { total: number; limit: number; offset: number };
}

export interface DashboardResponse {
  counts: {
    expired: number;
    critical: number;
    soon: number;
    upcoming: number;
    ok: number;
    total_active: number;
  };
  expiring_soon: Item[];
  generated_at: string;
  timezone: string;
}

export interface Category {
  id: string;
  label_en: string;
  label_ms: string;
  label_zh: string;
  default_pao_months: number | null;
  icon: string;
  sort_order: number;
}

export interface MePreferences {
  id: string;
  display_name: string;
  timezone: string;
  reminder_lead_days: number[];
  quiet_hours_start: string;
  quiet_hours_end: string;
  push_enabled: boolean;
  locale: string;
  created_at: string;
  updated_at: string;
}

/** POST /v1/items body. Only name + expiry_date are required per api.md. */
export interface CreateItemInput {
  name: string;
  expiry_date: string;
  brand?: string | null;
  category_id?: string | null;
  scan_id?: string | null;
  product_id?: string | null;
  opened_at?: string | null;
  pao_months?: number | null;
  quantity?: number;
  unit?: string | null;
  storage_location?: string | null;
  notes?: string | null;
  date_source?: DateSource;
}

export type PatchItemInput = Partial<CreateItemInput>;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  request_id: string;
}
