"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Activity, ArrowRight, BarChart3, Calculator, CreditCard, LayoutDashboard, LogOut, MousePointer2, Menu, Search, Settings, ShoppingBag, Target, UserRoundCheck, Users, X, Zap } from "lucide-react";
import { FilterBar, type SelectedSources } from "@/components/filter-bar";
import { AccessControlSettings } from "@/components/access-control-settings";
import { GoogleConnectionSettings } from "@/components/google-connection-settings";
import { apiFetch, apiUrl, getApiError } from "@/lib/api-client";
import { count } from "@/lib/demo-report";
import { parseDashboardFiltersFromSearch, serializeDashboardFilters, type DashboardFilters } from "@contracts/dashboard-filters";

type Section = "overview" | "google-ads" | "ga4" | "settings";
type SourceLoadState = "idle" | "loading" | "error" | "ready";
type SessionUser = { id: string; email: string; isSuperAdmin: boolean; mustResetPassword: boolean; permissions: string[] };
const navItems = [
  { label: "Overview", href: "/", icon: LayoutDashboard, key: "overview" as const },
  { label: "Google Ads", href: "/google-ads", icon: Search, key: "google-ads" as const },
  { label: "GA4 Analytics", href: "/ga4", icon: Activity, key: "ga4" as const },
];
type AdsReport = { mode: "live" | "mock"; currency: string; period: { startDate: string; endDate: string }; totals: { spend: number; clicks: number; impressions: number; conversions: number; ctr: number; costPerConversion: number | null }; campaigns: Array<{ id: string; name: string; status: string; campaignType: string; spend: number; clicks: number; ctr: number; conversions: number }>; daily: Array<{ date?: string; spend: number }> ; devices: Array<{ device?: string; clicks: number; conversions: number; spend: number }>; campaignTypes: Array<{ campaignType?: string; spend: number; conversions: number }> };
type Ga4Report = { mode: "live" | "mock"; period: { startDate: string; endDate: string }; totals: { sessions: number; users: number; engagedSessions: number; engagementRate: number; keyEvents: number }; daily: Array<{ date: string; sessions: number }>; channels: Array<{ name: string; sessions: number }>; sourceMediums: Array<{ name: string; sessions: number }>; landingPages: Array<{ name: string; sessions: number }>; devices: Array<{ name: string; sessions: number }>; truncated: boolean };

function Sidebar({ section, query, onNavigate, user, onLogout, logoutError }: { section: Section; query: string; onNavigate: () => void; user: SessionUser; onLogout: () => void; logoutError: string }) {
  const visibleItems = navItems.filter(({ key }) => key === "overview" ? user.permissions.includes("google_ads.view") || user.permissions.includes("ga4.view") || user.isSuperAdmin : key === "google-ads" ? user.permissions.includes("google_ads.view") || user.isSuperAdmin : user.permissions.includes("ga4.view") || user.isSuperAdmin);
  return <>
    <Link href={`/${query}`} className="brand" onClick={onNavigate}><Activity size={25} strokeWidth={2} /><span>adpulse<span className="brand-period">.</span></span></Link>
    <nav className="primary-nav" aria-label="Main navigation">
      {visibleItems.map(({ label, href, icon: Icon, key }) => <Link key={key} href={`${href}${query}`} onClick={onNavigate} className={`nav-link ${section === key ? "selected" : ""}`} aria-current={section === key ? "page" : undefined}><Icon size={17} strokeWidth={1.6} /><span>{label}</span></Link>)}
    </nav>
    <div className="sidebar-bottom"><Link href={`/settings${query}`} onClick={onNavigate} className={`nav-link sidebar-settings-link ${section === "settings" ? "selected" : ""}`} aria-current={section === "settings" ? "page" : undefined}><Settings size={17} strokeWidth={1.6} /><span>Settings</span></Link><div className="profile"><div><strong>{user.email}</strong><span>{user.isSuperAdmin ? "Super Admin" : "AdPulse user"}</span></div><button type="button" className="profile-logout" onClick={onLogout} aria-label="Sign out"><LogOut size={16} /></button></div>{logoutError && <p className="logout-error" role="alert">{logoutError}</p>}</div>
  </>;
}

type SettingsTab = "sources" | "roles" | "users";

