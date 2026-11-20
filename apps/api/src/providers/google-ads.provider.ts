import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { GoogleAdsAccount } from "../connections/connection.types";
import { GoogleAuthService } from "./google-auth.service";
import { assertGoogleResponse, isMockMode, throwMockScenarioIfRequired } from "./provider-errors";
import { buildCampaignReportQuery, buildMockCampaignRows, normalizeCampaignReport, type GoogleAdsReport, type GoogleAdsReportRow } from "../reports/google-ads-report";
import type { DashboardFilters } from "../../../../packages/contracts/src/dashboard-filters";

interface AccessibleCustomersResponse { resourceNames?: string[] }
interface GoogleAdsSearchResponse { results?: GoogleAdsReportRow[]; nextPageToken?: string }
interface GoogleAdsCustomerClient { clientCustomer?: string; descriptiveName?: string; manager?: boolean; level?: number; status?: string }
interface GoogleAdsCustomerClientResponse { results?: Array<{ customerClient?: GoogleAdsCustomerClient }> }
export interface CampaignFilterOptions { campaigns: Array<{ id: string; name: string; type: string }>; campaignTypes: string[]; mode: "live" | "mock" }
const MOCK_ADS_ACCOUNTS: GoogleAdsAccount[] = [
  { id: "1234567890", resourceName: "customers/1234567890", displayName: "AdPulse Demo Account", source: "google_ads", mode: "mock" },
  { id: "9876543210", resourceName: "customers/9876543210", displayName: "Northstar Search Account", source: "google_ads", mode: "mock" },
];
const MOCK_CAMPAIGNS = [
  { id: "501", name: "Spring collection | Search", type: "SEARCH" },
  { id: "502", name: "Brand | US", type: "SEARCH" },
  { id: "503", name: "Prospecting | Performance Max", type: "PERFORMANCE_MAX" },
  { id: "504", name: "Remarketing | Display", type: "DISPLAY" },
];

@Injectable()
export class GoogleAdsProvider {
  private readonly loginCustomerIds = new Map<string, string>();

  constructor(private readonly googleAuth: GoogleAuthService) {}

