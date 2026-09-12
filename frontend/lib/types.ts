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
  /** Mock-only: true for a category the user created on-device. There is no
   * POST /v1/categories on the real backend yet — see createCategory(). */
  isCustom?: boolean;
}

/**
 * Mock-only for now — no POST /v1/categories exists on the real backend.
 * Calling createCategory() with USE_MOCKS=false throws rather than hitting
 * a 404, so the failure is clear instead of looking like a network bug.
 */
export interface CreateCategoryInput {
  label_en: string;
  icon?: string;
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

// PATCH /v1/me/preferences body — display_name/locale/id/timestamps are
// read-only on this endpoint (see api.md's sample body), so only these five
// fields are ever sent.
export type PatchPreferencesInput = Partial<
  Pick<MePreferences, 'timezone' | 'reminder_lead_days' | 'quiet_hours_start' | 'quiet_hours_end' | 'push_enabled'>
>;

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
 * Synchronous — unlike /v1/scans, no polling needed. `brand` and
 * `category_id` are each independently null on a miss, which happens (Logo
 * Detection and Label Detection are both precise when they hit but
 * inconsistent) — never treat a miss as an error, just let the user
 * type/confirm the name, brand, and category themselves. `raw_text` is
 * intentionally not a name suggestion — the backend found that the most
 * prominent OCR text block on a real test photo was a misread brand, so
 * parsing a name out of it here would risk the same silently-wrong guess.
 */
/**
 * Where the detected logo sits in the photo, as fractions (0-1) of its
 * width/height — not pixels — so a frame can be drawn over the displayed
 * image at any size without knowing the original resolution. Multiply by
 * the rendered <Image>'s width/height to get on-screen position/size.
 */
export interface BrandBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProductIdentifyResponse {
  brand: string | null;
  brand_confidence: number | null;
  raw_text: string | null;
  category_id: string | null;
  category_confidence: number | null;
  /** Null whenever brand is null — nothing to frame. Never populated for
   * the product name itself; see backend/app/services/ocr/vision_engine.py
   * for why that's not a reliable region to point to. */
  brand_box: BrandBox | null;
}

/**
 * GET /v1/ai/items/{item_id}/suggestions response
 * (backend/app/api/v1/routes/ai.py). `suggestions` is always present — an
 * empty array means "not available right now" (no Gemini key configured, a
 * network failure, an unparsable model response), never a fetch error to
 * handle specially. Never used for anything safety-critical; disposal advice
 * stays on GET /v1/guidance/... , which is curated, not model-generated.
 */
export interface SuggestionsResponse {
  suggestions: string[];
}

/**
 * Feature C — "Ask Thyme". POST /v1/ai/ask body/response
 * (backend/app/api/v1/routes/ai.py). `history` is prior turns, oldest
 * first — the call is otherwise stateless; the backend rebuilds the user's
 * current pantry context fresh every time. Unlike SuggestionsResponse, a
 * failure here is a real HTTP error (503 AI_UNAVAILABLE), not an empty
 * result — see api.md for why the two features degrade differently.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AskThymeRequest {
  question: string;
  history: ChatMessage[];
}

export interface AskThymeResponse {
  answer: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  request_id: string;
}
