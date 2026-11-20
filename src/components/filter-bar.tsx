"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, CircleAlert, SlidersHorizontal, X } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api-client";
import {
  CAMPAIGN_TYPES, DEVICE_CATEGORIES, defaultDashboardFilters, getFilterWarnings,
  parseDashboardFiltersFromSearch, serializeDashboardFilters, validateDashboardFilters,
  type CampaignType, type DashboardFilters, type DeviceCategory, type FilterValidationIssue,
} from "@contracts/dashboard-filters";

interface GoogleAdsAccountOption { id: string; displayName: string; mode: "live" | "mock" }
interface Ga4PropertyOption { id: string; displayName: string; accountName: string; accountId: string; mode: "live" | "mock" }
interface Ga4AccountOption { id: string; displayName: string; properties: Ga4PropertyOption[]; mode: "live" | "mock" }
interface CampaignOption { id: string; name: string; type: string }
interface AdsFilterOptions { campaigns: CampaignOption[]; campaignTypes: string[]; mode: "live" | "mock" }
interface Ga4FilterOptions { channelGroups: string[]; sourceMediums: string[]; landingPages: string[]; truncated: boolean; mode: "live" | "mock" }
interface ValidationResponse { warnings: string[]; previousPeriod: { startDate: string; endDate: string } | null }
export interface SelectedSources { account: string; property: string }

const FILTER_CHANGE_EVENT = "adpulse:filters-changed";
const GA4_ADS_SCOPE_LABEL = "Google Ads traffic only";
const defaultFilters = defaultDashboardFilters();

