const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
let refreshInFlight: Promise<boolean> | null = null;

export function apiUrl(path: string): string {
  const base = new URL(API_BASE);
  if (typeof window !== "undefined" && isLoopbackHost(base.hostname) && isLoopbackHost(window.location.hostname)) {
    // Keep the frontend and API on the same site so SameSite=Lax auth cookies work locally.
    base.hostname = window.location.hostname;
  }
  return `${base.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = input.startsWith("http") ? input : apiUrl(input);
  const first = await fetch(url, withCredentialsAndCsrf(init));
  if (first.status !== 401 || isAuthEndpoint(url)) return first;
  if (!refreshInFlight) {
    refreshInFlight = refreshSession().catch(() => false).finally(() => { refreshInFlight = null; });
  }
  if (!(await refreshInFlight)) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    }
    return first;
  }
  return fetch(url, withCredentialsAndCsrf(init));
}

async function refreshSession(): Promise<boolean> {
  const perform = async () => {
    // Tabs share cookies. After waiting for the cross-tab lock, check whether another tab already refreshed.
    const currentSession = await fetch(apiUrl("/auth/me"), withCredentialsAndCsrf({ cache: "no-store" })).catch(() => null);
    if (currentSession?.ok) return true;
    const response = await fetch(apiUrl("/auth/refresh"), withCredentialsAndCsrf({ method: "POST" }));
    return response.ok;
  };
  const locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> } }).locks;
  return locks ? locks.request("adpulse-auth-refresh", perform) : perform();
}

export function getApiError(result: unknown, fallback = "The request could not be completed."): string {
  if (result && typeof result === "object" && "message" in result) {
    const message = (result as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.filter((part): part is string => typeof part === "string").join(" ");
  }
  return fallback;
}

export function readCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("adpulse_csrf="))?.slice("adpulse_csrf=".length);
  if (!value) return "";
  try { return decodeURIComponent(value); } catch { return ""; }
}

function withCredentialsAndCsrf(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (! ["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  return { ...init, credentials: "include", headers };
}

function isAuthEndpoint(url: string): boolean {
  const pathname = new URL(url, window.location.origin).pathname;
  return pathname === "/auth/login" || pathname === "/auth/refresh";
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
