import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { AuthService, hashPassword } from "../auth/auth.service";
import type { AuthenticatedUser } from "../auth/auth.types";

export interface PermissionRow { code: string; description: string }
interface RoleRow { id: string; name: string; created_at: Date; permissions: string[] }
interface UserRow { id: string; email: string; must_reset_password: boolean; is_super_admin: boolean; created_at: Date; role_id: string | null; role_name: string | null }

@Injectable()
export class AdminService {
  constructor(private readonly database: DatabaseService, private readonly auth: AuthService) {}

  async listPermissions(): Promise<PermissionRow[]> {
    const result = await this.database.query<PermissionRow>("SELECT code, description FROM app_permissions ORDER BY code");
    return result.rows;
  }

  async listRoles(): Promise<Array<{ id: string; name: string; createdAt: string; permissions: string[] }>> {
    const result = await this.database.query<RoleRow>(
      `SELECT r.id, r.name, r.created_at, COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
       FROM app_roles r LEFT JOIN app_role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.name`);
    return result.rows.map((role) => ({ id: role.id, name: role.name, createdAt: role.created_at.toISOString(), permissions: role.permissions }));
  }

  async createRole(actor: AuthenticatedUser, nameInput: unknown, permissionsInput: unknown) {
    const name = typeof nameInput === "string" ? nameInput.trim() : "";
    if (!name || name.length > 80) throw new BadRequestException("Role name must be between 1 and 80 characters.");
    if (["super admin", "super_admin"].includes(name.toLowerCase())) throw new BadRequestException("The protected Super Admin role cannot be created or assigned.");
    if (!Array.isArray(permissionsInput) || permissionsInput.some((item) => typeof item !== "string")) throw new BadRequestException("Select valid permissions for the role.");
    const permissionCodes = [...new Set(permissionsInput as string[])];
    const available = await this.listPermissions();
    const availableCodes = new Set(available.map(({ code }) => code));
    if (permissionCodes.some((code) => !availableCodes.has(code))) throw new BadRequestException("The role includes an unknown permission.");
    if (!actor.isSuperAdmin && permissionCodes.some((code) => !actor.permissions.includes(code))) throw new ForbiddenException("You cannot grant permissions that you do not have.");
    try {
      return await this.database.transaction(async (client) => {
        const created = await client.query<{ id: string; name: string; created_at: Date }>("INSERT INTO app_roles(name, created_by) VALUES ($1, $2) RETURNING id, name, created_at", [name, actor.id]);
        const role = created.rows[0];
        for (const code of permissionCodes) await client.query("INSERT INTO app_role_permissions(role_id, permission_code) VALUES ($1, $2)", [role.id, code]);
        await client.query("INSERT INTO app_audit_events(actor_user_id, action, details) VALUES ($1, 'role.created', $2::jsonb)", [actor.id, JSON.stringify({ roleId: role.id, name: role.name, permissions: permissionCodes })]);
        return { id: role.id, name: role.name, createdAt: role.created_at.toISOString(), permissions: permissionCodes };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("A role with that name already exists.");
      throw error;
    }
  }

  async listUsers() {
    const result = await this.database.query<UserRow>(
      `SELECT u.id, u.email, u.must_reset_password, u.is_super_admin, u.created_at, ur.role_id, r.name AS role_name
       FROM app_users u LEFT JOIN app_user_roles ur ON ur.user_id = u.id LEFT JOIN app_roles r ON r.id = ur.role_id
       ORDER BY u.is_super_admin DESC, u.email`);
    return result.rows.map((row) => ({ id: row.id, email: row.email, mustResetPassword: row.must_reset_password, isSuperAdmin: row.is_super_admin, createdAt: row.created_at.toISOString(), roleId: row.role_id, roleName: row.role_name }));
  }

  async createUser(actor: AuthenticatedUser, emailInput: unknown, roleIdInput: unknown) {
    const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new BadRequestException("Enter a valid email address.");
    if (typeof roleIdInput !== "string" || !isUuid(roleIdInput)) throw new BadRequestException("Choose one valid role for this user.");
    this.ensureActorCanAssignRole(actor, roleIdInput);
    const temporaryPassword = randomBytes(24).toString("base64url");
    const passwordHash = await hashPassword(temporaryPassword);
    try {
      const created = await this.database.transaction(async (client) => {
        const userResult = await client.query<{ id: string; email: string }>("INSERT INTO app_users(email, password_hash, must_reset_password) VALUES ($1, $2, true) RETURNING id, email", [email, passwordHash]);
        const user = userResult.rows[0];
        await client.query("INSERT INTO app_user_roles(user_id, role_id, assigned_by) VALUES ($1, $2, $3)", [user.id, roleIdInput, actor.id]);
        await client.query("INSERT INTO app_audit_events(actor_user_id, target_user_id, action, details) VALUES ($1, $2, 'user.created', $3::jsonb)", [actor.id, user.id, JSON.stringify({ email: user.email, roleId: roleIdInput })]);
        return user;
      });
      return { user: { ...created, mustResetPassword: true, roleId: roleIdInput }, credentials: { email: created.email, temporaryPassword } };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("A user with that email already exists.");
      if (isForeignKeyViolation(error)) throw new BadRequestException("The selected role no longer exists.");
      throw error;
    }
  }

  async assignRole(actor: AuthenticatedUser, userId: string, roleIdInput: unknown) {
    if (!isUuid(userId) || typeof roleIdInput !== "string" || !isUuid(roleIdInput)) throw new BadRequestException("Choose one valid user and role.");
    await this.ensureActorCanAssignRole(actor, roleIdInput);
    const target = await this.database.query<{ is_super_admin: boolean }>("SELECT is_super_admin FROM app_users WHERE id = $1", [userId]);
    if (!target.rowCount) throw new NotFoundException("User not found.");
    if (target.rows[0].is_super_admin) throw new ForbiddenException("The Super Admin account cannot be assigned a role.");
    try {
      await this.database.transaction(async (client) => {
        await client.query(
          `INSERT INTO app_user_roles(user_id, role_id, assigned_by) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`, [userId, roleIdInput, actor.id]);
        await client.query("INSERT INTO app_audit_events(actor_user_id, target_user_id, action, details) VALUES ($1, $2, 'user.role_assigned', $3::jsonb)", [actor.id, userId, JSON.stringify({ roleId: roleIdInput })]);
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) throw new BadRequestException("The selected role no longer exists.");
      throw error;
    }
    await this.auth.revokeAllSessions(userId, "role_changed");
    return { ok: true };
  }

  async resetUserPassword(actor: AuthenticatedUser, userId: string) {
    if (!isUuid(userId)) throw new BadRequestException("Invalid user identifier.");
    const exists = await this.database.query<{ id: string; is_super_admin: boolean }>("SELECT id, is_super_admin FROM app_users WHERE id = $1", [userId]);
    if (!exists.rowCount) throw new NotFoundException("User not found.");
    if (exists.rows[0].is_super_admin) throw new ForbiddenException("Reset the Super Admin password through the account's own password change flow.");
    const temporaryPassword = randomBytes(24).toString("base64url");
    const passwordHash = await hashPassword(temporaryPassword);
    await this.database.transaction(async (client) => {
      await client.query("UPDATE app_users SET password_hash = $2, must_reset_password = true, updated_at = now() WHERE id = $1", [userId, passwordHash]);
      await client.query("UPDATE app_sessions SET revoked_at = COALESCE(revoked_at, now()), revoke_reason = COALESCE(revoke_reason, 'admin_password_reset') WHERE user_id = $1", [userId]);
      await client.query("INSERT INTO app_audit_events(actor_user_id, target_user_id, action) VALUES ($1, $2, 'user.password_reset')", [actor.id, userId]);
    });
    const user = await this.auth.listUser(userId);
    if (!user) throw new NotFoundException("User not found.");
    return { user: { id: user.id, email: user.email, mustResetPassword: true }, credentials: { email: user.email, temporaryPassword } };
  }

  private async ensureActorCanAssignRole(actor: AuthenticatedUser, roleId: string): Promise<void> {
    const result = await this.database.query<{ code: string }>("SELECT permission_code AS code FROM app_role_permissions WHERE role_id = $1", [roleId]);
    if (!result.rowCount && !(await this.database.query("SELECT 1 FROM app_roles WHERE id = $1", [roleId])).rowCount) throw new BadRequestException("The selected role does not exist.");
    if (!actor.isSuperAdmin && result.rows.some(({ code }) => !actor.permissions.includes(code))) throw new ForbiddenException("You cannot assign a role with permissions that you do not have.");
  }
}

function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "23505"; }
function isForeignKeyViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "23503"; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
