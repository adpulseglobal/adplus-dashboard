"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, getApiError } from "@/lib/api-client";

type Permission = { code: string; description: string };
type Role = { id: string; name: string; permissions: string[] };
type User = { id: string; email: string; mustResetPassword: boolean; isSuperAdmin: boolean; roleId: string | null; roleName: string | null; createdAt: string };

export function AccessControlSettings({ permissions, isSuperAdmin, view }: { permissions: string[]; isSuperAdmin: boolean; view: "roles" | "users" }) {
  const canViewUsers = isSuperAdmin || permissions.includes("users.view");
  const canViewRoles = isSuperAdmin || permissions.includes("roles.view");
  const canCreateRole = isSuperAdmin || (permissions.includes("roles.create") && permissions.includes("roles.view"));
  const canCreateUser = isSuperAdmin || (permissions.includes("users.create") && permissions.includes("users.assign_role") && permissions.includes("roles.view"));
  const canAssignRole = isSuperAdmin || (permissions.includes("users.assign_role") && permissions.includes("roles.view"));
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<Permission[]>([]);
  const [email, setEmail] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    const requests: Array<Promise<void>> = [];
    if (view === "users" && canViewUsers) requests.push(apiFetch("/admin/users").then(readJson<User[]>).then(setUsers).catch((reason: Error) => setError(reason.message)));
    if ((view === "roles" && canViewRoles) || (view === "users" && (canCreateUser || canAssignRole))) requests.push(apiFetch("/admin/roles").then(readJson<Role[]>).then(setRoles).catch((reason: Error) => setError(reason.message)));
    if (view === "roles" && (canCreateRole || canViewRoles)) requests.push(apiFetch("/admin/permissions").then(readJson<Permission[]>).then(setAvailablePermissions).catch((reason: Error) => setError(reason.message)));
    await Promise.all(requests);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    try {
      const result = await apiFetch("/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, roleId: selectedRoleId }) }).then(readJson<{ user: User; credentials: { email: string; temporaryPassword: string } }>);
      downloadCredentials(result.credentials);
      setEmail(""); setMessage("User created. Download the temporary credentials and share them privately.");
      await load();
    } catch (reason) { const message = (reason as Error).message; await load(); setError(message); }
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    try {
      await apiFetch("/admin/roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: roleName, permissions: selectedPermissions }) }).then(readJson<Role>);
      setRoleName(""); setSelectedPermissions([]); setMessage("Role created."); await load();
    } catch (reason) { setError((reason as Error).message); }
  }

  async function updateRole(userId: string, roleId: string) {
    setError(""); setMessage("");
    try { await apiFetch(`/admin/users/${encodeURIComponent(userId)}/role`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ roleId }) }).then(readJson); setMessage("User role updated; their active sessions were signed out."); await load(); }
    catch (reason) { setError((reason as Error).message); }
  }

  async function resetPassword(userId: string) {
    setError(""); setMessage("");
    try {
      const result = await apiFetch(`/admin/users/${encodeURIComponent(userId)}/reset-password`, { method: "POST" }).then(readJson<{ credentials: { email: string; temporaryPassword: string } }>);
      downloadCredentials(result.credentials); setMessage("Temporary credentials downloaded. Share them privately."); await load();
    } catch (reason) { setError((reason as Error).message); }
  }

  return <section className="access-settings" aria-labelledby="access-settings-title">
    <header className="access-settings-heading"><div><h2 id="access-settings-title">{view === "roles" ? "Role creation" : "User creation"}</h2><p>{view === "roles" ? "Create roles and choose which reporting and administration permissions they receive." : "Create user accounts, assign a role, and download temporary credentials for sharing."}</p></div></header>
    {message && <p className="access-feedback success" role="status">{message}</p>}
    {error && <p className="access-feedback error" role="alert">{error}</p>}
    {loading && <p className="access-empty" role="status">Loading access settings…</p>}
    {!loading && view === "roles" && canCreateRole && <form className="access-form role-form" onSubmit={createRole}>
      <h3>Create a role</h3>
      <label className="access-field"><span>Role name</span><input value={roleName} onChange={(event) => setRoleName(event.target.value)} maxLength={80} required /></label>
      <fieldset className="permission-list"><legend>Permissions</legend>{availablePermissions.map((permission) => <label key={permission.code}><input type="checkbox" checked={selectedPermissions.includes(permission.code)} onChange={(event) => setSelectedPermissions((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code))} /><span><strong>{permission.code}</strong><small>{permission.description}</small></span></label>)}</fieldset>
      <button className="access-primary-button" type="submit">Create role</button>
    </form>}
    {!loading && view === "users" && canCreateUser && <form className="access-form user-form" onSubmit={createUser}>
      <h3>Create a user</h3>
      <label className="access-field"><span>Email address</span><input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></label>
      <label className="access-field"><span>Role</span><select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)} required><option value="">Choose a role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      <p className="access-help">A random temporary password is generated. Download the JSON once after creation; the user must replace it at first sign-in.</p>
      <button className="access-primary-button" type="submit" disabled={!roles.length}>Create user and download credentials</button>
    </form>}
    {!loading && view === "roles" && canViewRoles && <section className="access-list-section"><h3>Roles</h3>{roles.length ? <div className="access-role-grid">{roles.map((role) => <article className="access-role-card" key={role.id}><strong>{role.name}</strong><span>{role.permissions.length ? role.permissions.join(" · ") : "No permissions"}</span></article>)}</div> : <p className="access-empty">No roles created yet.</p>}</section>}
    {!loading && view === "users" && canViewUsers && <section className="access-list-section"><h3>Users</h3>{users.length ? <div className="access-user-list">{users.map((user) => <article className="access-user-row" key={user.id}><div className="access-user-identity"><strong>{user.email}</strong><span>{user.isSuperAdmin ? "Super Admin · protected account" : user.mustResetPassword ? "Password reset required" : "Active"}</span></div><div className="access-user-controls">{user.isSuperAdmin ? <span className="protected-label">Super Admin</span> : <>
        {canAssignRole && <select aria-label={`Role for ${user.email}`} value={user.roleId ?? ""} onChange={(event) => { if (event.target.value) void updateRole(user.id, event.target.value); }}><option value="" disabled>No role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>}
        {(isSuperAdmin || permissions.includes("users.create")) && <button className="access-secondary-button" type="button" onClick={() => void resetPassword(user.id)}>Reset password</button>}
      </>}</div></article>)}</div> : <p className="access-empty">No users found.</p>}</section>}
  </section>;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(getApiError(data));
  return data as T;
}

function downloadCredentials(credentials: { email: string; temporaryPassword: string }) {
  const payload = { email: credentials.email, temporaryPassword: credentials.temporaryPassword, mustResetPasswordAtFirstLogin: true };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${credentials.email.replace(/[^a-z0-9.-]/gi, "_")}-credentials.json`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
