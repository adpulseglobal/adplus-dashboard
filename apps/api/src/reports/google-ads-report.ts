import type { DashboardFilters } from "../../../../packages/contracts/src/dashboard-filters";

export interface GoogleAdsReportRow {
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
  customer?: { currencyCode?: string; descriptiveName?: string };
  segments?: { date?: string; device?: string };
  metrics?: { costMicros?: string; clicks?: string; impressions?: string; conversions?: string };
}

export interface GoogleAdsMetricTotals {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  costPerConversion: number | null;
}

export interface GoogleAdsBreakdown extends GoogleAdsMetricTotals {
  date?: string;
  device?: string;
  campaignType?: string;
}

export interface GoogleAdsCampaignReport extends GoogleAdsMetricTotals {
  id: string;
  name: string;
  status: string;
  campaignType: string;
}

export interface GoogleAdsReport {
  source: "google_ads";
  mode: "live" | "mock";
  accountId: string;
  currency: string;
  period: DashboardFilters["dateRange"];
  totals: GoogleAdsMetricTotals;
  campaigns: GoogleAdsCampaignReport[];
  daily: GoogleAdsBreakdown[];
  devices: GoogleAdsBreakdown[];
  campaignTypes: GoogleAdsBreakdown[];
}

export function buildCampaignReportQuery(filters: DashboardFilters): string {
  const conditions = [
    `segments.date BETWEEN '${filters.dateRange.startDate}' AND '${filters.dateRange.endDate}'`,
  ];
  if (filters.campaignIds.length) conditions.push(`campaign.id IN (${filters.campaignIds.join(", ")})`);
  if (filters.campaignTypes.length) conditions.push(`campaign.advertising_channel_type IN (${filters.campaignTypes.map((type) => `'${type}'`).join(", ")})`);
  if (filters.devices.length) conditions.push(`segments.device IN (${filters.devices.map(toGoogleDevice).map((device) => `'${device}'`).join(", ")})`);

  return [
    "SELECT customer.currency_code, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,",
    "segments.date, segments.device, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions",
    "FROM campaign",
    `WHERE ${conditions.join(" AND ")}`,
    "ORDER BY segments.date, campaign.id",
  ].join(" ");
}

export function normalizeCampaignReport(rows: GoogleAdsReportRow[], accountId: string, mode: GoogleAdsReport["mode"], period: DashboardFilters["dateRange"]): GoogleAdsReport {
  const campaignRows = new Map<string, GoogleAdsMetricAccumulator & { id: string; name: string; status: string; campaignType: string }>();
  const dailyRows = new Map<string, GoogleAdsMetricAccumulator>();
  const deviceRows = new Map<string, GoogleAdsMetricAccumulator>();
  const typeRows = new Map<string, GoogleAdsMetricAccumulator>();
  let currency = "USD";

  for (const row of rows) {
    const id = row.campaign?.id;
    const date = row.segments?.date;
    const device = row.segments?.device;
    const campaignType = row.campaign?.advertisingChannelType;
    if (!id || !date || !device || !campaignType) continue;
    currency = row.customer?.currencyCode || currency;
    const metrics = metricsFromRow(row);
    addToBucket(campaignRows, id, metrics, () => ({
      id,
      name: row.campaign?.name || `Campaign ${id}`,
      status: row.campaign?.status || "UNKNOWN",
      campaignType,
      costMicros: 0, clicks: 0, impressions: 0, conversions: 0,
    }));
    addToBucket(dailyRows, date, metrics);
    addToBucket(deviceRows, device, metrics);
    addToBucket(typeRows, campaignType, metrics);
  }

  const totals = sumMetrics([...campaignRows.values()]);
  return {
    source: "google_ads", mode, accountId, currency, period: { ...period },
    totals: finishMetrics(totals),
    campaigns: [...campaignRows.values()].map((row) => ({
      id: row.id, name: row.name, status: row.status, campaignType: row.campaignType, ...finishMetrics(row),
    })).sort((a, b) => b.spend - a.spend),
    daily: finishBreakdowns(dailyRows, "date"),
    devices: finishBreakdowns(deviceRows, "device"),
    campaignTypes: finishBreakdowns(typeRows, "campaignType"),
  };
}

// These two helpers keep currencies and rounded rates derived from summed base metrics.
interface GoogleAdsMetricAccumulator { costMicros: number; clicks: number; impressions: number; conversions: number }

function metricsFromRow(row: GoogleAdsReportRow): GoogleAdsMetricAccumulator {
  return {
    costMicros: finiteNumber(row.metrics?.costMicros),
    clicks: finiteNumber(row.metrics?.clicks),
    impressions: finiteNumber(row.metrics?.impressions),
    conversions: finiteNumber(row.metrics?.conversions),
  };
}

function addToBucket<T extends GoogleAdsMetricAccumulator>(map: Map<string, T>, key: string, value: GoogleAdsMetricAccumulator, create: () => T = () => emptyAccumulator() as T): void {
  const bucket = map.get(key) ?? create();
  bucket.costMicros += value.costMicros;
  bucket.clicks += value.clicks;
  bucket.impressions += value.impressions;
  bucket.conversions += value.conversions;
  map.set(key, bucket);
}

function sumMetrics(rows: GoogleAdsMetricAccumulator[]): GoogleAdsMetricAccumulator {
  return rows.reduce((total, row) => ({
    costMicros: total.costMicros + row.costMicros,
    clicks: total.clicks + row.clicks,
    impressions: total.impressions + row.impressions,
    conversions: total.conversions + row.conversions,
  }), emptyAccumulator());
}

