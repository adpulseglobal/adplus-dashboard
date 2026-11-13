import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Ga4Account, Ga4Property } from "../connections/connection.types";
import { GoogleAuthService } from "./google-auth.service";
import { assertGoogleResponse, isMockMode, throwMockScenarioIfRequired } from "./provider-errors";
import { buildGa4ReportRequest, buildMockGa4Report } from "../reports/ga4-report";
import type { DashboardFilters } from "../../../../packages/contracts/src/dashboard-filters";

interface PropertySummary { property?: string; displayName?: string }
interface AccountSummary { account?: string; displayName?: string; propertySummaries?: PropertySummary[] }
interface AccountSummariesResponse { accountSummaries?: AccountSummary[]; nextPageToken?: string }
interface GoogleAdsLink { customerId?: string }
interface GoogleAdsLinksResponse { googleAdsLinks?: GoogleAdsLink[]; nextPageToken?: string }
interface RunReportRequest { dimensions: Array<{ name: string }>; metrics: Array<{ name: string }>; dateRanges: Array<{ startDate: string; endDate: string }>; limit: string; orderBys?: Array<{ metric?: { metricName: string }; desc?: boolean }> }
interface ReportRow { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }
interface RunReportResult { rows?: ReportRow[]; totals?: ReportRow[]; rowCount?: number }
interface BatchRunReportsResponse { reports?: RunReportResult[] }
export interface Ga4FilterOptions { channelGroups: string[]; sourceMediums: string[]; landingPages: string[]; truncated: boolean; mode: "live" | "mock" }
const MOCK_GA4_PROPERTIES: Ga4Property[] = [
  { id: "100000001", resourceName: "properties/100000001", displayName: "Northstar Outfitters Store", accountName: "Northstar Outfitters", accountId: "200000001", source: "ga4", mode: "mock" },
  { id: "100000002", resourceName: "properties/100000002", displayName: "Northstar Journal", accountName: "Northstar Journal", accountId: "200000002", source: "ga4", mode: "mock" },
];
const MOCK_GA4_PROPERTIES_BY_ADS_ACCOUNT: Record<string, string[]> = {
  "1234567890": ["100000001"],
  "9876543210": ["100000002"],
};
const MOCK_FILTER_OPTIONS: Omit<Ga4FilterOptions, "mode"> = {
  channelGroups: ["Direct", "Organic Search", "Paid Search", "Paid Social", "Referral", "Display"],
  sourceMediums: ["google / organic", "google / cpc", "(direct) / (none)", "newsletter / email", "facebook / cpc"],
  landingPages: ["/", "/collections/spring", "/products/everyday-tote", "/blog/spring-guide", "/guides/material-care"],
  truncated: false,
};
const OPTION_LIMIT = 1000;

@Injectable()
export class Ga4Provider {
  constructor(private readonly googleAuth: GoogleAuthService) {}