function SettingsWorkspace({ permissions, isSuperAdmin, allowedSources, onSelectionChange }: {
  permissions: string[];
  isSuperAdmin: boolean;
  allowedSources: { googleAds: boolean; ga4: boolean };
  onSelectionChange: (selection: SelectedSources) => void;
}) {
  const [selectedTab, setSelectedTab] = useState<SettingsTab>("sources");
  const canCreateUser = isSuperAdmin || (permissions.includes("users.create") && permissions.includes("users.assign_role") && permissions.includes("roles.view"));
  const tabs: Array<{ id: SettingsTab; label: string }> = [];
  if (allowedSources.googleAds || allowedSources.ga4) tabs.push({ id: "sources", label: "Reporting sources" });
  if (isSuperAdmin || permissions.includes("roles.view")) tabs.push({ id: "roles", label: "Role creation" });
  if (isSuperAdmin || permissions.includes("users.view") || canCreateUser) tabs.push({ id: "users", label: "User creation" });
  const activeTab = tabs.some((tab) => tab.id === selectedTab) ? selectedTab : tabs[0]?.id;

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setSelectedTab(nextTab.id);
    document.getElementById(`settings-tab-${nextTab.id}`)?.focus();
  }

  if (!activeTab) return <p className="access-empty">No settings sections are available for your account.</p>;
  return <div className="settings-workspace">
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {tabs.map((tab, index) => <button key={tab.id} id={`settings-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="settings-tab-panel" tabIndex={activeTab === tab.id ? 0 : -1} className="settings-tab" onClick={() => setSelectedTab(tab.id)} onKeyDown={(event) => handleTabKeyDown(event, index)}>{tab.label}</button>)}
    </div>
    <div id="settings-tab-panel" className="settings-tab-panel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`} tabIndex={0}>
      {activeTab === "sources" && <>{isSuperAdmin && <GoogleConnectionSettings />}<FilterBar mode="settings" onSelectionChange={onSelectionChange} allowedSources={allowedSources} /></>}
      {activeTab === "roles" && <AccessControlSettings key="roles" permissions={permissions} isSuperAdmin={isSuperAdmin} view="roles" />}
      {activeTab === "users" && <AccessControlSettings key="users" permissions={permissions} isSuperAdmin={isSuperAdmin} view="users" />}
    </div>
  </div>;
}

const compactAxisFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });

function ReportTrend({ title, description, rows, formatValue, formatHoverValue = formatValue }: { title: string; description: string; rows: Array<{ date: string; value: number }>; formatValue: (value: number) => string; formatHoverValue?: (value: number) => string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = niceAxisMaximum(Math.max(1, ...rows.map(({ value }) => value)));
  const points = rows.map(({ value }, index) => `${rows.length > 1 ? index / (rows.length - 1) * 696 : 348},${160 - value / max * 152}`).join(" ");
  const peak = rows.reduce((largest, row) => row.value > largest.value ? row : largest, { date: "", value: 0 });
  const label = (date: string) => date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const fullDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const first = label(rows[0]?.date ?? "");
  const middle = label(rows[Math.floor((rows.length - 1) / 2)]?.date ?? "");
  const last = label(rows[rows.length - 1]?.date ?? "");
  const selectedIndex = activeIndex === null || !rows.length ? null : Math.min(activeIndex, rows.length - 1);
  const selected = selectedIndex === null ? null : rows[selectedIndex];
  const selectedX = selectedIndex === null ? 0 : rows.length > 1 ? selectedIndex / (rows.length - 1) * 100 : 50;
  const selectedY = selected ? (1 - selected.value / max * 0.95) * 100 : 0;
  const moveToPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.round(progress * (rows.length - 1)));
  };
  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const current = selectedIndex ?? 0;
    const next = event.key === "ArrowRight" ? Math.min(rows.length - 1, current + 1) : event.key === "ArrowLeft" ? Math.max(0, current - 1) : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : null;
    if (next !== null) { event.preventDefault(); setActiveIndex(next); }
  };
  return <section className="panel trend-panel report-trend"><div className="panel-header"><div><h2>{title}</h2><p>{description}</p></div><span className="panel-meta">{rows.length} days</span></div><div className="chart-wrap"><div className="chart-y-labels">{[1, 0.75, 0.5, 0.25, 0].map((ratio) => <span key={ratio}><span className="sr-only">{formatValue(max * ratio)}</span><span className="chart-axis-full" aria-hidden="true">{formatValue(max * ratio)}</span><span className="chart-axis-compact" aria-hidden="true">{compactAxisFormatter.format(max * ratio)}</span></span>)}</div><div className="chart-main" role="group" tabIndex={rows.length ? 0 : undefined} aria-label={`${title}. ${rows.length} daily values. Hover, or use left and right arrow keys to inspect dates.`} onPointerMove={moveToPointer} onPointerLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex((index) => index ?? 0)} onBlur={() => setActiveIndex(null)} onKeyDown={moveWithKeyboard}><div className="chart-grid"><i /><i /><i /><i /><i /></div><svg viewBox="0 0 696 160" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="var(--brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg>{selected && <><span className="chart-cursor" style={{ left: `${selectedX}%` }} aria-hidden="true" /><span className="chart-selected-point" style={{ left: `${selectedX}%`, top: `${selectedY}%` }} aria-hidden="true" /><span className="chart-tooltip" style={{ left: `clamp(90px, ${selectedX}%, calc(100% - 90px))` }} role="status"><span>{fullDate(selected.date)}</span><strong>{formatHoverValue(selected.value)}</strong></span></>}<div className="chart-x-labels">{rows.length === 1 ? <span className="chart-label-single">{first}</span> : <><span>{first}</span>{rows.length > 2 && <span className="chart-label-middle">{middle}</span>}<span className="chart-label-last">{last}</span></>}</div></div></div><p className="chart-note">{peak.date ? `Peak day: ${label(peak.date)} · ${formatValue(peak.value)}` : "No daily values for this period."}</p></section>;
}

