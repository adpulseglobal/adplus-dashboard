import { Injectable, ServiceUnavailableException } from "@nestjs/common";

interface GoogleTokenResponse {
  refresh_token?: string;
  error?: string;
}

@Injectable()
export class GoogleOAuthService {
  getRedirectUri(): string {
    const port = process.env.API_PORT ?? "4000";
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`;
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new ServiceUnavailableException("GOOGLE_OAUTH_REDIRECT_URI must be a valid local callback URL.");
    }
    if (parsed.protocol !== "http:" || !isLoopbackHost(parsed.hostname) || parsed.pathname !== "/auth/google/callback" || parsed.search || parsed.hash) {
      throw new ServiceUnavailableException("GOOGLE_OAUTH_REDIRECT_URI must use the local /auth/google/callback address.");
    }
    return parsed.toString();
  }

  getAuthorizationUrl(state: string): string {
    const { clientId } = this.getClientCredentials();
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return authorizationUrl.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<string | undefined> {
    const { clientId, clientSecret } = this.getClientCredentials();
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: this.getRedirectUri(),
      grant_type: "authorization_code",
    });
    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceUnavailableException("Google OAuth token service is unavailable. Try the local authorization again.");
    }
    const result = await response.json().catch(() => ({})) as GoogleTokenResponse;
    if (!response.ok) throw new ServiceUnavailableException("Google did not accept the authorization code. Check the OAuth client and exact localhost redirect URI, then try again.");
    return result.refresh_token;
  }

  private getClientCredentials(): { clientId: string; clientSecret: string } {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new ServiceUnavailableException("Configure GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET before starting local authorization.");
    return { clientId, clientSecret };
  }
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}