  async getAcquisitionReport(propertyId: string, filters: DashboardFilters) {
    if (isMockMode()) {
      throwMockScenarioIfRequired();
      return buildMockGa4Report(filters, propertyId);
    }
    const token = await this.googleAuth.getAccessToken();
    const dimensions = ["date", "sessionDefaultChannelGroup", "sessionSourceMedium", "landingPage", "deviceCategory"];
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`;
    const reports: RunReportResult[] = [];
    const pageSize = 10_000;
    const maxRows = 50_000;
    let truncated = false;
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const active = dimensions.map((dimension, index) => ({ dimension, index })).filter(({ index }) => (reports[index]?.rows?.length ?? 0) < (reports[index]?.rowCount ?? Number.POSITIVE_INFINITY));
      if (offset > 0 && !active.length) break;
      const requests = active.map(({ dimension, index }) => buildGa4ReportRequest(dimension, filters, index < reports.length ? offset : 0));
      let response: Response;
      try {
        response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ requests }), signal: AbortSignal.timeout(25_000) });
      } catch {
        throw new ServiceUnavailableException("Google Analytics report data is unavailable.");
      }
      await assertGoogleResponse(response, "Google Analytics Data API");
      const page = await response.json() as BatchRunReportsResponse;
      active.forEach(({ index }, resultIndex) => {
        const result = page.reports?.[resultIndex] ?? {};
        reports[index] = { ...result, rows: [...(reports[index]?.rows ?? []), ...(result.rows ?? [])] };
      });
      if (offset + pageSize >= maxRows && reports.some((report) => (report.rowCount ?? 0) > (report.rows?.length ?? 0))) truncated = true;
    }
    const dailyRows = reports[0]?.rows ?? [];
    const daily = dailyRows.flatMap((row) => {
      const value = row.dimensionValues?.[0]?.value;
      if (!value || value.length !== 8) return [];
      return [{ date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, sessions: metric(row, 0) }];
    }).sort((a, b) => a.date.localeCompare(b.date));
    // Use GA4's TOTAL aggregation for distinct users; summing daily users would double-count people active on multiple days.
    const aggregate = reports[0]?.totals?.[0];
    const totals = { sessions: metric(aggregate, 0), users: metric(aggregate, 1), engagedSessions: metric(aggregate, 2), keyEvents: metric(aggregate, 3) };
    const mapRows = (index: number) => (reports[index]?.rows ?? []).flatMap((row) => {
      const name = row.dimensionValues?.[0]?.value;
      return name && name !== "(not set)" ? [{ name, sessions: metric(row, 0) }] : [];
    });
    return {
      source: "ga4" as const, mode: "live" as const, propertyId, period: { ...filters.dateRange },
      totals: { ...totals, engagementRate: totals.sessions ? totals.engagedSessions / totals.sessions : 0 },
      daily, channels: mapRows(1), sourceMediums: mapRows(2), landingPages: mapRows(3), devices: mapRows(4), truncated,
    };
  }

  async listAccessibleAccounts(): Promise<Ga4Account[]> {
    if (isMockMode()) {
      throwMockScenarioIfRequired();
      return [
        { id: "200000001", displayName: "Northstar Outfitters", properties: MOCK_GA4_PROPERTIES.filter((property) => property.accountId === "200000001"), mode: "mock" },
        { id: "200000002", displayName: "Northstar Journal", properties: MOCK_GA4_PROPERTIES.filter((property) => property.accountId === "200000002"), mode: "mock" },
      ];
    }
    const token = await this.googleAuth.getAccessToken();
    const summaries = await this.getAllAccountSummaries(token);
    return summaries.flatMap((account) => {
      const accountId = account.account?.match(/^accounts\/(\d+)$/)?.[1];
      if (!accountId) return [];
      const displayName = account.displayName ?? `GA4 account ${accountId}`;
      const properties = (account.propertySummaries ?? []).flatMap((property) => {
        const id = property.property?.match(/^properties\/(\d+)$/)?.[1];
        return id ? [{ id, resourceName: `properties/${id}`, displayName: property.displayName ?? `GA4 ${id}`, accountName: displayName, accountId, source: "ga4" as const, mode: "live" as const }] : [];
      });
      return [{ id: accountId, displayName, properties, mode: "live" as const }];
    });
  }

  async listAccessibleProperties(): Promise<Ga4Property[]> {
    return (await this.listAccessibleAccounts()).flatMap((account) => account.properties);
  }

  async listPropertiesLinkedToAdsCustomer(customerId: string): Promise<Ga4Property[]> {
    if (isMockMode()) {
      throwMockScenarioIfRequired();
      const linkedIds = new Set(MOCK_GA4_PROPERTIES_BY_ADS_ACCOUNT[customerId] ?? []);
      return MOCK_GA4_PROPERTIES.filter((property) => linkedIds.has(property.id));
    }

    const token = await this.googleAuth.getAccessToken();
    const summaries = await this.getAllAccountSummaries(token);
    const properties = summaries.flatMap((account) => (account.propertySummaries ?? []).flatMap((property) => {
      const id = property.property?.match(/^properties\/(\d+)$/)?.[1];
      return id ? [{ id, resourceName: `properties/${id}`, displayName: property.displayName ?? `GA4 ${id}`, accountName: account.displayName ?? account.account ?? "Google Analytics", accountId: account.account?.match(/^accounts\/(\d+)$/)?.[1] ?? "", source: "ga4" as const, mode: "live" as const }] : [];
    }));
    const linked = await mapConcurrent(properties, 5, async (property) => ({
      property,
      isLinked: await this.hasGoogleAdsLink(property.id, customerId, token),
    }));
    return linked.flatMap(({ property, isLinked }) => isLinked ? [property] : []);
  }

  private async hasGoogleAdsLink(propertyId: string, customerId: string, token: string): Promise<boolean> {
    let pageToken: string | undefined;
    do {
      const url = new URL(`https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/googleAdsLinks`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.fetchAdminApi(url, token);
      await assertGoogleResponse(response, "Google Analytics Admin API");
      const page = await response.json() as GoogleAdsLinksResponse;
      if ((page.googleAdsLinks ?? []).some((link) => normalizeAdsCustomerId(link.customerId) === customerId)) return true;
      pageToken = page.nextPageToken;
    } while (pageToken);
    return false;
  }

  async listFilterOptions(propertyId: string): Promise<Ga4FilterOptions> {
    if (isMockMode()) {
      throwMockScenarioIfRequired();
      return { ...MOCK_FILTER_OPTIONS, mode: "mock" };
    }
    const token = await this.googleAuth.getAccessToken();
    const response = await this.runOptionReports(propertyId, token);
    await assertGoogleResponse(response, "Google Analytics Data API");
    const result = await response.json() as BatchRunReportsResponse;
    const reports = result.reports ?? [];
    return {
      channelGroups: getDimensionValues(reports[0]),
      sourceMediums: getDimensionValues(reports[1]),
      landingPages: getDimensionValues(reports[2]),
      truncated: reports.some((report) => (report.rowCount ?? 0) > OPTION_LIMIT),
      mode: "live",
    };
  }

  private runOptionReports(propertyId: string, token: string): Promise<Response> {
    const dimensions = ["sessionDefaultChannelGroup", "sessionSourceMedium", "landingPage"];
    const requests: RunReportRequest[] = dimensions.map((dimension) => ({
      dateRanges: [{ startDate: "90daysAgo", endDate: "today" }],
      dimensions: [{ name: dimension }],
      metrics: [{ name: "sessions" }],
      limit: String(OPTION_LIMIT),
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    }));
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`;
    return fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ requests }), signal: AbortSignal.timeout(25_000) })
      .catch(() => { throw new ServiceUnavailableException("Google Analytics filter options are unavailable."); });
  }

  private async getAllAccountSummaries(token: string): Promise<AccountSummary[]> {
    const summaries: AccountSummary[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.fetchAccountSummaries(url, token);
      await assertGoogleResponse(response, "Google Analytics Admin API");
      const page = await response.json() as AccountSummariesResponse;
      summaries.push(...(page.accountSummaries ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return summaries;
  }

  private async fetchAccountSummaries(url: URL, token: string): Promise<Response> {
    return this.fetchAdminApi(url, token);
  }

  private async fetchAdminApi(url: URL, token: string): Promise<Response> {
    try {
      return await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ServiceUnavailableException("Google Analytics Admin API is unavailable.");
    }
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

function normalizeAdsCustomerId(customerId?: string): string {
  return customerId?.replace(/-/g, "") ?? "";
}

function getDimensionValues(report?: RunReportResult): string[] {
  return (report?.rows ?? []).flatMap((row) => {
    const value = row.dimensionValues?.[0]?.value;
    return typeof value === "string" && value !== "(not set)" ? [value] : [];
  });
}

function metric(row: ReportRow | undefined, index: number): number {
  const value = Number(row?.metricValues?.[index]?.value ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