function niceAxisMaximum(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value / 4));
  const roughStep = value / 4 / magnitude;
  const step = (roughStep <= 1 ? 1 : roughStep <= 2 ? 2 : roughStep <= 2.5 ? 2.5 : roughStep <= 5 ? 5 : 10) * magnitude;
  return Math.ceil(value / step) * step;
}

function formatPeriod(period: { startDate: string; endDate: string }) {
  const format = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${format(period.startDate)} – ${format(period.endDate)}`;
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

const currencyNumberFormatters = new Map<string, Intl.NumberFormat>();
function formatCurrencyNumber(value: number, currency: string) {
  let formatter = currencyNumberFormatters.get(currency);
  if (!formatter) {
    const { minimumFractionDigits, maximumFractionDigits } = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).resolvedOptions();
    formatter = new Intl.NumberFormat("en-US", { minimumFractionDigits, maximumFractionDigits });
    currencyNumberFormatters.set(currency, formatter);
  }
  return formatter.format(value);
}

function ReportState({ state, message }: { state: "loading" | "error" | "empty"; message: string }) {
  return <section className="panel" role={state === "error" ? "alert" : "status"} style={{ padding: 24, marginTop: 20 }}><strong>{state === "loading" ? "Loading report…" : state === "empty" ? "Choose a reporting source" : "Report unavailable"}</strong><p style={{ marginBottom: 0, color: "var(--muted)" }}>{message}</p></section>;
}

function OverviewSourceSection({ title, state, mode, period, error, emptyMessage, action, children }: { title: string; state: SourceLoadState; mode?: "live" | "mock"; period?: { startDate: string; endDate: string }; error: string; emptyMessage: string; action?: ReactNode; children: ReactNode }) {
  const status = state === "ready" ? mode === "mock" ? "Sample data" : "Live data" : state === "loading" ? "Loading" : state === "error" ? "Unavailable" : "Not selected";
  return <section className="overview-source-section" aria-label={title}>
    <header className="overview-source-header"><div><h2>{title}</h2><p>{period ? formatPeriod(period) : "Selected report filters"}</p></div><span className={`overview-source-status ${state === "error" ? "is-error" : state === "ready" && mode === "live" ? "is-live" : ""}`}>{status}</span></header>
    {action}
    {state === "ready" ? children : state === "loading" ? <ReportState state="loading" message={`Fetching ${title} for the selected date range.`} /> : state === "error" ? <ReportState state="error" message={error || `${title} data could not be loaded.`} /> : <ReportState state="empty" message={emptyMessage} />}
  </section>;
}

async function requestReport<T>(url: string, filters: DashboardFilters, signal: AbortSignal): Promise<T> {
  const response = await apiFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(filters), signal });
  const result = await response.json();
  if (!response.ok) {
    const message = Array.isArray(result.message) ? result.message.join(" ") : typeof result.message === "string" ? result.message : "The report request failed.";
    throw new Error(message);
  }
  return result as T;
}

function Breakdown({ title, rows, valueLabel = "Sessions", formatValue = count }: { title: string; rows: Array<{ name: string; sessions: number; detail?: string }>; valueLabel?: string; formatValue?: (value: number) => string }) {
  return <section className="panel source-panel report-breakdown"><div className="panel-header"><div><h2>{title}</h2><p>{valueLabel}</p></div></div><div className="traffic-list">{rows.slice(0, 8).map((row) => <div className="traffic-row" key={row.name}><span className="channel-name">{row.name}{row.detail && <span className="report-detail">{row.detail}</span>}<span className="channel-track"><span style={{ width: `${Math.max(2, row.sessions / Math.max(1, rows[0]?.sessions ?? 1) * 100)}%` }} /></span></span><strong>{formatValue(row.sessions)}</strong></div>)}</div></section>;
}

function ChannelDonut({ rows }: { rows: Array<{ name: string; sessions: number }> }) {
  const colors = ["#cf1734", "#3c6478", "#b28a38", "#6f7d56", "#85658c", "#cf7650", "#687c9c", "#849196"];
  const total = rows.reduce((sum, row) => sum + row.sessions, 0);
  let accumulated = 0;
  const segments = rows.map((row, index) => {
    const start = accumulated;
    accumulated += total ? row.sessions / total * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${accumulated}%`;
  });
  /* taste-skill-ignore gradient: the conic gradient encodes real GA4 channel segments in this existing donut chart. */
  return <section className="panel ga4-channel-panel"><div className="panel-header"><div><h2>Channels</h2><p>Sessions by default channel group</p></div></div>
    {total ? <div className="channel-donut-layout"><div className="channel-donut" role="img" aria-label={`Channel share of ${count(total)} sessions: ${rows.map((row) => `${row.name} ${((row.sessions / total) * 100).toFixed(1)} percent`).join(", ")}.`} style={{ background: `conic-gradient(${segments.join(", ")})` /* taste-skill-ignore gradient: data-coded segments for the existing GA4 channel donut */ }}><span><strong>{count(total)}</strong><small>sessions</small></span></div>
      <ul className="channel-donut-legend">{rows.map((row, index) => <li key={row.name}><span className="channel-donut-label"><i style={{ background: colors[index % colors.length] }} />{row.name}</span><strong>{(row.sessions / total * 100).toFixed(1)}%</strong><small>{count(row.sessions)}</small></li>)}</ul></div> : <p className="bar-chart-empty" role="status">No channel data for this date range.</p>}
  </section>;
}