  async listAccessibleAccounts(): Promise<GoogleAdsAccount[]> {
    if (isMockMode()) {
      throwMockScenarioIfRequired();
      return MOCK_ADS_ACCOUNTS;
    }
    const version = process.env.GOOGLE_ADS_API_VERSION ?? "v26";
    const response = await this.fetchAccessibleCustomers(version);
    await assertGoogleResponse(response, "Google Ads API");
    const result = await response.json() as AccessibleCustomersResponse;
    const directAccounts = await Promise.all((result.resourceNames ?? []).flatMap((resourceName) => {
      const id = resourceName.match(/^customers\/(\d+)$/)?.[1];
      return id ? [this.toLiveAccount(id, resourceName, version)] : [];
    }));
    const descendants = await Promise.all(directAccounts.map((account) => this.listManagerClients(account.id, version)));
    const unique = new Map<string, GoogleAdsAccount>();
    for (const account of [...directAccounts, ...descendants.flat()]) unique.set(account.id, account);
    return [...unique.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private async toLiveAccount(id: string, resourceName: string, apiVersion: string): Promise<GoogleAdsAccount> {
    let displayName = `Google Ads ${id}`;
    try {
      const response = await this.searchCampaignPage(id, apiVersion, "SELECT customer.descriptive_name FROM customer LIMIT 1");
      await assertGoogleResponse(response, "Google Ads API");
      const page = await response.json() as GoogleAdsSearchResponse;
      displayName = page.results?.[0]?.customer?.descriptiveName || displayName;
    } catch {
      // Keep the accessible customer visible if its descriptive name is unavailable.
    }
    return { id, resourceName, displayName, source: "google_ads", mode: "live" };
  }

  private async listManagerClients(managerId: string, apiVersion: string): Promise<GoogleAdsAccount[]> {
    const query = "SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.manager, customer_client.level, customer_client.status FROM customer_client WHERE customer_client.status = 'ENABLED'";
    try {
      const response = await this.searchCampaignPage(managerId, apiVersion, query, undefined, managerId);
      await assertGoogleResponse(response, "Google Ads API");
      const page = await response.json() as GoogleAdsCustomerClientResponse;
      return (page.results ?? []).flatMap(({ customerClient }) => {
        const id = customerClient?.clientCustomer?.match(/^customers\/(\d+)$/)?.[1];
        if (!id || id === managerId || customerClient?.manager) return [];
        this.loginCustomerIds.set(id, managerId);
        return [{ id, resourceName: `customers/${id}`, displayName: customerClient?.descriptiveName || `Google Ads ${id}`, source: "google_ads" as const, mode: "live" as const }];
      });
    } catch {
      // Keep direct accounts available if this user cannot enumerate a manager hierarchy.
      return [];
    }
  }

  async listCampaignFilterOptions(customerId: string, dateRange: DashboardFilters["dateRange"]): Promise<CampaignFilterOptions> {
    if (isMockMode()) {
      throwMockScenarioIfRequired();
      const campaignIds = new Set(buildMockCampaignRows({
        dateRange, googleAdsAccountId: customerId, comparison: "none", ga4AccountId: "", ga4PropertyId: "", ga4AdsScope: false,
        campaignIds: [], campaignTypes: [], devices: [], channelGroups: [], sourceMediums: [], landingPages: [],
      } as DashboardFilters).map((row) => row.campaign?.id).filter((id): id is string => Boolean(id)));
      const campaigns = MOCK_CAMPAIGNS.filter((campaign) => campaignIds.has(campaign.id));
      return { campaigns, campaignTypes: [...new Set(campaigns.map((campaign) => campaign.type))].sort(), mode: "mock" };
    }
    const apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? "v26";
    const filters = {
      dateRange, comparison: "none", googleAdsAccountId: customerId, ga4AccountId: "", ga4PropertyId: "", ga4AdsScope: false,
      campaignIds: [], campaignTypes: [], devices: [], channelGroups: [], sourceMediums: [], landingPages: [],
    } as DashboardFilters;
    const rows = await this.getCampaignReportRows(customerId, apiVersion, buildCampaignReportQuery(filters));
    const options = [...new Map(rows.flatMap((row) => {
      const campaign = row.campaign;
      if (typeof campaign?.id !== "string" || !campaign.id || typeof campaign.name !== "string" || typeof campaign.advertisingChannelType !== "string") return [];
      return [[campaign.id, { id: campaign.id, name: campaign.name, type: campaign.advertisingChannelType }] as const];
    })).values()];
    return { campaigns: options, campaignTypes: [...new Set(options.map((campaign) => campaign.type))].sort(), mode: "live" };
  }

  async getCampaignPerformance(customerId: string, filters: DashboardFilters): Promise<GoogleAdsReport> {
    if (isMockMode()) {
      throwMockScenarioIfRequired();
      return normalizeCampaignReport(buildMockCampaignRows(filters), customerId, "mock", filters.dateRange);
    }
    const apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? "v26";
    const query = buildCampaignReportQuery(filters);
    const rows = await this.getCampaignReportRows(customerId, apiVersion, query);
    return normalizeCampaignReport(rows, customerId, "live", filters.dateRange);
  }

  private async getCampaignReportRows(customerId: string, apiVersion: string, query: string): Promise<GoogleAdsReportRow[]> {
    const rows: GoogleAdsReportRow[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    do {
      const response = await this.searchCampaignPage(customerId, apiVersion, query, pageToken);
      await assertGoogleResponse(response, "Google Ads API");
      const page = await response.json() as GoogleAdsSearchResponse;
      rows.push(...(page.results ?? []));
      pageToken = page.nextPageToken;
      pageCount++;
      if (pageToken && pageCount >= 10) throw new ServiceUnavailableException("This report exceeds 100,000 rows. Narrow the date range or filters and try again.");
    } while (pageToken);
    return rows;
  }

  private async searchCampaignPage(customerId: string, apiVersion: string, query: string, pageToken?: string, loginCustomerId?: string): Promise<Response> {
    const url = `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:search`;
    // Google Ads REST Search uses a fixed 10,000-row page size; pageSize is not accepted in the request body.
    const body: { query: string; pageToken?: string } = { query };
    if (pageToken) body.pageToken = pageToken;
    const headers: Record<string, string> = { authorization: `Bearer ${await this.googleAuth.getAccessToken()}`, "content-type": "application/json" };
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (developerToken) headers["developer-token"] = developerToken;
    const effectiveLoginCustomerId = loginCustomerId ?? this.loginCustomerIds.get(customerId) ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    if (effectiveLoginCustomerId) headers["login-customer-id"] = effectiveLoginCustomerId;
    try {
      return await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ServiceUnavailableException("Google Ads campaign options are unavailable.");
    }
  }

  private async fetchAccessibleCustomers(version: string): Promise<Response> {
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${await this.googleAuth.getAccessToken()}` };
      const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
      if (developerToken) headers["developer-token"] = developerToken;
      return await fetch(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name.endsWith("Exception")) throw error;
      throw new ServiceUnavailableException("Google Ads API is unavailable.");
    }
  }
}
