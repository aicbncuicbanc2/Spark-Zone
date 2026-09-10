// Shapes here match the REAL captured responses in docs/api-samples/ (and
// live backend calls made against the real API on 2026-09-06), which carry
// more fields than api.md's trimmed examples show (quantity, unit,
// storage_location, notes, scan_id, product_id, resolved_at, updated_at all
// appear on every item but aren't in api.md's sample). image_url was
// previously undocumented-as-optional; the backend fix in commit 16524e5
// makes it always present but nullable, confirmed live. category_id is also
// nullable — POST /v1/items with no category_id returns one with
// category_id: null, confirmed against the live backend.

export type Urgency = 'expired' | 'critical' | 'soon' | 'upcoming' | 'ok';
export type ItemStatus = 'active' | 'consumed' | 'discarded' | 'expired';
export type DateSource = 'ocr' | 'user';

export interface Item {
  id: string;
  name: string;
  brand: string | null;
  category_id: string | null;
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
  image_url: string | null;
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

export type DevicePlatform = 'ios' | 'android' | 'web';

/**
 * POST /v1/devices body (backend/app/api/v1/routes/devices.py). The field is
 * named fcm_token for historical reasons but must be an Expo push token
 * (`ExponentPushToken[...]`) — the backend rejects a raw FCM token with 422.
 */
export interface DeviceInput {
  fcm_token: string;
  platform: DevicePlatform;
  device_name?: string | null;
  app_version?: string | null;
}

export interface Device {
  id: string;
  fcm_token: string;
  platform: DevicePlatform;
  device_name: string | null;
  app_version: string | null;
  last_seen_at: string;
  created_at: string;
}

export type ScanStatus = 'pending' | 'processing' | 'succeeded' | 'needs_review' | 'failed';

/**
 * POST /v1/scans response (backend/app/schemas/scan.py — read directly, since
 * api.md's example shows a top-level `product` object that doesn't exist in
 * the real schema, and omits several fields the backend actually returns:
 * date_type, engines_attempted, ocr_confidence, needs_review, alternatives,
 * error_code/detail, processing_ms, created_at).
 */
export interface DateCandidate {
  value: string;
  date_type: string;
  confidence: number;
  raw: string;
  notes: string[];
}

export interface SuggestedItem {
  name: string | null;
  brand: string | null;
  category_id: string | null;
  expiry_date: string | null;
  pao_months: number | null;
}

export interface ScanResponse {
  scan_id: string;
  status: ScanStatus;
  image_url: string | null;
  extracted_expiry_date: string | null;
  date_confidence: number | null;
  date_type: string | null;
  detected_barcode: string | null;
  engine_used: string | null;
  engines_attempted: Record<string, unknown>[];
  raw_text: string | null;
  ocr_confidence: number | null;
  needs_review: boolean;
  review_reason: string | null;
  alternatives: DateCandidate[];
  suggested_item: SuggestedItem | null;
  error_code: string | null;
  error_detail: string | null;
  processing_ms: number | null;
  created_at: string | null;
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

/**
 * POST /v1/products/identify-photo response (backend/app/api/v1/routes/products.py).
 * Synchronous — unlike /v1/scans, no polling needed. `brand` is null on a
 * miss, which happens (Logo Detection is precise when it hits but
 * inconsistent) — never treat a miss as an error, just let the user type
 * the name/brand themselves.
 */
export interface ProductIdentifyResponse {
  brand: string | null;
  brand_confidence: number | null;
  raw_text: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  request_id: string;
}