function LandingPagesTable({ rows }: { rows: Array<{ name: string; sessions: number }> }) {
  const ranked = [...rows].sort((left, right) => right.sessions - left.sessions);
  const total = rows.reduce((sum, row) => sum + row.sessions, 0);
  return <section className="panel landing-pages-panel"><div className="panel-header"><div><h2>Landing pages</h2><p>Top pages by sessions · {rows.length} pages</p></div></div>
    {rows.length ? <div className="landing-pages-scroll"><table><thead><tr><th scope="col">Page</th><th scope="col" className="numeric">Sessions</th><th scope="col" className="numeric">Share</th></tr></thead><tbody>{ranked.slice(0, 10).map((row, index) => <tr key={row.name}><td><span className="landing-page-rank">{index + 1}</span><span className="landing-page-path" title={row.name}>{row.name || "(not set)"}</span></td><td className="numeric">{count(row.sessions)}</td><td className="numeric">{total ? `${(row.sessions / total * 100).toFixed(1)}%` : "—"}</td></tr>)}</tbody></table></div> : <p className="bar-chart-empty" role="status">No landing-page data for this date range.</p>}
  </section>;
}

function DeviceColumns({ rows }: { rows: Array<{ name: string; sessions: number }> }) {
  const ranked = [...rows].sort((left, right) => right.sessions - left.sessions);
  const max = Math.max(1, ...ranked.map((row) => row.sessions));
  const total = ranked.reduce((sum, row) => sum + row.sessions, 0);
  return <section className="panel device-columns-panel"><div className="panel-header"><div><h2>Devices</h2><p>Sessions by device category</p></div></div>
    {ranked.length ? <div className="device-columns" role="img" aria-label={`Sessions by device: ${ranked.map((row) => `${row.name} ${count(row.sessions)} sessions, ${total ? (row.sessions / total * 100).toFixed(1) : 0} percent`).join("; ")}`}><div className="device-columns-guides"><i /><i /><i /></div>{ranked.map((row) => <div className="device-column" key={row.name}><strong>{count(row.sessions)}</strong><div className="device-column-track"><span style={{ height: `${row.sessions / max * 100}%` }} /></div><b>{row.name}</b><small>{total ? `${(row.sessions / total * 100).toFixed(1)}%` : "0%"}</small></div>)}</div> : <p className="bar-chart-empty" role="status">No device data for this date range.</p>}
  </section>;
}

function BarChart({ title, valueLabel, categoryLabel, rows, formatValue = count }: { title: string; valueLabel: string; categoryLabel: string; rows: Array<{ name: string; value: number; detail?: string }>; formatValue?: (value: number) => string }) {
  const rankedRows = [...rows].sort((left, right) => right.value - left.value);
  const maximum = Math.max(0, ...rankedRows.map((row) => row.value));
  const description = `${title}. ${valueLabel} by ${categoryLabel}: ${rankedRows.map((row) => `${row.name}: ${formatValue(row.value)}${row.detail ? `, ${row.detail}` : ""}`).join("; ") || `No ${categoryLabel} for this date range`}. Scale from zero to ${formatValue(maximum)}.`;

  return <section className="panel bar-chart-panel">
    <div className="panel-header"><div><h2>{title}</h2><p>{valueLabel}</p></div></div>
    {rankedRows.length ? <>
      <div className="bar-chart" role="img" aria-label={description}>
        {rankedRows.map((row) => <div className="bar-chart-row" key={row.name}>
          <span className="bar-chart-label">{row.name}</span>
          <div className="bar-chart-track"><span className="bar-chart-fill" style={{ width: `${maximum > 0 ? row.value / maximum * 100 : 0}%` }} /></div>
          <strong className="bar-chart-value">{formatValue(row.value)}</strong>
          {row.detail && <span className="bar-chart-detail">{row.detail}</span>}
        </div>)}
      </div>
      <div className="bar-chart-scale" aria-hidden="true"><span /><div><span>0</span><span>{formatValue(maximum / 2)}</span><span>{formatValue(maximum)}</span></div><span /></div>
    </> : <p className="bar-chart-empty" role="status">No {categoryLabel} for this date range.</p>}
  </section>;
}