function finishMetrics(metrics: GoogleAdsMetricAccumulator): GoogleAdsMetricTotals {
  const spend = metrics.costMicros / 1_000_000;
  return {
    spend: Math.round(spend * 100) / 100,
    clicks: metrics.clicks,
    impressions: metrics.impressions,
    conversions: round(metrics.conversions, 2),
    ctr: metrics.impressions ? round(metrics.clicks / metrics.impressions * 100, 2) : 0,
    costPerConversion: metrics.conversions ? Math.round(spend / metrics.conversions * 100) / 100 : null,
  };
}

function finishBreakdowns<T extends GoogleAdsMetricAccumulator>(map: Map<string, T>, key: "date" | "device" | "campaignType"): GoogleAdsBreakdown[] {
  const entries = [...map.entries()].map(([value, metrics]) => ({ [key]: value, ...finishMetrics(metrics) })) as GoogleAdsBreakdown[];
  return entries.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")));
}

function emptyAccumulator(): GoogleAdsMetricAccumulator { return { costMicros: 0, clicks: 0, impressions: 0, conversions: 0 }; }
function finiteNumber(value: string | undefined): number { const result = Number(value ?? 0); return Number.isFinite(result) && result >= 0 ? result : 0; }
function round(value: number, places: number): number { const scale = 10 ** places; return Math.round(value * scale) / scale; }
function toGoogleDevice(device: string): string { return device.toUpperCase(); }

export function buildMockCampaignRows(filters: DashboardFilters, currency = "USD"): GoogleAdsReportRow[] {
  const campaigns = [
    { id: "501", name: "Spring collection | Search", status: "ENABLED", type: "SEARCH", spend: 4286.2, clicks: 2841, ctr: 4.82, conversions: 186 },
    { id: "502", name: "Brand | US", status: "ENABLED", type: "SEARCH", spend: 2914.8, clicks: 3092, ctr: 8.14, conversions: 241 },
    { id: "503", name: "Prospecting | Performance Max", status: "ENABLED", type: "PERFORMANCE_MAX", spend: 3760.45, clicks: 1927, ctr: 2.31, conversions: 129 },
    { id: "504", name: "Remarketing | Display", status: "PAUSED", type: "DISPLAY", spend: 1145, clicks: 1604, ctr: 1.76, conversions: 42 },
  ].filter((campaign) => (!filters.campaignIds.length || filters.campaignIds.includes(campaign.id))
    && (!filters.campaignTypes.length || filters.campaignTypes.includes(campaign.type as typeof filters.campaignTypes[number]))
    && mockCampaignIsActive(campaign.id, filters.dateRange.startDate, filters.dateRange.endDate));
  const days = listDays(filters.dateRange.startDate, filters.dateRange.endDate);
  const deviceWeights = ["MOBILE", "DESKTOP", "TABLET"].map((device) => ({ device, weight: filters.devices.length && !filters.devices.includes(device.toLowerCase() as typeof filters.devices[number]) ? 0 : device === "MOBILE" ? 50 : device === "DESKTOP" ? 35 : 15 }));
  const weights = days.flatMap((date, index) => {
    const progress = days.length > 1 ? index / (days.length - 1) : 0;
    const dayWeight = 1 + Math.sin(progress * Math.PI) * 0.25;
    return deviceWeights.map(({ device, weight }) => ({ date, device, weight: weight * dayWeight }));
  });
  return campaigns.flatMap((campaign) => {
    const spend = allocate(Math.round(campaign.spend * 1_000_000), weights.map((item) => item.weight));
    const clicks = allocate(campaign.clicks, weights.map((item) => item.weight));
    const conversions = allocate(campaign.conversions, weights.map((item) => item.weight));
    return weights.flatMap((item, index) => {
      if (!item.weight) return [];
      const impressions = clicks[index] ? Math.round(clicks[index] / (campaign.ctr / 100)) : 0;
      return [{
        customer: { currencyCode: currency },
        campaign: { id: campaign.id, name: campaign.name, status: campaign.status, advertisingChannelType: campaign.type },
        segments: { date: item.date, device: item.device },
        metrics: { costMicros: String(spend[index]), clicks: String(clicks[index]), impressions: String(impressions), conversions: String(conversions[index]) },
      }];
    });
  });
}

function mockCampaignIsActive(id: string, startDate: string, endDate: string): boolean {
  const firstActiveDate: Record<string, string> = {
    "501": "2026-01-01", "502": "2026-01-01", "503": "2026-01-01", "504": "2026-01-01",
  };
  const lastActiveDate: Record<string, string> = {
    "501": "2026-12-31", "502": "2026-06-30", "503": "2026-12-31", "504": "2026-03-31",
  };
  return startDate <= lastActiveDate[id] && endDate >= firstActiveDate[id];
}

function listDays(start: string, end: string): string[] {
  const days: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current <= last) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function allocate(total: number, weights: number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (!weightTotal) return weights.map(() => 0);
  const exact = weights.map((weight) => total * weight / weightTotal);
  const values = exact.map(Math.floor);
  let remainder = total - values.reduce((sum, value) => sum + value, 0);
  exact.map((value, index) => ({ index, fraction: value - values[index] }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, remainder)
    .forEach(({ index }) => values[index]++);
  return values;
}
