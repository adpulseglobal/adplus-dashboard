import type { Request, Response } from "express";
import type { AuthTokens } from "./auth.types";

export const ACCESS_COOKIE = "adpulse_access";
export const REFRESH_COOKIE = "adpulse_refresh";
export const CSRF_COOKIE = "adpulse_csrf";
export const ACCESS_COOKIE_PATH = "/";
export const REFRESH_COOKIE_PATH = "/auth";

export function readCookie(request: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  const raw = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return undefined;
  try { return decodeURIComponent(raw); } catch { return undefined; }
}

export function setAuthCookies(response: Response, tokens: AuthTokens): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const refreshMaxAge = Math.max(0, new Date(tokens.expiresAt).getTime() - Date.now());
  response.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=${encodeURIComponent(tokens.accessToken)}; Path=${ACCESS_COOKIE_PATH}; Max-Age=900; HttpOnly; SameSite=Lax${secure}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(tokens.refreshToken)}; Path=${REFRESH_COOKIE_PATH}; Max-Age=${Math.floor(refreshMaxAge / 1000)}; HttpOnly; SameSite=Lax${secure}`,
    `${CSRF_COOKIE}=${encodeURIComponent(tokens.csrfToken)}; Path=/; Max-Age=${Math.floor(refreshMaxAge / 1000)}; SameSite=Lax${secure}`,
  ]);
}

export function clearAuthCookies(response: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=; Path=${ACCESS_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
    `${REFRESH_COOKIE}=; Path=${REFRESH_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
    `${CSRF_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`,
  ]);
}