export function FilterBar({ mode = "report", campaignSource = "google-ads", showGa4AdsScope = false, appliedPeriod, onSelectionChange, allowedSources = { googleAds: true, ga4: true } }: {
  mode?: "report" | "settings";
  campaignSource?: "google-ads" | "ga4";
  showGa4AdsScope?: boolean;
  appliedPeriod?: string;
  onSelectionChange?: (selection: SelectedSources) => void;
  allowedSources?: { googleAds: boolean; ga4: boolean };
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDrawerMounted, setFilterDrawerMounted] = useState(false);
  const drawerCloseTimer = useRef<number | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const [draft, setDraft] = useState<DashboardFilters>(defaultFilters);
  const [issues, setIssues] = useState<FilterValidationIssue[]>([]);
  const [accounts, setAccounts] = useState<GoogleAdsAccountOption[]>([]);
  const [ga4Accounts, setGa4Accounts] = useState<Ga4AccountOption[]>([]);
  const [ga4AccountsLoaded, setGa4AccountsLoaded] = useState(false);
  const [ga4AccountsError, setGa4AccountsError] = useState("");
  const [campaignResponse, setCampaignResponse] = useState<{ url: string; options: AdsFilterOptions | null } | null>(null);
  const [ga4Options, setGa4Options] = useState<Ga4FilterOptions | null>(null);
  const [optionError, setOptionError] = useState("");
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  useEffect(() => {
    const parsed = parseDashboardFiltersFromSearch(window.location.search);
    if (parsed.success) {
      setFilters(parsed.data);
      setDraft(parsed.data);
    } else {
      setIssues(parsed.issues);
    }
    const restoreFromUrl = () => {
      const next = parseDashboardFiltersFromSearch(window.location.search);
      if (next.success) { setFilters(next.data); setDraft(next.data); setIssues([]); }
      else setIssues(next.issues);
    };
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, []);

  const openFilterDrawer = () => {
    if (drawerCloseTimer.current !== null) window.clearTimeout(drawerCloseTimer.current);
    setFilterDrawerMounted(true);
    window.requestAnimationFrame(() => setFiltersOpen(true));
  };
  const closeFilterDrawer = useCallback(() => {
    setFiltersOpen(false);
    if (drawerCloseTimer.current !== null) window.clearTimeout(drawerCloseTimer.current);
    drawerCloseTimer.current = window.setTimeout(() => {
      setFilterDrawerMounted(false);
      drawerCloseTimer.current = null;
    }, 240);
  }, []);

  useEffect(() => {
    if (!filtersOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFilterDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(".filter-drawer-close")?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen, closeFilterDrawer]);

  useEffect(() => () => {
    if (drawerCloseTimer.current !== null) window.clearTimeout(drawerCloseTimer.current);
  }, []);

  useEffect(() => {
    if (!allowedSources.googleAds) { setAccounts([]); return; }
    const controller = new AbortController();
    fetchJson<GoogleAdsAccountOption[]>(apiUrl("/connections/google-ads"), controller.signal)
      .then((ads) => { setAccounts(ads); setOptionError(""); })
      .catch((error: Error) => { if (error.name !== "AbortError") setOptionError("Account options are unavailable. Try reloading when your connection is restored."); });
    return () => controller.abort();
  }, [allowedSources.googleAds]);

  useEffect(() => {
    if (!allowedSources.ga4) { setGa4Accounts([]); setGa4AccountsLoaded(true); return; }
    const controller = new AbortController();
    fetchJson<Ga4AccountOption[]>(apiUrl("/connections/ga4/accounts"), controller.signal)
      .then((availableAccounts) => {
        setGa4Accounts(availableAccounts);
        setGa4AccountsLoaded(true);
        setGa4AccountsError("");
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setGa4AccountsError("GA4 accounts and properties could not be loaded.");
      });
    return () => controller.abort();
  }, [allowedSources.ga4]);

  const campaignPropertyId = campaignSource === "ga4" ? filters.ga4PropertyId : "";
  const campaignQuery = new URLSearchParams({
    accountId: filters.googleAdsAccountId,
    startDate: filters.dateRange.startDate,
    endDate: filters.dateRange.endDate,
  });
  if (campaignPropertyId) campaignQuery.set("propertyId", campaignPropertyId);
  const canLoadCampaigns = mode === "report" && allowedSources.googleAds && filters.googleAdsAccountId
    && (campaignSource === "google-ads" || (allowedSources.ga4 && campaignPropertyId));
  const campaignOptionsUrl = canLoadCampaigns
    ? apiUrl(`/connections/${campaignSource === "ga4" ? "ga4/campaign-options" : "google-ads/filter-options"}?${campaignQuery}`)
    : "";
  const currentCampaignResponse = campaignResponse?.url === campaignOptionsUrl ? campaignResponse : null;
  const adsOptions = currentCampaignResponse?.options;
  const campaignEmptyLabel = !filters.googleAdsAccountId ? "Choose an Ads account first"
    : !canLoadCampaigns ? "Choose a GA4 property first"
    : !currentCampaignResponse ? "Loading campaigns…"
    : !adsOptions ? "Could not load campaigns"
    : campaignSource === "ga4" ? "No campaigns with GA4 sessions"
    : "No campaigns found";

  useEffect(() => {
    if (!campaignOptionsUrl) return;
    const controller = new AbortController();
    fetchJson<AdsFilterOptions>(campaignOptionsUrl, controller.signal)
      .then((options) => {
        if (!controller.signal.aborted) setCampaignResponse({ url: campaignOptionsUrl, options });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCampaignResponse({ url: campaignOptionsUrl, options: null });
      });
    return () => controller.abort();
  }, [campaignOptionsUrl]);

  useEffect(() => {
    if (mode !== "report" || !allowedSources.ga4) { setGa4Options(null); return; }
    if (!filters.ga4PropertyId) { setGa4Options(null); setOptionError(""); return; }
    const controller = new AbortController();
    fetchJson<Ga4FilterOptions>(apiUrl(`/connections/ga4/filter-options?propertyId=${encodeURIComponent(filters.ga4PropertyId)}`), controller.signal)
      .then((options) => { setGa4Options(options); setOptionError(""); }).catch((error: Error) => { if (error.name !== "AbortError") setOptionError("GA4 filter options could not be loaded."); });
    return () => controller.abort();
  }, [filters.ga4PropertyId, mode, allowedSources.ga4]);

  useEffect(() => {
    if (mode !== "report") { setValidationWarnings([]); return; }
    if (!isMeaningfulFilterChange(filters)) { setValidationWarnings([]); setIssues([]); return; }
    const validationKey = JSON.stringify(filters);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      apiFetch(apiUrl("/filters/validate"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(filters), signal: controller.signal })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(getApiError(result));
          return result as ValidationResponse;
        })
        .then((result) => {
          if (JSON.stringify(filters) !== validationKey) return;
          setValidationWarnings(result.warnings); setIssues([]);
        })
        .catch((error: Error) => { if (error.name !== "AbortError" && JSON.stringify(filters) === validationKey) setIssues([{ field: "filters", message: error.message }]); });
    }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [filters, mode]);

  const warnings = useMemo(() => [...new Set([...getFilterWarnings(filters), ...validationWarnings])], [filters, validationWarnings]);
  const commit = useCallback((candidate: DashboardFilters) => {
    setDraft(candidate);
    const result = validateDashboardFilters(candidate);
    if (!result.success) { setIssues(result.issues); return; }
    setIssues([]);
    setFilters(result.data);
    const url = serializeDashboardFilters(window.location.pathname, result.data);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(FILTER_CHANGE_EVENT));
  }, []);

  useEffect(() => {
    if (!ga4AccountsLoaded || ga4AccountsError) return;
    const account = ga4Accounts.find((item) => item.id === filters.ga4AccountId);
    if (!account && filters.ga4PropertyId && !filters.ga4AccountId) {
      const owner = ga4Accounts.find((item) => item.properties.some((property) => property.id === filters.ga4PropertyId));
      if (owner) { commit({ ...filters, ga4AccountId: owner.id }); return; }
    }
    if (filters.ga4AccountId && !account) {
      commit({ ...filters, ga4AccountId: "", ga4PropertyId: "", channelGroups: [], sourceMediums: [], landingPages: [] });
      return;
    }
    if (filters.ga4PropertyId && !account?.properties.some((property) => property.id === filters.ga4PropertyId)) {
      commit({ ...filters, ga4PropertyId: "", channelGroups: [], sourceMediums: [], landingPages: [] });
    }
  }, [filters, ga4Accounts, ga4AccountsLoaded, ga4AccountsError, commit]);

  const updateList = <T extends string>(field: "campaignIds" | "campaignTypes" | "devices" | "channelGroups" | "sourceMediums" | "landingPages", value: T, checked: boolean) => {
    const current = filters[field] as T[];
    const next = checked ? [...current, value] : current.filter((item) => item !== value);
    commit({ ...filters, [field]: next });
  };

  const campaignTypeOptions = adsOptions?.campaignTypes ?? [...CAMPAIGN_TYPES];
  const channelOptions = ga4Options?.channelGroups ?? [];
  const sourceMediumOptions = ga4Options?.sourceMediums ?? [];
  const landingPageOptions = ga4Options?.landingPages ?? [];
  const selectedGa4Account = ga4Accounts.find((item) => item.id === draft.ga4AccountId);
  const properties = selectedGa4Account?.properties ?? [];

  useEffect(() => {
    const account = accounts.find((item) => item.id === filters.googleAdsAccountId);
    const property = ga4Accounts.flatMap((item) => item.properties).find((item) => item.id === filters.ga4PropertyId);
    onSelectionChange?.({
      account: account?.displayName ?? (filters.googleAdsAccountId ? `Account ${filters.googleAdsAccountId}` : "Not selected"),
      property: property?.displayName ?? (filters.ga4PropertyId ? `Property ${filters.ga4PropertyId}` : "Not selected"),
    });
  }, [accounts, filters.googleAdsAccountId, filters.ga4PropertyId, ga4Accounts, onSelectionChange]);

  const sourceSelectionFields = <div className="filter-primary-row settings-source-fields">
    {allowedSources.googleAds && <label className="filter-field"><span>Google Ads account</span><select value={draft.googleAdsAccountId} onChange={(event) => { const googleAdsAccountId = event.target.value; commit({ ...filters, googleAdsAccountId, ga4AdsScope: googleAdsAccountId ? filters.ga4AdsScope : false, campaignIds: [], campaignTypes: [] }); }}><option value="">Choose an Ads account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.id}</option>)}</select></label>}
    {allowedSources.ga4 && <label className="filter-field"><span>GA4 account</span><select value={draft.ga4AccountId} disabled={!ga4AccountsLoaded || Boolean(ga4AccountsError)} onChange={(event) => commit({ ...draft, ga4AccountId: event.target.value, ga4PropertyId: "", channelGroups: [], sourceMediums: [], landingPages: [] })}><option value="">{ga4AccountsError ? "Could not load GA4 accounts" : !ga4AccountsLoaded ? "Loading GA4 accounts…" : "Choose a GA4 account"}</option>{ga4Accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.id}</option>)}</select></label>}
    {allowedSources.ga4 && <label className="filter-field"><span>GA4 property</span><select value={draft.ga4PropertyId} disabled={!draft.ga4AccountId || !ga4AccountsLoaded || Boolean(ga4AccountsError) || properties.length === 0} onChange={(event) => commit({ ...draft, ga4PropertyId: event.target.value, channelGroups: [], sourceMediums: [], landingPages: [] })}><option value="">{!draft.ga4AccountId ? "Choose a GA4 account first" : properties.length ? "Choose a GA4 property" : "No properties in this account"}</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.displayName} · {property.id}</option>)}</select></label>}
  </div>;

  if (mode === "settings") return <section className="settings-source-panel" aria-labelledby="settings-source-title">
    <header className="settings-source-header"><div><h2 id="settings-source-title">Reporting sources</h2><p>Choose a Google Ads account and a GA4 account and property independently.</p></div></header>
    {sourceSelectionFields}
    {optionError && <InlineError>{optionError}</InlineError>}
    {ga4AccountsError && <InlineError>{ga4AccountsError}</InlineError>}
    {issues.length > 0 && <div className="filter-message error" role="alert">{issues.map((issue) => issue.message).join(" ")}</div>}
  </section>;

  const campaignNames = new Map((adsOptions?.campaigns ?? []).map(({ id, name }) => [id, name]));
  const showAdsScope = showGa4AdsScope && allowedSources.googleAds && allowedSources.ga4;
  const setAdsScope = (enabled: boolean) => commit({ ...filters, ga4AdsScope: enabled });
  const chips: Array<{ key: string; label: string; remove: () => void }> = [
    { key: "date-range", label: `Date: ${filters.dateRange.startDate} – ${filters.dateRange.endDate}`, remove: () => commit({ ...filters, dateRange: defaultFilters.dateRange }) },
    ...filters.campaignIds.map((id) => ({ key: `campaign:${id}`, label: `Campaign: ${campaignNames.get(id) ?? id}`, remove: () => updateList("campaignIds", id, false) })),
    ...filters.campaignTypes.map((type) => ({ key: `type:${type}`, label: `Type: ${formatEnum(type)}`, remove: () => updateList("campaignTypes", type as CampaignType, false) })),
    ...filters.devices.map((device) => ({ key: `device:${device}`, label: `Device: ${titleCase(device)}`, remove: () => updateList("devices", device as DeviceCategory, false) })),
    ...filters.channelGroups.map((value) => ({ key: `channel:${value}`, label: `Channel: ${value}`, remove: () => updateList("channelGroups", value, false) })),
    ...filters.sourceMediums.map((value) => ({ key: `source:${value}`, label: `Source: ${value}`, remove: () => updateList("sourceMediums", value, false) })),
    ...filters.landingPages.map((value) => ({ key: `landing:${value}`, label: `Landing: ${value}`, remove: () => updateList("landingPages", value, false) })),
  ];
  if (showAdsScope && filters.ga4AdsScope) {
    chips.push({ key: "ga4-ads-scope", label: GA4_ADS_SCOPE_LABEL, remove: () => setAdsScope(false) });
  }
  const selectedCount = chips.length - 1;
  const clearAll = () => commit({ ...filters, dateRange: defaultFilters.dateRange, ga4AdsScope: false, campaignIds: [], campaignTypes: [], devices: [], channelGroups: [], sourceMediums: [], landingPages: [] });
  const dateFields = <div className="filter-date-range">
    <label className="filter-field"><span>From</span><input type="date" max={new Date().toISOString().slice(0, 10)} value={filters.dateRange.startDate} onChange={(event) => commit({ ...filters, dateRange: { ...filters.dateRange, startDate: event.target.value } })} /></label>
    <span className="filter-date-separator" aria-hidden="true">to</span>
    <label className="filter-field"><span>To</span><input type="date" max={new Date().toISOString().slice(0, 10)} value={filters.dateRange.endDate} onChange={(event) => commit({ ...filters, dateRange: { ...filters.dateRange, endDate: event.target.value } })} /></label>
  </div>;
  const campaignAndDimensionFilters = <div className="advanced-filter-grid">
    {allowedSources.googleAds && <><MultiSelect title="Campaigns" values={filters.campaignIds} options={(adsOptions?.campaigns ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))} disabled={!adsOptions} emptyLabel={campaignEmptyLabel} onChange={(id, selected) => updateList("campaignIds", id, selected)} />
    <MultiSelect title="Campaign types" values={filters.campaignTypes} options={campaignTypeOptions.map((item) => ({ value: item, label: formatEnum(item) }))} disabled={!filters.googleAdsAccountId} emptyLabel={filters.googleAdsAccountId ? "No campaign types found" : "Choose an Ads account first"} onChange={(type, selected) => updateList("campaignTypes", type as CampaignType, selected)} /></>}
    <MultiSelect title="Devices" values={filters.devices} options={DEVICE_CATEGORIES.map((item) => ({ value: item, label: titleCase(item) }))} onChange={(device, selected) => updateList("devices", device as DeviceCategory, selected)} />
    {allowedSources.ga4 && <><MultiSelect title="GA4 channel group" values={filters.channelGroups} options={channelOptions.map((item) => ({ value: item, label: item }))} disabled={!filters.ga4PropertyId} emptyLabel={filters.ga4PropertyId ? "No channel groups found" : "Choose a GA4 property first"} onChange={(value, selected) => updateList("channelGroups", value, selected)} />
    <MultiSelect title="GA4 source / medium" values={filters.sourceMediums} options={sourceMediumOptions.map((item) => ({ value: item, label: item }))} disabled={!filters.ga4PropertyId} emptyLabel={filters.ga4PropertyId ? "No source / medium values found" : "Choose a GA4 property first"} onChange={(value, selected) => updateList("sourceMediums", value, selected)} />
    <MultiSelect title="GA4 landing page" values={filters.landingPages} options={landingPageOptions.map((item) => ({ value: item, label: item }))} disabled={!filters.ga4PropertyId} emptyLabel={filters.ga4PropertyId ? "No landing pages found" : "Choose a GA4 property first"} onChange={(value, selected) => updateList("landingPages", value, selected)} /></>}
  </div>;

  return <div className="report-filter-controls">
    <div className="filter-toolbar">
      <div className="selected-filter-chips" aria-label="Selected filters">
        {chips.length === 0 ? <span className="no-selected-filters">No filters selected</span> : chips.map((chip) => <span className="selected-filter-chip" key={chip.key}>{chip.label}<button type="button" aria-label={`Remove ${chip.label}`} onClick={chip.remove}><X size={13} /></button></span>)}
        {chips.length > 0 && <button type="button" className="clear-all-filters" onClick={clearAll}>Clear all</button>}
      </div>
      <button type="button" className="open-filter-drawer" aria-expanded={filtersOpen} aria-controls="report-filter-drawer" onClick={openFilterDrawer}><SlidersHorizontal size={15} />More filters{selectedCount > 0 && <span>{selectedCount}</span>}</button>
    </div>
    {filterDrawerMounted && <div className={`filter-drawer-layer ${filtersOpen ? "is-open" : "is-closing"}`}>
      <button className="filter-drawer-backdrop" aria-label="Close filters" onClick={closeFilterDrawer} />
      <aside id="report-filter-drawer" className="filter-drawer" role="dialog" aria-modal="true" aria-labelledby="filter-drawer-title">
        <header className="filter-drawer-header"><div><h2 id="filter-drawer-title">Filters</h2><p>Changes apply as you make them.</p></div><button type="button" className="filter-drawer-close" aria-label="Close filters" onClick={closeFilterDrawer}><X size={18} /></button></header>
        <div className="filter-drawer-content">
          <section className="filter-drawer-section"><h3>Date range</h3>{dateFields}</section>
          {(allowedSources.googleAds || allowedSources.ga4) && <section className="filter-drawer-section"><h3>Reporting sources</h3>{sourceSelectionFields}</section>}
          <section className="filter-drawer-section"><h3>Campaigns and dimensions</h3>
            {showAdsScope && <div className="ga4-ads-scope">
              <div>
                <strong id="ga4-ads-scope-label">{GA4_ADS_SCOPE_LABEL}</strong>
                <span id="ga4-ads-scope-help">{filters.googleAdsAccountId
                  ? "Limit GA4 to sessions attributed to the selected Google Ads account."
                  : "Choose a Google Ads account above to enable this filter."}</span>
              </div>
              <button type="button" role="switch" aria-labelledby="ga4-ads-scope-label" aria-describedby="ga4-ads-scope-help"
                aria-checked={filters.ga4AdsScope} disabled={!filters.googleAdsAccountId}
                onClick={() => setAdsScope(!filters.ga4AdsScope)}><span /></button>
            </div>}
            {(allowedSources.googleAds && !filters.googleAdsAccountId || allowedSources.ga4 && !filters.ga4PropertyId) && <p className="filter-guidance">{allowedSources.googleAds && !filters.googleAdsAccountId ? "Choose a Google Ads account to filter campaigns and types. " : ""}{allowedSources.ga4 && !filters.ga4PropertyId ? "Choose a GA4 property to filter channels, sources, and landing pages." : ""}</p>}
            {campaignAndDimensionFilters}
            {ga4Options?.truncated && <p className="filter-hint">GA4 options show the top 1,000 values from the last 90 days.</p>}
          </section>
          {issues.length > 0 && <div className="filter-message error" role="alert">{issues.map((issue) => issue.message).join(" ")}</div>}
          {warnings.map((warning) => <div className="filter-message warning" role="status" key={warning}>{warning}</div>)}
          {(optionError || ga4AccountsError) && <div className="filter-errors" aria-label="Connection errors">{optionError && <InlineError>{optionError}</InlineError>}{ga4AccountsError && <InlineError>{ga4AccountsError}</InlineError>}</div>}
        </div>
        <footer className="filter-drawer-footer"><button type="button" className="filter-clear-button" disabled={chips.length === 0} onClick={clearAll}>Clear all filters</button><button type="button" className="filter-done-button" onClick={closeFilterDrawer}>Done</button></footer>
      </aside>
    </div>}
  </div>;
}

