import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import type { AuthenticatedUser, AuthTokens } from "./auth.types";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
interface UserRow { id: string; email: string; password_hash: string; must_reset_password: boolean; is_super_admin: boolean; disabled_at: Date | null }
interface JwtPayload { sub: string; sid: string; iat: number; exp: number }
interface IssueUser { id: string; email: string; mustResetPassword: boolean; isSuperAdmin: boolean; permissions: string[] }

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private signingSecret = "";
  private dummyHash?: Promise<string>;
  private expirySweep?: NodeJS.Timeout;
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    const secret = process.env.AUTH_TOKEN_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) throw new Error("AUTH_TOKEN_SECRET must contain at least 32 characters of random secret material.");
    this.signingSecret = secret;
    await this.ensureSuperAdmin();
    this.expirySweep = setInterval(() => { void this.revokeExpiredUserSessions().catch(() => this.logger.warn("Could not revoke expired authentication sessions.")); }, 60_000);
    this.expirySweep.unref();
  }

  onModuleDestroy(): void { if (this.expirySweep) clearInterval(this.expirySweep); }

  async login(emailInput: unknown, passwordInput: unknown): Promise<AuthTokens> {
    if (typeof emailInput !== "string" || typeof passwordInput !== "string") throw new UnauthorizedException("Email or password is incorrect.");
    const email = normalizeEmail(emailInput);
    const result = await this.database.query<UserRow>("SELECT id, email, password_hash, must_reset_password, is_super_admin, disabled_at FROM app_users WHERE email = $1", [email]);
    const user = result.rows[0];
    const validPassword = await verifyPassword(passwordInput, user?.password_hash ?? await this.getDummyPasswordHash());
    if (!user || user.disabled_at || !validPassword) throw new UnauthorizedException("Email or password is incorrect.");

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const refreshToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(refreshToken);
    await this.database.transaction(async (client) => {
      await client.query("INSERT INTO app_sessions(id, user_id, absolute_expires_at) VALUES ($1, $2, $3)", [sessionId, user.id, expiresAt]);
      await client.query("INSERT INTO app_refresh_tokens(token_hash, session_id, expires_at) VALUES ($1, $2, $3)", [tokenHash, sessionId, expiresAt]);
    });
    const permissions = await this.getPermissions(user.id, user.is_super_admin);
    return this.createTokens({ id: user.id, email: user.email, sessionId, mustResetPassword: user.must_reset_password, isSuperAdmin: user.is_super_admin, permissions }, refreshToken, expiresAt);
  }

  async refresh(refreshToken: string | undefined): Promise<AuthTokens> {
    if (!refreshToken) throw new UnauthorizedException("Your session has expired. Please log in again.");
    const oldHash = hashToken(refreshToken);
    const newRefreshToken = randomBytes(32).toString("base64url");
    const newHash = hashToken(newRefreshToken);
    const outcome = await this.database.transaction(async (client) => {
      const result = await client.query<{ session_id: string; user_id: string; email: string; is_super_admin: boolean; must_reset_password: boolean; disabled_at: Date | null; absolute_expires_at: Date; session_revoked_at: Date | null; expires_at: Date; consumed_at: Date | null }>(
        `SELECT t.session_id, t.expires_at, t.consumed_at, s.user_id, s.absolute_expires_at, s.revoked_at AS session_revoked_at, u.email, u.is_super_admin, u.must_reset_password, u.disabled_at
         FROM app_refresh_tokens t JOIN app_sessions s ON s.id = t.session_id JOIN app_users u ON u.id = s.user_id
         WHERE t.token_hash = $1 FOR UPDATE OF t, s`, [oldHash]);
      const token = result.rows[0];
      if (!token) return { kind: "invalid" as const };
      if (token.consumed_at) {
        await client.query("UPDATE app_sessions SET revoked_at = COALESCE(revoked_at, now()), revoke_reason = COALESCE(revoke_reason, 'refresh_token_reuse') WHERE user_id = $1", [token.user_id]);
        await client.query("INSERT INTO app_audit_events(target_user_id, action) VALUES ($1, 'security.refresh_token_reuse')", [token.user_id]);
        return { kind: "reuse" as const };
      }
      if (token.session_revoked_at || token.disabled_at) return { kind: "revoked" as const };
      if (token.expires_at.getTime() <= Date.now() || token.absolute_expires_at.getTime() <= Date.now()) {
        await client.query("UPDATE app_sessions SET revoked_at = COALESCE(revoked_at, now()), revoke_reason = COALESCE(revoke_reason, 'refresh_expired') WHERE user_id = $1", [token.user_id]);
        await client.query("INSERT INTO app_audit_events(target_user_id, action) VALUES ($1, 'security.refresh_expired')", [token.user_id]);
        return { kind: "expired" as const };
      }
      await client.query("UPDATE app_refresh_tokens SET consumed_at = now(), replaced_by_hash = $2 WHERE token_hash = $1", [oldHash, newHash]);
      await client.query("INSERT INTO app_refresh_tokens(token_hash, session_id, expires_at) VALUES ($1, $2, $3)", [newHash, token.session_id, token.absolute_expires_at]);
      await client.query("UPDATE app_sessions SET last_seen_at = now() WHERE id = $1", [token.session_id]);
      return { kind: "ok" as const, token };
    });
    if (outcome.kind !== "ok") throw new UnauthorizedException(outcome.kind === "expired" || outcome.kind === "reuse" ? "Your session has ended. Please log in again." : "Your session is invalid. Please log in again.");
    const permissions = await this.getPermissions(outcome.token.user_id, outcome.token.is_super_admin);
    return this.createTokens({ id: outcome.token.user_id, email: outcome.token.email, sessionId: outcome.token.session_id, mustResetPassword: outcome.token.must_reset_password, isSuperAdmin: outcome.token.is_super_admin, permissions }, newRefreshToken, outcome.token.absolute_expires_at);
  }

  async authenticateAccess(token: string | undefined): Promise<AuthenticatedUser> {
    const payload = token ? this.verifyAccessToken(token) : null;
    if (!payload) throw new UnauthorizedException("Please log in to continue.");
    const result = await this.database.query<{ id: string; email: string; is_super_admin: boolean; must_reset_password: boolean; disabled_at: Date | null; absolute_expires_at: Date; revoked_at: Date | null }>(
      `SELECT u.id, u.email, u.is_super_admin, u.must_reset_password, u.disabled_at, s.absolute_expires_at, s.revoked_at
       FROM app_users u JOIN app_sessions s ON s.user_id = u.id WHERE u.id = $1 AND s.id = $2`, [payload.sub, payload.sid]);
    const row = result.rows[0];
    if (!row || row.disabled_at || row.revoked_at) throw new UnauthorizedException("Your session is invalid. Please log in again.");
    if (row.absolute_expires_at.getTime() <= Date.now()) {
      await this.revokeAllSessions(row.id, "refresh_expired");
      throw new UnauthorizedException("Your session has ended. Please log in again.");
    }
    const permissions = await this.getPermissions(row.id, row.is_super_admin);
    return { id: row.id, email: row.email, sessionId: payload.sid, isSuperAdmin: row.is_super_admin, mustResetPassword: row.must_reset_password, permissions };
  }

  async changePassword(user: AuthenticatedUser, currentPassword: unknown, newPassword: unknown): Promise<AuthTokens> {
    if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 256) throw new BadRequestException("New password must be between 12 and 256 characters.");
    const result = await this.database.query<UserRow>("SELECT id, email, password_hash, must_reset_password, is_super_admin, disabled_at FROM app_users WHERE id = $1", [user.id]);
    const account = result.rows[0];
    if (!account || account.disabled_at) throw new UnauthorizedException("Account is unavailable.");
    if (typeof currentPassword !== "string" || !(await verifyPassword(currentPassword, account.password_hash))) throw new UnauthorizedException("Current password is incorrect.");
    const passwordHash = await hashPassword(newPassword);
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const refreshToken = randomBytes(32).toString("base64url");
    const newHash = hashToken(refreshToken);
    await this.database.transaction(async (client) => {
      await client.query("UPDATE app_users SET password_hash = $2, must_reset_password = false, updated_at = now() WHERE id = $1", [user.id, passwordHash]);
      await client.query("UPDATE app_sessions SET revoked_at = COALESCE(revoked_at, now()), revoke_reason = COALESCE(revoke_reason, 'password_changed') WHERE user_id = $1", [user.id]);
      await client.query("INSERT INTO app_audit_events(actor_user_id, target_user_id, action) VALUES ($1, $1, 'user.password_changed')", [user.id]);
      await client.query("INSERT INTO app_sessions(id, user_id, absolute_expires_at) VALUES ($1, $2, $3)", [sessionId, user.id, expiresAt]);
      await client.query("INSERT INTO app_refresh_tokens(token_hash, session_id, expires_at) VALUES ($1, $2, $3)", [newHash, sessionId, expiresAt]);
    });
    const permissions = await this.getPermissions(user.id, account.is_super_admin);
    return this.createTokens({ id: user.id, email: account.email, sessionId, mustResetPassword: false, isSuperAdmin: account.is_super_admin, permissions }, refreshToken, expiresAt);
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query("UPDATE app_sessions SET revoked_at = COALESCE(revoked_at, now()), revoke_reason = COALESCE(revoke_reason, 'logout') WHERE user_id = $1", [user.id]);
      await client.query("INSERT INTO app_audit_events(actor_user_id, target_user_id, action) VALUES ($1, $1, 'user.logout_all_sessions')", [user.id]);
    });
  }

  async revokeAllSessions(userId: string, reason: string): Promise<void> {
    await this.database.query("UPDATE app_sessions SET revoked_at = COALESCE(revoked_at, now()), revoke_reason = COALESCE(revoke_reason, $2) WHERE user_id = $1", [userId, reason]);
  }

  private async revokeExpiredUserSessions(): Promise<void> {
    await this.database.query(
      `WITH expired_users AS (
         SELECT DISTINCT user_id FROM app_sessions WHERE revoked_at IS NULL AND absolute_expires_at <= now()
       ), revoked_sessions AS (
         UPDATE app_sessions s SET revoked_at = now(), revoke_reason = 'refresh_expired'
         FROM expired_users e WHERE s.user_id = e.user_id AND s.revoked_at IS NULL
         RETURNING s.user_id
       )
       INSERT INTO app_audit_events(target_user_id, action, details)
       SELECT DISTINCT user_id, 'security.refresh_expired', '{"source":"expiry_sweeper"}'::jsonb FROM revoked_sessions`);
  }

  async listUser(userId: string): Promise<{ id: string; email: string; mustResetPassword: boolean; isSuperAdmin: boolean; roleId: string | null; roleName: string | null; createdAt: string } | null> {
    const result = await this.database.query<{ id: string; email: string; must_reset_password: boolean; is_super_admin: boolean; role_id: string | null; role_name: string | null; created_at: Date }>(
      `SELECT u.id, u.email, u.must_reset_password, u.is_super_admin, ur.role_id, r.name AS role_name, u.created_at
       FROM app_users u LEFT JOIN app_user_roles ur ON ur.user_id = u.id LEFT JOIN app_roles r ON r.id = ur.role_id WHERE u.id = $1`, [userId]);
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, mustResetPassword: row.must_reset_password, isSuperAdmin: row.is_super_admin, roleId: row.role_id, roleName: row.role_name, createdAt: row.created_at.toISOString() } : null;
  }

  private async ensureSuperAdmin(): Promise<void> {
    const existing = await this.database.query<{ id: string }>("SELECT id FROM app_users WHERE is_super_admin = true LIMIT 1");
    if (existing.rowCount) { delete process.env.SUPER_ADMIN_INITIAL_PASSWORD; return; }
    const bootstrapMarker = await this.database.query<{ key: string }>("SELECT key FROM app_system_state WHERE key = 'super_admin_bootstrapped'");
    if (bootstrapMarker.rowCount) throw new Error("The Super Admin bootstrap marker exists but its protected account is missing. Restore the account from backup; bootstrap credentials will not be reapplied.");
    const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL ?? "");
    const password = process.env.SUPER_ADMIN_INITIAL_PASSWORD;
    if (!email || !EMAIL_PATTERN.test(email) || !password || password.length < 16) throw new Error("Fresh database bootstrap requires SUPER_ADMIN_EMAIL and a strong SUPER_ADMIN_INITIAL_PASSWORD (at least 16 characters).");
    const passwordHash = await hashPassword(password);
    delete process.env.SUPER_ADMIN_INITIAL_PASSWORD;
    try {
      await this.database.transaction(async (client) => {
        const created = await client.query<{ id: string }>("INSERT INTO app_users(email, password_hash, must_reset_password, is_super_admin) VALUES ($1, $2, true, true) ON CONFLICT DO NOTHING RETURNING id", [email, passwordHash]);
        if (!created.rowCount) {
          const existingAdmin = await client.query<{ id: string }>("SELECT id FROM app_users WHERE is_super_admin = true LIMIT 1");
          if (existingAdmin.rowCount) return;
          throw new Error("The configured Super Admin email already belongs to a regular user.");
        }
        await client.query("INSERT INTO app_system_state(key, value) VALUES ('super_admin_bootstrapped', $1::jsonb) ON CONFLICT (key) DO NOTHING", [JSON.stringify({ userId: created.rows[0].id, createdAt: new Date().toISOString() })]);
        await client.query("INSERT INTO app_audit_events(actor_user_id, target_user_id, action, details) VALUES ($1, $1, 'super_admin.bootstrapped', $2::jsonb)", [created.rows[0].id, JSON.stringify({ email })]);
      });
    } catch {
      throw new Error("Could not create the initial Super Admin. Check SUPER_ADMIN_EMAIL and verify the database migration completed.");
    }
  }

  private getDummyPasswordHash(): Promise<string> {
    if (!this.dummyHash) this.dummyHash = hashPassword(randomBytes(32).toString("base64url"));
    return this.dummyHash;
  }

  private async getPermissions(userId: string, isSuperAdmin: boolean): Promise<string[]> {
    if (isSuperAdmin) {
      const all = await this.database.query<{ code: string }>("SELECT code FROM app_permissions ORDER BY code");
      return all.rows.map((row) => row.code);
    }
    const result = await this.database.query<{ permission_code: string }>(
      "SELECT rp.permission_code FROM app_user_roles ur JOIN app_role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = $1 ORDER BY rp.permission_code", [userId]);
    return result.rows.map((row) => row.permission_code);
  }

  private createTokens(user: IssueUser & { sessionId: string }, refreshToken: string, expiresAt: Date): AuthTokens {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = signJwt({ sub: user.id, sid: user.sessionId, iat: now, exp: now + ACCESS_TTL_SECONDS }, this.signingSecret);
    return { accessToken, refreshToken, csrfToken: randomBytes(32).toString("base64url"), expiresAt: expiresAt.toISOString(), user: { id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin, mustResetPassword: user.mustResetPassword, permissions: user.permissions } };
  }

  private verifyAccessToken(token: string): JwtPayload | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const input = `${parts[0]}.${parts[1]}`;
    const expected = createHmac("sha256", this.signingSecret).update(input).digest();
    let actual: Buffer;
    try { actual = Buffer.from(parts[2], "base64url"); } catch { return null; }
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<JwtPayload>;
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
      return payload as JwtPayload;
    } catch { return null; }
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveScrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw] = stored.split("$");
  if (algorithm !== "scrypt" || !saltRaw || !hashRaw) return false;
  try {
    const expected = Buffer.from(hashRaw, "base64url");
    const actual = await deriveScrypt(password, Buffer.from(saltRaw, "base64url"), expected.length, { N: Number(nRaw), r: Number(rRaw), p: Number(pRaw), maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

function deriveScrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

function signJwt(payload: JwtPayload, secret: string): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const input = `${header}.${body}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

function encodeBase64Url(value: string): string { return Buffer.from(value).toString("base64url"); }
function hashToken(token: string): string { return createHmac("sha256", process.env.AUTH_TOKEN_SECRET ?? "").update(token).digest("hex"); }
function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
