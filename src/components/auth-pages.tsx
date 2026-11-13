"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { apiFetch, getApiError } from "@/lib/api-client";

type AuthUser = { id: string; email: string; mustResetPassword: boolean };

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await apiFetch("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getApiError(result, "Sign-in failed."));
      const user = result.user as AuthUser;
      const destination = user.mustResetPassword ? "/reset-password" : safeNextDestination();
      window.location.assign(destination);
    } catch (reason) { setError((reason as Error).message); setBusy(false); }
  }

  return <main className="auth-page auth-login-page">
    <aside className="auth-brand-panel" aria-labelledby="auth-slogan">
      <div className="auth-brand auth-brand-inverse"><Activity size={23} strokeWidth={2} aria-hidden="true" /> <span>adpulse<span>.</span></span></div>
      <div className="auth-brand-copy">
        <p className="auth-eyebrow">CLARITY FOR EVERY CAMPAIGN</p>
        <h2 id="auth-slogan">One clear view of what drives growth.</h2>
        <p>Bring your advertising performance and website traffic into focus.</p>
      </div>
      <div className="auth-brand-foot"><span>Google Ads</span><span aria-hidden="true">·</span><span>Google Analytics 4</span></div>
    </aside>
    <section className="auth-login-main" aria-labelledby="login-title">
      <div className="auth-panel auth-login-panel">
        <p className="auth-eyebrow auth-login-eyebrow">WELCOME BACK</p>
        <h1 id="login-title">Sign in</h1><p className="auth-intro">Use your AdPulse account to continue.</p>
        {error && <p className="access-feedback error" role="alert">{error}</p>}
        <form className="auth-form" onSubmit={submit}>
          <label className="access-field"><span>Email</span><input type="email" name="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="access-field"><span>Password</span><input type="password" name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="access-primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
    </section>
  </main>;
}

export function ResetPasswordPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch("/auth/me").then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Sign in to continue.");
      setUser(result as AuthUser);
      if (!(result as AuthUser).mustResetPassword) window.location.replace("/");
    }).catch(() => window.location.replace("/login?next=%2Freset-password"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (newPassword !== confirmPassword) { setError("The new passwords do not match."); return; }
    if (newPassword.length < 12) { setError("Use at least 12 characters for your new password."); return; }
    setBusy(true);
    try {
      const response = await apiFetch("/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getApiError(result, "Password could not be changed."));
      window.location.assign("/");
    } catch (reason) { setError((reason as Error).message); setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-panel" aria-labelledby="reset-title">
    <Link className="auth-brand" href="/"><Activity size={23} strokeWidth={2} /> <span>adpulse<span>.</span></span></Link>
    <h1 id="reset-title">Set a new password</h1><p className="auth-intro">{user?.email ? `Choose a new password for ${user.email}.` : "A password change is required before you can view reports."}</p>
    {error && <p className="access-feedback error" role="alert">{error}</p>}
    <form className="auth-form" onSubmit={submit}>
      <label className="access-field"><span>{user?.mustResetPassword ? "Temporary password" : "Current password"}</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
      <label className="access-field"><span>New password</span><input type="password" aria-describedby="new-password-rule" autoComplete="new-password" minLength={12} maxLength={256} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><small id="new-password-rule">Use 12–256 characters.</small></label>
      <label className="access-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
      <button className="access-primary-button" type="submit" disabled={busy || !user}>{busy ? "Saving…" : "Save new password"}</button>
    </form>
  </section></main>;
}

function safeNextDestination(): string {
  const candidate = new URLSearchParams(window.location.search).get("next") ?? "/";
  return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/";
}
