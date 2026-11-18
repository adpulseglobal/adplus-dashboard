import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { GoogleTokenVault } from "./google-token-vault.service";

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

@Injectable()
export class GoogleAuthService {
  private cachedToken?: { value: string; expiresAt: number };
  private refreshInFlight?: Promise<string>;

  constructor(private readonly tokenVault: GoogleTokenVault) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) return this.cachedToken.value;
    if (!this.refreshInFlight) this.refreshInFlight = this.refreshAccessToken();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = undefined;
    }
  }

  private async refreshAccessToken(): Promise<string> {
    const { clientId, clientSecret, refreshToken } = await this.getCredentials();
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ServiceUnavailableException("Google OAuth token service is unavailable.");
    }
    const result = await response.json().catch(() => ({})) as OAuthTokenResponse;
    if (response.status === 400 || response.status === 401) throw new UnauthorizedException("Google authorization is expired or invalid. Ask the Super Admin to reconnect Google in Settings.");
    if (!response.ok || !result.access_token) throw new ServiceUnavailableException("Google OAuth could not issue an access token.");
    this.cachedToken = { value: result.access_token, expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000 };
    return result.access_token;
  }

  private async getCredentials(): Promise<{ clientId: string; clientSecret: string; refreshToken: string }> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = await this.tokenVault.getRefreshToken() ?? process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) throw new ServiceUnavailableException("Google is not connected. Ask the Super Admin to connect Google in Settings.");
    return { clientId, clientSecret, refreshToken };
  }
}
