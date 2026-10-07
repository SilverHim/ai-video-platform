import { CLIENT_HEADER, CLIENT_HEADER_VALUE, type ApiError, type HealthInfo, type KeyStatus, type ProviderId } from '../../shared/api-contract';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set(CLIENT_HEADER, CLIENT_HEADER_VALUE);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  listKeys: () => request<{ keys: KeyStatus[] }>('/api/keys'),
  setKey: (provider: ProviderId, apiKey: string) =>
    request<{ key: KeyStatus }>(`/api/keys/${provider}`, { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  clearKey: (provider: ProviderId) => request<{ key: KeyStatus }>(`/api/keys/${provider}`, { method: 'DELETE' }),
};
