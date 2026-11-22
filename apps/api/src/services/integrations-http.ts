// Outbound HTTP for the integrations (Gmail API, Microsoft Graph, OAuth token endpoints, WhatsApp Cloud API, SMS gateway):
// plain fetch, no SDKs. Tests replace it with setIntegrationFetch(mock) — no real network call is ever made in tests.
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }) => Promise<Response>;

let current: FetchLike = (url, init) => fetch(url, init as RequestInit);

export function setIntegrationFetch(f: FetchLike | null): void {
  current = f ?? ((url, init) => fetch(url, init as RequestInit));
}

/** fetch with a timeout; network / timeout errors are thrown as HttpError(status 0, retryable). */
export async function httpCall(url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }, timeoutMs = 15_000): Promise<{ status: number; text: string; json: unknown }> {
  let res: Response;
  try {
    res = await current(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new HttpError(0, `network: ${(e as Error)?.message ?? e}`, true);
  }
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly retryable: boolean, readonly code?: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/** 429, 5xx and network errors are transient; other 4xx are permanent for that request. */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function formBody(v: Record<string, string>): string {
  return new URLSearchParams(v).toString();
}
