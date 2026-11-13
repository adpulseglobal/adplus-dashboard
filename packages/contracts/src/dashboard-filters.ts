export const COMPARISON_MODES = ["none", "previous_period"] as const;
export const DEVICE_CATEGORIES = ["desktop", "mobile", "tablet"] as const;
export const CAMPAIGN_TYPES = ["SEARCH", "DISPLAY", "SHOPPING", "HOTEL", "VIDEO", "MULTI_CHANNEL", "LOCAL", "SMART", "PERFORMANCE_MAX", "LOCAL_SERVICES", "DEMAND_GEN", "TRAVEL"] as const;

export type ComparisonMode = (typeof COMPARISON_MODES)[number];
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export interface DateRange { startDate: string; endDate: string }
export interface DashboardFilters {
  dateRange: DateRange;
  comparison: ComparisonMode;
  googleAdsAccountId: string;
  ga4AccountId: string;
  ga4PropertyId: string;
  ga4AdsScope: boolean;
  campaignIds: string[];
  campaignTypes: CampaignType[];
  devices: DeviceCategory[];
  channelGroups: string[];
  sourceMediums: string[];
  landingPages: string[];
}
export interface FilterValidationIssue { field: string; message: string }
export type FilterParseResult = { success: true; data: DashboardFilters } | { success: false; issues: FilterValidationIssue[] };
export type ReportSource = "google_ads" | "ga4";
export interface PreviousPeriod { startDate: string; endDate: string }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CUSTOMER_ID_PATTERN = /^\d{1,32}$/;
export const FILTER_SUPPORT_MATRIX = {
  dateRange: ["google_ads", "ga4"], comparison: ["google_ads", "ga4"], googleAdsAccountId: ["google_ads", "ga4"], ga4AccountId: ["ga4"], ga4PropertyId: ["ga4"], ga4AdsScope: ["ga4"],
  campaignIds: ["google_ads", "ga4"], campaignTypes: ["google_ads", "ga4"], devices: ["google_ads", "ga4"],
  channelGroups: ["ga4"], sourceMediums: ["ga4"], landingPages: ["ga4"],
} as const satisfies Record<keyof DashboardFilters, readonly ReportSource[]>;

export function defaultDashboardFilters(today = new Date()): DashboardFilters {
  const endDate = formatDate(today);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    dateRange: { startDate: formatDate(start), endDate }, comparison: "previous_period",
    googleAdsAccountId: "", ga4AccountId: "", ga4PropertyId: "", ga4AdsScope: false, campaignIds: [], campaignTypes: [], devices: [],
    channelGroups: [], sourceMediums: [], landingPages: [],
  };
}

