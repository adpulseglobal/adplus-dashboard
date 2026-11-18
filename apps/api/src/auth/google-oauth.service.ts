import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { GoogleTokenVault, type GoogleConnectionStatus } from "../providers/google-token-vault.service";

interface GoogleTokenResponse {
  refresh_token?: string;
}

@Injectable()
export class GoogleOAuthService {
  constructor(private readonly database: DatabaseService, private readonly tokenVault: GoogleTokenVault) {}

  async createState(state: string, userId: string): Promise<void> {
    this.tokenVault.assertEncryptionConfigured();
    const stateHash = hashState(state);
    await this.database.query("DELETE FROM app_google_oauth_states WHERE expires_at < now() OR consumed_at < now() - interval '1 day'");
    await this.database.query(
      "INSERT INTO app_google_oauth_states(state_hash, initiated_by, expires_at) VALUES ($1, $2, now() + interval '10 minutes')",
      [stateHash, userId],
    );
  }

  async consumeState(state: string): Promise<string | undefined> {
    const result = await this.database.query<{ initiated_by: string }>(
      `UPDATE app_google_oauth_states
       SET consumed_at = now()
       FROM app_users u
       WHERE app_google_oauth_states.state_hash = $1
         AND app_google_oauth_states.consumed_at IS NULL
         AND app_google_oauth_states.expires_at > now()
         AND u.id = app_google_oauth_states.initiated_by
         AND u.is_super_admin = true
         AND u.disabled_at IS NULL
       RETURNING app_google_oauth_states.initiated_by`,
      [hashState(state)],
    );
    return result.rows[0]?.initiated_by;
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
      throw new ServiceUnavailableException("Google OAuth token service is unavailable. Try connecting Google again.");
    }
    const result = await response.json().catch(() => ({})) as GoogleTokenResponse;
    if (!response.ok) throw new ServiceUnavailableException("Google did not accept the authorization code. Check the OAuth client and exact production callback URI, then retry.");
    return result.refresh_token;
  }

  saveRefreshToken(refreshToken: string, connectedBy: string): Promise<void> {
    return this.tokenVault.saveRefreshToken(refreshToken, connectedBy);
  }

  getConnectionStatus(): Promise<GoogleConnectionStatus> {
    return this.tokenVault.getStatus();
  }

  private getRedirectUri(): string {
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000/auth/google/callback");
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new ServiceUnavailableException("GOOGLE_OAUTH_REDIRECT_URI must be configured as the exact Google OAuth callback URL.");
    }
    const validPath = parsed.pathname === "/auth/google/callback" && !parsed.search && !parsed.hash && !parsed.username && !parsed.password;
    const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    const validTransport = process.env.NODE_ENV === "production"
      ? parsed.protocol === "https:" && parsed.origin === webOrigin
      : parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname));
    if (!validPath || !validTransport) {
      throw new ServiceUnavailableException("GOOGLE_OAUTH_REDIRECT_URI must use HTTPS in production and end with /auth/google/callback.");
    }
    return parsed.toString();
  }

  private getClientCredentials(): { clientId: string; clientSecret: string } {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new ServiceUnavailableException("Configure GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET before connecting Google.");
    return { clientId, clientSecret };
  }
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}
