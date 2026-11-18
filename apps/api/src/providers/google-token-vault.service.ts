import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DatabaseService } from "../database/database.service";

interface EncryptedTokenRow {
  refresh_token_ciphertext: Buffer;
  refresh_token_iv: Buffer;
  refresh_token_auth_tag: Buffer;
}

interface ConnectionStatusRow {
  connected_at: Date;
  connected_by_email: string | null;
}

export interface GoogleConnectionStatus {
  connected: boolean;
  storage: "database" | "environment" | "none";
  connectedAt: string | null;
  connectedBy: string | null;
}

@Injectable()
export class GoogleTokenVault {
  constructor(private readonly database: DatabaseService) {}

  assertEncryptionConfigured(): void {
    this.getEncryptionKey();
  }

  async getRefreshToken(): Promise<string | undefined> {
    const result = await this.database.query<EncryptedTokenRow>(
      "SELECT refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag FROM app_google_oauth_connection WHERE connection_key = 'shared'",
    );
    const row = result.rows[0];
    if (!row) return undefined;

    try {
      const decipher = createDecipheriv("aes-256-gcm", this.getEncryptionKey(), row.refresh_token_iv);
      decipher.setAuthTag(row.refresh_token_auth_tag);
      return Buffer.concat([decipher.update(row.refresh_token_ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new ServiceUnavailableException("The stored Google connection could not be decrypted. Check GOOGLE_TOKEN_ENCRYPTION_KEY.");
    }
  }

  async saveRefreshToken(refreshToken: string, connectedBy: string): Promise<void> {
    if (!refreshToken) throw new ServiceUnavailableException("Google did not provide a refresh token. Reauthorize the Google connection and grant offline access.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO app_google_oauth_connection
           (connection_key, refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag, connected_by, connected_at, updated_at)
         VALUES ('shared', $1, $2, $3, $4, now(), now())
         ON CONFLICT (connection_key) DO UPDATE SET
           refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
           refresh_token_iv = EXCLUDED.refresh_token_iv,
           refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
           connected_by = EXCLUDED.connected_by,
           connected_at = now(),
           updated_at = now()`,
        [ciphertext, iv, authTag, connectedBy],
      );
      await client.query(
        "INSERT INTO app_audit_events(actor_user_id, action, details) VALUES ($1, 'google.connection.authorized', $2::jsonb)",
        [connectedBy, JSON.stringify({ storage: "encrypted_database" })],
      );
    });
  }

  async getStatus(): Promise<GoogleConnectionStatus> {
    const result = await this.database.query<ConnectionStatusRow>(
      `SELECT c.connected_at, u.email AS connected_by_email
       FROM app_google_oauth_connection c
       LEFT JOIN app_users u ON u.id = c.connected_by
       WHERE c.connection_key = 'shared'`,
    );
    const row = result.rows[0];
    if (row) {
      return { connected: true, storage: "database", connectedAt: row.connected_at.toISOString(), connectedBy: row.connected_by_email };
    }

    const legacyEnvironmentToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    return {
      connected: Boolean(legacyEnvironmentToken),
      storage: legacyEnvironmentToken ? "environment" : "none",
      connectedAt: null,
      connectedBy: null,
    };
  }

  private getEncryptionKey(): Buffer {
    const value = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    if (!value || !/^[a-f\d]{64}$/i.test(value)) {
      throw new ServiceUnavailableException("Set GOOGLE_TOKEN_ENCRYPTION_KEY to a persistent 32-byte hex key before connecting Google.");
    }
    return Buffer.from(value, "hex");
  }
}