export function validateDashboardFilters(input: unknown): FilterParseResult {
  const issues: FilterValidationIssue[] = [];
  if (!isRecord(input)) return { success: false, issues: [{ field: "filters", message: "Expected a filter object." }] };
  const dateRange = input.dateRange;
  const startDate = isRecord(dateRange) && typeof dateRange.startDate === "string" ? dateRange.startDate : "";
  const endDate = isRecord(dateRange) && typeof dateRange.endDate === "string" ? dateRange.endDate : "";
  if (!isRealDate(startDate)) issues.push({ field: "startDate", message: "Use a valid date in YYYY-MM-DD format." });
  if (!isRealDate(endDate)) issues.push({ field: "endDate", message: "Use a valid date in YYYY-MM-DD format." });
  if (isRealDate(startDate) && isRealDate(endDate)) {
    if (startDate > endDate) issues.push({ field: "dateRange", message: "Start date must be on or before end date." });
    if (inclusiveDays(startDate, endDate) > 366) issues.push({ field: "dateRange", message: "Date range cannot exceed 366 days." });
    if (endDate > formatDate(new Date())) issues.push({ field: "endDate", message: "End date cannot be in the future." });
  }
  const comparison = input.comparison;
  if (!isOneOf(COMPARISON_MODES, comparison)) issues.push({ field: "comparison", message: "Choose none or previous_period." });
  const googleAdsAccountId = validateResourceId(input.googleAdsAccountId, "googleAdsAccountId", issues);
  const ga4AccountId = validateResourceId(input.ga4AccountId, "ga4AccountId", issues);
  const ga4PropertyId = validateResourceId(input.ga4PropertyId, "ga4PropertyId", issues);
  const ga4AdsScope = input.ga4AdsScope ?? false;
  if (typeof ga4AdsScope !== "boolean") issues.push({ field: "ga4AdsScope", message: "GA4 Ads scope must be on or off." });
  if (ga4AdsScope && !googleAdsAccountId) issues.push({ field: "ga4AdsScope", message: "Choose a Google Ads account before limiting GA4 traffic to it." });
  const campaignIds = validateStringArray(input.campaignIds, "campaignIds", issues, CUSTOMER_ID_PATTERN, "Campaign IDs must be numeric IDs.");
  const campaignTypes = validateEnumArray(input.campaignTypes, "campaignTypes", issues, CAMPAIGN_TYPES);
  const devices = validateEnumArray(input.devices, "devices", issues, DEVICE_CATEGORIES);
  const channelGroups = validateStringArray(input.channelGroups, "channelGroups", issues, undefined, "Channel group values cannot contain control characters.");
  const sourceMediums = validateStringArray(input.sourceMediums, "sourceMediums", issues, undefined, "Source/medium values cannot contain control characters.");
  const landingPages = validateStringArray(input.landingPages, "landingPages", issues, undefined, "Landing page values cannot contain control characters.");
  if (issues.length) return { success: false, issues };
  return { success: true, data: canonicalizeFilters({
    dateRange: { startDate, endDate }, comparison: comparison as ComparisonMode,
    googleAdsAccountId, ga4AccountId, ga4PropertyId, ga4AdsScope: ga4AdsScope as boolean, campaignIds, campaignTypes, devices, channelGroups, sourceMediums, landingPages,
  }) };
}

export function parseDashboardFiltersFromSearch(search: string, today?: Date): FilterParseResult {
  const params = new URLSearchParams(search);
  const defaults = defaultDashboardFilters(today);
  return validateDashboardFilters({
    dateRange: { startDate: params.get("startDate") ?? defaults.dateRange.startDate, endDate: params.get("endDate") ?? defaults.dateRange.endDate },
    comparison: params.get("comparison") ?? defaults.comparison,
    googleAdsAccountId: params.get("googleAdsAccountId") ?? "", ga4AccountId: params.get("ga4AccountId") ?? "", ga4PropertyId: params.get("ga4PropertyId") ?? "", ga4AdsScope: params.get("ga4AdsScope") === "true",
    campaignIds: params.getAll("campaignIds"), campaignTypes: params.getAll("campaignTypes"), devices: params.getAll("devices"),
    channelGroups: params.getAll("channelGroups"), sourceMediums: params.getAll("sourceMediums"), landingPages: params.getAll("landingPages"),
  });
}

export function serializeDashboardFilters(pathname: string, filters: DashboardFilters): string {
  const params = new URLSearchParams();
  params.set("startDate", filters.dateRange.startDate);
  params.set("endDate", filters.dateRange.endDate);
  params.set("comparison", filters.comparison);
  if (filters.googleAdsAccountId) params.set("googleAdsAccountId", filters.googleAdsAccountId);
  if (filters.ga4AccountId) params.set("ga4AccountId", filters.ga4AccountId);
  if (filters.ga4PropertyId) params.set("ga4PropertyId", filters.ga4PropertyId);
  if (filters.ga4AdsScope) params.set("ga4AdsScope", "true");
  appendValues(params, "campaignIds", filters.campaignIds);
  appendValues(params, "campaignTypes", filters.campaignTypes);
  appendValues(params, "devices", filters.devices);
  appendValues(params, "channelGroups", filters.channelGroups);
  appendValues(params, "sourceMediums", filters.sourceMediums);
  appendValues(params, "landingPages", filters.landingPages);
  return `${pathname}?${params.toString()}`;
}

export function canonicalizeFilters(filters: DashboardFilters): DashboardFilters {
  return {
    ...filters,
    campaignIds: sortedUnique(filters.campaignIds), campaignTypes: sortedUnique(filters.campaignTypes),
    devices: sortedUnique(filters.devices), channelGroups: sortedUnique(filters.channelGroups),
    sourceMediums: sortedUnique(filters.sourceMediums), landingPages: sortedUnique(filters.landingPages),
  };
}

