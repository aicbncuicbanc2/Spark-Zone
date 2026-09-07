import { fetch as expoFetch } from 'expo/fetch';

import { API_BASE_URL } from './config';
import { supabase } from './supabase';

/**
 * The one error shape every endpoint in api.md returns. Callers should
 * branch on `code`, never on `message`.
 */
export class ApiError extends Error {
  code: string;
  details: Record<string, unknown>;
  requestId: string | undefined;
  status: number;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown>,
    requestId: string | undefined,
    status: number
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.status = status;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** multipart/form-data body, e.g. for POST /v1/scans. Skips JSON encoding. */
  formData?: FormData;
};

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function doFetch(path: string, options: RequestOptions, token: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!options.formData) headers['Content-Type'] = 'application/json';

  // React Native's global fetch rejects a FormData part built from
  // expo-file-system's File (a Blob-like, not a plain {uri,name,type}
  // object) with "Unsupported FormDataPart implementation" — expo/fetch's
  // native implementation is the one that actually supports it. Only used
  // for multipart requests; the JSON path keeps using the global fetch.
  const fetchImpl = options.formData ? expoFetch : fetch;

  return fetchImpl(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  }) as unknown as Promise<Response>;
}

/**
 * Calls a `/v1/...` endpoint, attaching the current Supabase session token.
 * On `TOKEN_EXPIRED`, refreshes the session once and retries — per api.md,
 * that code means "refresh and retry", not "log the user out".
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let token = await getAccessToken();
  let response = await doFetch(path, options, token);
  let errorBody = response.ok ? null : await response.json().catch(() => null);

  if (!response.ok && errorBody?.error?.code === 'TOKEN_EXPIRED') {
    const { data, error } = await supabase.auth.refreshSession();
    token = data.session?.access_token ?? null;
    if (!error && token) {
      response = await doFetch(path, options, token);
      errorBody = response.ok ? null : await response.json().catch(() => null);
    }
  }

  if (!response.ok) {
    const requestId = response.headers.get('X-Request-ID') ?? undefined;
    if (errorBody?.error) {
      throw new ApiError(
        errorBody.error.code,
        errorBody.error.message,
        errorBody.error.details ?? {},
        requestId,
        response.status
      );
    }
    throw new ApiError('UNKNOWN_ERROR', response.statusText, {}, requestId, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}