function InlineError({ children }: { children: string }) {
  return <div className="connection-error" role="alert"><CircleAlert size={17} strokeWidth={2} aria-hidden="true" /><span>{children}</span></div>;
}

function MultiSelect({ title, values, options, disabled, emptyLabel, onChange }: {
  title: string; values: string[]; options: Array<{ value: string; label: string }>; disabled?: boolean; emptyLabel?: string; onChange: (value: string, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = values.length ? `${values.length} selected` : "All values";
  return <details className={`multi-select ${disabled ? "disabled" : ""}`} open={open} onToggle={(event) => { setOpen(event.currentTarget.open); closeOtherMultiSelects(event.currentTarget); }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; setOpen(false); event.currentTarget.querySelector("summary")?.focus(); } }}>
    {open && <button type="button" className="multi-select-backdrop" aria-label={`Close ${title} options`} onClick={(event) => { const details = event.currentTarget.parentElement as HTMLDetailsElement; details.open = false; setOpen(false); }} />}
    <summary aria-label={`${title}, ${summary}`} aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); }}>{title}<span>{disabled ? emptyLabel : summary}</span><ChevronDown size={13} /></summary>
    <div className="multi-select-popover">{options.length ? options.map((option) => <label key={option.value}><input type="checkbox" checked={values.includes(option.value)} disabled={disabled} onChange={(event) => onChange(option.value, event.target.checked)} /><span>{option.label}</span></label>) : <span className="empty-options">{emptyLabel ?? "No options"}</span>}</div>
  </details>;
}

function closeOtherMultiSelects(active: HTMLDetailsElement): void {
  if (!active.open) return;
  document.querySelectorAll<HTMLDetailsElement>(".multi-select[open]").forEach((details) => {
    if (details !== active) details.open = false;
  });
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await apiFetch(url, { signal });
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

function getApiError(body: unknown): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join(" ");
  }
  return "The selected filters could not be validated.";
}

function isMeaningfulFilterChange(filters: DashboardFilters): boolean {
  return Boolean(filters.googleAdsAccountId || filters.ga4PropertyId || filters.campaignIds.length || filters.campaignTypes.length || filters.channelGroups.length || filters.sourceMediums.length || filters.landingPages.length);
}

function titleCase(value: string): string { return value[0].toUpperCase() + value.slice(1); }
function formatEnum(value: string): string { return value.split("_").map(titleCase).join(" "); }