export function buildReportQueryKey(source: ReportSource, filters: DashboardFilters): string {
  const canonical = canonicalizeFilters(filters);
  const sourceFilters = source === "google_ads"
    ? { dateRange: canonical.dateRange, comparison: canonical.comparison, account: canonical.googleAdsAccountId, campaigns: canonical.campaignIds, types: canonical.campaignTypes, devices: canonical.devices }
    : { dateRange: canonical.dateRange, comparison: canonical.comparison, property: canonical.ga4PropertyId, adsCustomer: canonical.ga4AdsScope ? canonical.googleAdsAccountId : "", campaigns: canonical.campaignIds, types: canonical.campaignTypes, devices: canonical.devices, channels: canonical.channelGroups, sourceMediums: canonical.sourceMediums, landingPages: canonical.landingPages };
  return `${source}:${JSON.stringify(sourceFilters)}`;
}

export function calculatePreviousPeriod(dateRange: DateRange): PreviousPeriod {
  const days = inclusiveDays(dateRange.startDate, dateRange.endDate);
  const previousEnd = shiftDate(dateRange.startDate, -1);
  return { startDate: shiftDate(previousEnd, -(days - 1)), endDate: previousEnd };
}

export function isFilterApplicable(source: ReportSource, filter: keyof DashboardFilters): boolean {
  return (FILTER_SUPPORT_MATRIX[filter] as readonly ReportSource[]).includes(source);
}

export function getFilterWarnings(filters: DashboardFilters): string[] {
  const warnings: string[] = [];
  if (filters.campaignIds.length && filters.channelGroups.some((channel) => !["Paid Search", "Paid Social", "Cross-network", "Paid Shopping", "Display", "Video"].includes(channel))) {
    warnings.push("These filters intersect in GA4: sessions must match the selected Google Ads campaign IDs and channel groups. The combination may return no rows.");
  }
  if (filters.campaignIds.length && filters.landingPages.length) warnings.push("GA4 applies campaign and landing page filters together; it does not attribute Google Ads spend to those landing pages.");
  if (filters.campaignTypes.length) warnings.push("Campaign types use Google Ads taxonomy. GA4 applies them only to Google Ads-attributed sessions and may not expose every Ads campaign subtype.");
  if (filters.ga4AdsScope) warnings.push("GA4 traffic is limited to sessions attributed to the selected Google Ads customer ID.");
  return warnings;
}

function validateResourceId(value: unknown, field: string, issues: FilterValidationIssue[]): string {
  if (value === "" || value === undefined) return "";
  if (typeof value !== "string" || !CUSTOMER_ID_PATTERN.test(value)) {
    issues.push({ field, message: "Select an ID from the accessible account/property list." });
    return "";
  }
  return value;
}

function validateStringArray<T extends string>(value: unknown, field: string, issues: FilterValidationIssue[], pattern?: RegExp, invalidMessage?: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.length > 500 || /[\u0000-\u001f\u007f]/.test(item) || (pattern && !pattern.test(item)))) {
    issues.push({ field, message: invalidMessage ?? "Provide up to 100 valid values." });
    return [];
  }
  return value as T[];
}

function validateEnumArray<T extends string>(value: unknown, field: string, issues: FilterValidationIssue[], supported: readonly T[]): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > supported.length || value.some((item) => !isOneOf(supported, item))) {
    issues.push({ field, message: `Contains an unsupported value. Supported values: ${supported.join(", ")}.` });
    return [];
  }
  return value as T[];
}

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && formatDate(date) === value;
}

function inclusiveDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function formatDate(date: Date): string { return date.toISOString().slice(0, 10); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T { return typeof value === "string" && values.includes(value as T); }
function sortedUnique<T extends string>(values: T[]): T[] { return [...new Set(values)].sort(); }
function appendValues(params: URLSearchParams, key: string, values: string[]): void { for (const value of [...new Set(values)].sort()) params.append(key, value); }