function chartLabel(value: string) {
  return value.toLowerCase().split("_").map((word) => word ? word[0].toUpperCase() + word.slice(1) : word).join(" ");
}

const metricIcons = {
  "Ad spend": CreditCard,
  Clicks: MousePointer2,
  Conversions: ShoppingBag,
  "Cost per conversion": Calculator,
  Sessions: BarChart3,
  Users,
  "Engaged sessions": UserRoundCheck,
  "Key events": Zap,
} as const;

function MetricCards({ items }: { items: Array<{ title: string; value: string; note: string; lead?: boolean }> }) {
  return <section className="metrics-grid" aria-label="Report performance totals">{items.map((metric) => {
    const Icon = metricIcons[metric.title as keyof typeof metricIcons] ?? Target;
    return <article className={`metric-card ${metric.lead ? "metric-lead" : ""}`} key={metric.title}>
      <div className="metric-card-heading"><h2 className="metric-title">{metric.title}</h2><span className="metric-icon"><Icon size={17} strokeWidth={1.8} aria-hidden="true" /></span></div>
      <div className="metric-value">{metric.value}</div><p className="metric-note">{metric.note}</p>
    </article>;
  })}</section>;
}

export function DashboardPage({ section }: { section: Section }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [logoutError, setLogoutError] = useState("");
  const [selectedSources, setSelectedSources] = useState<SelectedSources>({ account: "Not selected", property: "Not selected" });
  const [adsReport, setAdsReport] = useState<AdsReport | null>(null);
  const [ga4Report, setGa4Report] = useState<Ga4Report | null>(null);
  const [reportState, setReportState] = useState<"idle" | "loading" | "error">("idle");
  const [reportError, setReportError] = useState("");
  const [overviewAdsState, setOverviewAdsState] = useState<SourceLoadState>("idle");
  const [overviewAdsError, setOverviewAdsError] = useState("");
  const [overviewGa4State, setOverviewGa4State] = useState<SourceLoadState>("idle");
  const [overviewGa4Error, setOverviewGa4Error] = useState("");
  const allowedSources = { googleAds: Boolean(sessionUser?.isSuperAdmin || sessionUser?.permissions.includes("google_ads.view")), ga4: Boolean(sessionUser?.isSuperAdmin || sessionUser?.permissions.includes("ga4.view")) };
  useEffect(() => {
    let active = true;
    apiFetch("/auth/me").then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getApiError(result));
      if (!active) return;
      const user = result as SessionUser;
      if (user.mustResetPassword) { window.location.replace("/reset-password"); return; }
      setSessionUser(user); setAuthLoading(false);
    }).catch(() => {
      if (!active) return;
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const sync = () => setQuery(window.location.search);
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("adpulse:filters-changed", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("adpulse:filters-changed", sync); };
  }, []);
  useEffect(() => {
    if (section === "overview" || section === "settings") return;
    const parsed = parseDashboardFiltersFromSearch(query);
    if (!parsed.success) { setReportState("error"); setReportError("The report filters in the URL are invalid."); return; }
    const isAds = section === "google-ads";
    if (isAds ? !allowedSources.googleAds : !allowedSources.ga4) { setAdsReport(null); setGa4Report(null); setReportState("idle"); setReportError(""); return; }
    const resourceId = isAds ? parsed.data.googleAdsAccountId : parsed.data.ga4PropertyId;
    if (!resourceId) { setAdsReport(null); setGa4Report(null); setReportState("idle"); setReportError(""); return; }
    const controller = new AbortController();
    setReportState("loading"); setReportError("");
    requestReport<AdsReport | Ga4Report>(apiUrl(`/reports/${isAds ? "google-ads/campaign-performance" : "ga4/acquisition"}`), parsed.data, controller.signal).then((result) => {
      if (isAds) { setAdsReport(result as AdsReport); setGa4Report(null); }
      else { setGa4Report(result as Ga4Report); setAdsReport(null); }
      setReportState("idle");
    }).catch((error: Error) => {
      if (error.name !== "AbortError") { setReportState("error"); setReportError(error.message || "The report could not be loaded."); }
    });
    return () => controller.abort();
  }, [section, query, allowedSources.googleAds, allowedSources.ga4]);
  useEffect(() => {
    if (section !== "overview") return;
    const parsed = parseDashboardFiltersFromSearch(query);
    if (!parsed.success) {
      setOverviewAdsState("error"); setOverviewAdsError("The report filters in the URL are invalid.");
      setOverviewGa4State("error"); setOverviewGa4Error("The report filters in the URL are invalid.");
      return;
    }
    const { data: filters } = parsed;
    const adsController = new AbortController();
    const ga4Controller = new AbortController();
    setAdsReport(null); setGa4Report(null);
    setOverviewAdsError(""); setOverviewGa4Error("");
    setOverviewAdsState(allowedSources.googleAds && filters.googleAdsAccountId ? "loading" : "idle");
    setOverviewGa4State(allowedSources.ga4 && filters.ga4PropertyId ? "loading" : "idle");
    if (allowedSources.googleAds && filters.googleAdsAccountId) {
      requestReport<AdsReport>(apiUrl("/reports/google-ads/campaign-performance"), filters, adsController.signal).then((result) => {
        setAdsReport(result); setOverviewAdsState("ready");
      }).catch((error: Error) => {
        if (error.name !== "AbortError") { setOverviewAdsError(error.message || "Google Ads data could not be loaded."); setOverviewAdsState("error"); }
      });
    }
    if (allowedSources.ga4 && filters.ga4PropertyId) {
      requestReport<Ga4Report>(apiUrl("/reports/ga4/acquisition"), filters, ga4Controller.signal).then((result) => {
        setGa4Report(result); setOverviewGa4State("ready");
      }).catch((error: Error) => {
        if (error.name !== "AbortError") { setOverviewGa4Error(error.message || "GA4 data could not be loaded."); setOverviewGa4State("error"); }
      });
    }
    return () => { adsController.abort(); ga4Controller.abort(); };
  }, [section, query, allowedSources.googleAds, allowedSources.ga4]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); document.querySelector<HTMLButtonElement>(".mobile-bar button")?.focus(); } };
    const media = window.matchMedia("(min-width: 1101px)");
    const closeOnDesktop = () => { if (media.matches) setMenuOpen(false); };
    window.addEventListener("keydown", close);
    media.addEventListener("change", closeOnDesktop);
    return () => { window.removeEventListener("keydown", close); media.removeEventListener("change", closeOnDesktop); };
  }, []);
  const pageTitle = section === "google-ads" ? "Google Ads" : section === "ga4" ? "GA4 Analytics" : section === "settings" ? "Settings" : "Performance overview";
  const handleLogout = async () => {
    setLogoutError("");
    try {
      const response = await apiFetch("/auth/logout", { method: "POST" });
      if (!response.ok) { const result = await response.json().catch(() => ({})); setLogoutError(getApiError(result, "Sign out failed. Please try again.")); return; }
      window.location.assign("/login");
    } catch { setLogoutError("Could not reach the server. Check your connection and try signing out again."); }
  };
  const selectedFilters = parseDashboardFiltersFromSearch(query);
  const adsAccountSelected = allowedSources.googleAds && selectedFilters.success && Boolean(selectedFilters.data.googleAdsAccountId);
  const ga4AdsScope = selectedFilters.success && selectedFilters.data.ga4AdsScope;
  const toggleGa4AdsScope = () => {
    const current = parseDashboardFiltersFromSearch(window.location.search);
    if (!current.success || !current.data.googleAdsAccountId) return;
    const next = { ...current.data, ga4AdsScope: !current.data.ga4AdsScope };
    window.history.replaceState(null, "", serializeDashboardFilters(window.location.pathname, next));
    window.dispatchEvent(new Event("adpulse:filters-changed"));
  };
  const adsScopeControl = <div className="ga4-ads-scope"><div><strong>Google Ads traffic only</strong><span>{adsAccountSelected ? ga4AdsScope ? "Selected filters plus sessions attributed to the Ads account" : "Selected filters across the GA4 property" : "Choose a Google Ads account in Settings to enable this filter"}</span></div><button type="button" role="switch" aria-label="Google Ads traffic only" aria-checked={ga4AdsScope} disabled={!adsAccountSelected} onClick={toggleGa4AdsScope}><span /></button></div>;
  const appliedPeriod = section === "google-ads" && adsReport ? formatPeriod(adsReport.period) : section === "ga4" && ga4Report ? formatPeriod(ga4Report.period) : undefined;
  const metricItems = section === "google-ads" && adsReport ? [
    { title: "Ad spend", value: formatCurrency(adsReport.totals.spend, adsReport.currency), note: `${adsReport.campaigns.length} campaigns · ${adsReport.currency}`, lead: true },
    { title: "Clicks", value: count(adsReport.totals.clicks), note: `${count(adsReport.totals.impressions)} impressions` },
    { title: "Conversions", value: count(adsReport.totals.conversions), note: `CTR ${adsReport.totals.ctr.toFixed(2)}%` },
    { title: "Cost per conversion", value: adsReport.totals.costPerConversion === null ? "—" : formatCurrency(adsReport.totals.costPerConversion, adsReport.currency), note: "Ad spend ÷ conversions" },
  ] : section === "ga4" && ga4Report ? [
    { title: "Sessions", value: count(ga4Report.totals.sessions), note: "GA4", lead: true },
    { title: "Users", value: count(ga4Report.totals.users), note: "Total users" },
    { title: "Engaged sessions", value: count(ga4Report.totals.engagedSessions), note: `${(ga4Report.totals.engagementRate * 100).toFixed(1)}% engagement rate` },
    { title: "Key events", value: count(ga4Report.totals.keyEvents), note: "Configured in GA4" },
  ] : [];
  if (authLoading || !sessionUser) return <main className="auth-checking" role="status">Checking your AdPulse session…</main>;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to report</a>
    <header className="mobile-bar"><span className="mobile-wordmark"><Activity size={21} /> adpulse.</span><button className="icon-button" aria-expanded={menuOpen} aria-controls="sidebar" aria-label={menuOpen ? "Close navigation" : "Open navigation"} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button></header>
    {menuOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside id="sidebar" className={`sidebar ${menuOpen ? "is-open" : ""}`}><Sidebar section={section} query={query} user={sessionUser} onLogout={() => void handleLogout()} logoutError={logoutError} onNavigate={() => setMenuOpen(false)} /></aside>
    <main id="main-content" className="main-area" inert={menuOpen || undefined}><div className="page-content">
      <div className={`page-heading ${section === "settings" ? "settings-page-heading" : "report-page-heading"}`}><div><h1>{pageTitle}</h1>{section === "google-ads" ? <p>Campaign spend, clicks and conversions.</p> : section === "overview" ? <p>Your campaign spend and website traffic, together.</p> : section === "settings" ? <p>Choose reporting sources and manage access.</p> : null}</div><div className="page-heading-actions"><div className="reporting-scope" aria-label="Selected reporting sources"><div><span>Google Ads account</span><strong title={selectedSources.account}>{selectedSources.account}</strong></div><div><span>GA4 property</span><strong title={selectedSources.property}>{selectedSources.property}</strong></div></div>{section === "settings" ? null : <FilterBar mode="report" appliedPeriod={appliedPeriod} onSelectionChange={setSelectedSources} allowedSources={allowedSources} />}</div></div>
      {section === "settings" ? <SettingsWorkspace permissions={sessionUser.permissions} isSuperAdmin={sessionUser.isSuperAdmin} allowedSources={allowedSources} onSelectionChange={setSelectedSources} /> : null}
      {section === "ga4" && allowedSources.googleAds && adsScopeControl}
      {section === "ga4" && ga4Report?.truncated && <p className="demo-notice" role="note">Some GA4 breakdowns exceeded 50,000 rows and were capped. Narrow the date range or add a filter to see the full breakdown.</p>}
      {section === "settings" ? null : section === "overview" ? <>
        <div className="overview-source-grid">
          {allowedSources.googleAds && <OverviewSourceSection title="Google Ads" state={overviewAdsState} mode={adsReport?.mode} period={adsReport?.period} error={overviewAdsError} emptyMessage="Open Settings and choose a Google Ads account to load campaign data.">
            {adsReport && <>
              <MetricCards items={[
                { title: "Ad spend", value: formatCurrency(adsReport.totals.spend, adsReport.currency), note: adsReport.currency, lead: true },
                { title: "Clicks", value: count(adsReport.totals.clicks), note: `${count(adsReport.totals.impressions)} impressions` },
                { title: "Conversions", value: count(adsReport.totals.conversions), note: "Google Ads" },
                { title: "Cost per conversion", value: adsReport.totals.costPerConversion === null ? "—" : formatCurrency(adsReport.totals.costPerConversion, adsReport.currency), note: "Google Ads" },
              ]} />
              <div className="content-grid report-content-grid single-column"><ReportTrend title="Spend over time" description={`Daily spend · ${adsReport.currency}`} rows={adsReport.daily.flatMap((row) => row.date ? [{ date: row.date, value: row.spend }] : [])} formatValue={(value) => formatCurrencyNumber(value, adsReport.currency)} formatHoverValue={(value) => formatCurrency(value, adsReport.currency)} /></div>
              <Link href={`/google-ads${query}`} className="source-link">Open Google Ads report <ArrowRight size={14} /></Link>
            </>}
          </OverviewSourceSection>}
          {allowedSources.ga4 && <OverviewSourceSection title="Google Analytics 4" state={overviewGa4State} mode={ga4Report?.mode} period={ga4Report?.period} error={overviewGa4Error} emptyMessage="Open Settings to choose a GA4 account and property." action={allowedSources.googleAds ? adsScopeControl : undefined}>
            {ga4Report && <>
              <MetricCards items={[
                { title: "Sessions", value: count(ga4Report.totals.sessions), note: "Google Analytics 4", lead: true },
                { title: "Users", value: count(ga4Report.totals.users), note: "Total users" },
                { title: "Engaged sessions", value: count(ga4Report.totals.engagedSessions), note: `${(ga4Report.totals.engagementRate * 100).toFixed(1)}% engagement rate` },
                { title: "Key events", value: count(ga4Report.totals.keyEvents), note: "Configured in GA4" },
              ]} />
              {ga4Report.truncated && <p className="demo-notice" role="note">Some GA4 breakdowns exceeded 50,000 rows and were capped.</p>}
              <div className="content-grid report-content-grid"><ReportTrend title="Sessions over time" description="GA4 sessions" rows={ga4Report.daily.map((row) => ({ date: row.date, value: row.sessions }))} formatValue={(value) => count(Math.round(value))} /><Breakdown title="Channels" rows={ga4Report.channels} /></div>
              <Link href={`/ga4${query}`} className="source-link">Open GA4 Analytics report <ArrowRight size={14} /></Link>
            </>}
          </OverviewSourceSection>}
        </div>
      </> : reportState === "idle" && !(adsReport || ga4Report) ? <ReportState state="empty" message={section === "google-ads" ? "Open Settings and choose a Google Ads account to load campaign performance." : "Open Settings to choose a GA4 account and property."} /> : reportState === "loading" ? <ReportState state="loading" message="Fetching the selected account and date range." /> : reportState === "error" ? <ReportState state="error" message={reportError} /> : <>
      <MetricCards items={metricItems} />
      {section === "google-ads" && adsReport ? <>
        <div className="content-grid report-content-grid"><ReportTrend title="Spend over time" description={`Daily spend · ${adsReport.currency}`} rows={adsReport.daily.flatMap((row) => row.date ? [{ date: row.date, value: row.spend }] : [])} formatValue={(value) => formatCurrencyNumber(value, adsReport.currency)} formatHoverValue={(value) => formatCurrency(value, adsReport.currency)} /><BarChart title="Device performance" valueLabel="Clicks" categoryLabel="devices" rows={adsReport.devices.map((row) => ({ name: chartLabel(row.device ?? "Other"), value: row.clicks, detail: `${count(row.conversions)} conversions · ${formatCurrency(row.spend, adsReport.currency)} spend` }))} /></div>
        <section className="panel campaigns-panel"><div className="panel-header"><div><h2>Campaign performance</h2><p>{adsReport.campaigns.length} campaigns · Google Ads</p></div></div><div className="table-scroll" role="region" aria-label="Google Ads campaign report" tabIndex={0}><table><thead><tr>{["Campaign", "Type", "Status", "Spend", "Clicks", "CTR", "Conversions"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{adsReport.campaigns.map((row) => <tr key={row.id}><th scope="row"><span className="campaign-name">{row.name}</span></th><td>{row.campaignType.replaceAll("_", " ")}</td><td><span className={`status ${row.status.toLowerCase()}`}><i />{row.status}</span></td><td className="numeric">{formatCurrency(row.spend, adsReport.currency)}</td><td className="numeric">{count(row.clicks)}</td><td className="numeric">{row.ctr.toFixed(2)}%</td><td className="numeric">{count(row.conversions)}</td></tr>)}</tbody></table></div></section>
      </> : section === "ga4" && ga4Report ? <>
        <div className="content-grid report-content-grid"><ReportTrend title="Sessions over time" description="GA4 sessions" rows={ga4Report.daily.map((row) => ({ date: row.date, value: row.sessions }))} formatValue={(value) => count(Math.round(value))} /><ChannelDonut rows={ga4Report.channels} /></div>
        <div className="content-grid report-content-grid"><BarChart title="Source / medium" valueLabel="Sessions" categoryLabel="source / medium" rows={ga4Report.sourceMediums.map((row) => ({ name: row.name, value: row.sessions }))} /><LandingPagesTable rows={ga4Report.landingPages} /></div><DeviceColumns rows={ga4Report.devices} />
      </> : null}
      <footer className="page-footer"><span>AdPulse Analytics</span><span>{adsReport?.mode === "live" || ga4Report?.mode === "live" ? "Live data · Google APIs" : "Sample data · Mock report"}</span></footer>
      </>}
    </div></main>
  </div>;
}
