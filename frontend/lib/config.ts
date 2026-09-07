/**
 * The single place the backend base URL lives. A Cloudflare tunnel URL for
 * now — it changes whenever the backend dev restarts their server, so this
 * comes from .env, not a hardcoded default. Cloud Run URL later — only
 * .env changes, this constant doesn't.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

/**
 * While true, lib/dataSource.ts serves the captured responses in mocks/
 * instead of calling the backend. Flip to false (or unset) once the
 * backend is reachable — no screen code changes when you do.
 */
export const USE_MOCKS = (process.env.EXPO_PUBLIC_USE_MOCKS ?? 'true') === 'true';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.'
  );
}
