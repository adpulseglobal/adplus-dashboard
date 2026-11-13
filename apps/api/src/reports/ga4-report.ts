import type { DashboardFilters } from "../../../../packages/contracts/src/dashboard-filters";

export interface Ga4ReportRow {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

export interface Ga4ReportData {
  source: "ga4";
  mode: "live" | "mock";
  propertyId: string;
  period: DashboardFilters["dateRange"];
  totals: { sessions: number; users: number; engagedSessions: number; engagementRate: number; keyEvents: number };
  daily: Array<{ date: string; sessions: number }>;
  channels: Array<{ name: string; sessions: number }>;
  sourceMediums: Array<{ name: string; sessions: number }>;
  landingPages: Array<{ name: string; sessions: number }>;
  devices: Array<{ name: string; sessions: number }>;
  truncated: boolean;
}

export function buildGa4ReportRequest(dimension: string, filters: DashboardFilters, offset = 0) {
  const expressions: unknown[] = [];
  const addInList = (fieldName: string, values: string[]) => {
    if (values.length) expressions.push({ filter: { fieldName, inListFilter: { values, caseSensitive: true } } });
  };
  addInList("sessionGoogleAdsCustomerId", filters.ga4AdsScope ? [filters.googleAdsAccountId] : []);
  addInList("sessionGoogleAdsCampaignId", filters.campaignIds);
  addInList("sessionGoogleAdsCampaignType", filters.campaignTypes.map((value) => ga4CampaignType(value)));
  addInList("deviceCategory", filters.devices);
  addInList("sessionDefaultChannelGroup", filters.channelGroups);
  addInList("sessionSourceMedium", filters.sourceMediums);
  addInList("landingPage", filters.landingPages);
  return {
    dateRanges: [{ startDate: filters.dateRange.startDate, endDate: filters.dateRange.endDate }],
    dimensions: [{ name: dimension }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }, { name: "keyEvents" }],
    limit: "10000",
    ...(offset ? { offset: String(offset) } : {}),
    metricAggregations: ["TOTAL"],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    ...(expressions.length ? { dimensionFilter: { andGroup: { expressions } } } : {}),
  };
}

export function buildMockGa4Report(filters: DashboardFilters, propertyId: string): Ga4ReportData {
  const fixture = [
    { channel: "Organic Search", source: "google / organic", sessions: 6842, campaignId: "", campaignType: "", adsCustomerId: "" },
    { channel: "Paid Search", source: "google / cpc", sessions: 2890, campaignId: "501", campaignType: "Search", adsCustomerId: "1234567890" },
    { channel: "Paid Search", source: "google / cpc", sessions: 1400, campaignId: "502", campaignType: "Search", adsCustomerId: "1234567890" },
    { channel: "Direct", source: "(direct) / (none)", sessions: 3511, campaignId: "", campaignType: "", adsCustomerId: "" },
    { channel: "Referral", source: "newsletter / email", sessions: 1684, campaignId: "", campaignType: "", adsCustomerId: "" },
    { channel: "Paid Social", source: "facebook / cpc", sessions: 1210, campaignId: "503", campaignType: "Performance Max", adsCustomerId: "9876543210" },
    { channel: "Display", source: "google / cpc", sessions: 250, campaignId: "504", campaignType: "Display", adsCustomerId: "9876543210" },
  ];
  const pages = ["/", "/collections/spring", "/products/everyday-tote", "/blog/spring-guide", "/guides/material-care"];
  const devices = ["mobile", "desktop", "tablet"];
  const rows = fixture.flatMap((item) => pages.flatMap((landingPage, pageIndex) => devices.map((device, deviceIndex) => {
    const bucket = pageIndex * devices.length + deviceIndex;
    const bucketCount = pages.length * devices.length;
    return { ...item, landingPage, device, sessions: Math.floor(item.sessions / bucketCount) + (bucket < item.sessions % bucketCount ? 1 : 0) };
  })));
  const selected = rows.filter((row) => (!filters.ga4AdsScope || row.adsCustomerId === filters.googleAdsAccountId)
    && (!filters.channelGroups.length || filters.channelGroups.includes(row.channel))
    && (!filters.sourceMediums.length || filters.sourceMediums.includes(row.source))
    && (!filters.landingPages.length || filters.landingPages.includes(row.landingPage))
    && (!filters.devices.length || filters.devices.includes(row.device as "mobile" | "desktop" | "tablet"))
    && (!filters.campaignIds.length || filters.campaignIds.includes(row.campaignId))
    && (!filters.campaignTypes.length || filters.campaignTypes.some((type) => ga4CampaignType(type) === row.campaignType)));
  const aggregate = (key: "channel" | "source" | "landingPage" | "device") => {
    const groups = new Map<string, number>();
    for (const row of selected) groups.set(row[key], (groups.get(row[key]) ?? 0) + row.sessions);
    return [...groups].map(([name, sessions]) => ({ name, sessions })).sort((a, b) => b.sessions - a.sessions);
  };
  const channels = aggregate("channel");
  const sourceMediums = aggregate("source");
  const landingPages = aggregate("landingPage");
  const deviceSessions = aggregate("device");
  const sessions = selected.reduce((total, row) => total + row.sessions, 0);
  const days = Math.max(1, Math.floor((Date.parse(`${filters.dateRange.endDate}T00:00:00Z`) - Date.parse(`${filters.dateRange.startDate}T00:00:00Z`)) / 86_400_000) + 1);
  const calendarDays = Array.from({ length: days }, (_, index) => {
    const date = new Date(`${filters.dateRange.startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date;
  });
  const dailyWeights = calendarDays.map((date, index) => (date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.65 : 1) * (1 + Math.sin(index * Math.PI / 7) * 0.12));
  const dailyCounts = allocateIntegerTotal(sessions, dailyWeights);
  const daily = calendarDays.map((date, index) => ({ date: date.toISOString().slice(0, 10), sessions: dailyCounts[index] }));
  return {
    source: "ga4", mode: "mock", propertyId, period: { ...filters.dateRange },
    totals: { sessions, users: Math.round(sessions * 0.72), engagedSessions: Math.round(sessions * 0.68), engagementRate: sessions ? 0.68 : 0, keyEvents: Math.round(sessions * 0.041) },
    daily, channels, sourceMediums, landingPages, devices: deviceSessions, truncated: false,
  };
}

function allocateIntegerTotal(total: number, weights: number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => total * weight / weightTotal);
  const values = exact.map(Math.floor);
  let remainder = total - values.reduce((sum, value) => sum + value, 0);
  exact.map((value, index) => ({ index, fraction: value - values[index] }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, remainder)
    .forEach(({ index }) => values[index]++);
  return values;
}

export function mapGa4CampaignType(type: string): string {
  return ga4CampaignType(type);
}

function ga4CampaignType(value: string): string {
  const aliases: Record<string, string> = { PERFORMANCE_MAX: "Performance Max", MULTI_CHANNEL: "Cross-network", DEMAND_GEN: "Demand Gen", LOCAL_SERVICES: "Local" };
  return aliases[value] ?? value[0] + value.slice(1).toLowerCase();
}
