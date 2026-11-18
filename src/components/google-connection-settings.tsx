"use client";

import { useEffect, useState } from "react";
import { apiFetch, getApiError } from "@/lib/api-client";

type GoogleConnectionStatus = {
  connected: boolean;
  storage: "database" | "environment" | "none";
  connectedAt: string | null;
  connectedBy: string | null;
};

export function GoogleConnectionSettings() {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const queryStatus = new URLSearchParams(window.location.search).get("googleConnection");
    if (queryStatus === "connected") setMessage("Google authorization was saved securely.");
    if (queryStatus === "error") setError("Google could not be connected. Check the OAuth client and try again.");
    void apiFetch("/auth/google/status")
      .then(readJson<GoogleConnectionStatus>)
      .then((result) => { if (active) setStatus(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function connectGoogle() {
    setConnecting(true);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch("/auth/google/start", { method: "POST" }).then(readJson<{ authorizationUrl: string }>);
      const authorizationUrl = new URL(result.authorizationUrl);
      if (authorizationUrl.origin !== "https://accounts.google.com") throw new Error("Google returned an unexpected authorization address.");
      window.location.assign(authorizationUrl.toString());
    } catch (reason) {
      setError((reason as Error).message);
      setConnecting(false);
    }
  }

  const statusLabel = loading
    ? "Checking connection…"
    : status?.storage === "database"
      ? "Connected · encrypted in the database"
      : status?.storage === "environment"
        ? "Connected · currently configured on the server"
        : "Not connected";

  return <section className="google-connection-panel" aria-labelledby="google-connection-title">
    <div className="google-connection-copy">
      <h2 id="google-connection-title">Google authorization</h2>
      <p>Authorize the shared Google Ads and GA4 reporting connection. The refresh token is encrypted before it is stored.</p>
      <p className={`google-connection-status ${status?.connected ? "is-connected" : ""}`} role="status">{statusLabel}</p>
      {status?.storage === "database" && status.connectedAt && <p className="google-connection-meta">Last connected {new Date(status.connectedAt).toLocaleString()}{status.connectedBy ? ` by ${status.connectedBy}` : ""}.</p>}
      {status?.storage === "environment" && <p className="google-connection-meta">Reconnect here to move authorization into encrypted database storage, then remove the legacy refresh-token environment variable.</p>}
      {message && <p className="google-connection-feedback success" role="status">{message}</p>}
      {error && <p className="google-connection-feedback error" role="alert">{error}</p>}
    </div>
    <button className="access-primary-button google-connection-button" type="button" onClick={() => void connectGoogle()} disabled={loading || connecting}>
      {connecting ? "Opening Google…" : status?.storage === "database" ? "Reconnect Google" : status?.storage === "environment" ? "Secure Google connection" : "Connect Google"}
    </button>
  </section>;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(getApiError(data));
  return data as T;
}
