import { Injectable, NotFoundException } from "@nestjs/common";
import { ConnectionOption, Ga4Account, Ga4Property, GoogleAdsAccount } from "./connection.types";
import { CampaignFilterOptions, GoogleAdsProvider } from "../providers/google-ads.provider";
import { Ga4FilterOptions, Ga4Provider } from "../providers/ga4.provider";
import { GoogleTokenVault } from "../providers/google-token-vault.service";
import type { DashboardFilters } from "../../../../packages/contracts/src/dashboard-filters";

@Injectable()
export class ConnectionsService {
  constructor(private readonly adsProvider: GoogleAdsProvider, private readonly ga4Provider: Ga4Provider, private readonly tokenVault: GoogleTokenVault) {}

  getGoogleConnectionStatus() { return this.tokenVault.getStatus(); }

  listGoogleAdsAccounts(): Promise<GoogleAdsAccount[]> {
    return this.adsProvider.listAccessibleAccounts();
  }

  listGa4Properties(): Promise<Ga4Property[]> {
    return this.ga4Provider.listAccessibleProperties();
  }

  listGa4Accounts(): Promise<Ga4Account[]> {
    return this.ga4Provider.listAccessibleAccounts();
  }

  async listGa4PropertiesLinkedToGoogleAdsAccount(accountId: string): Promise<Ga4Property[]> {
    await this.validateSelection("google_ads", accountId);
    return this.ga4Provider.listPropertiesLinkedToAdsCustomer(accountId);
  }

  async isGa4PropertyLinkedToGoogleAdsAccount(accountId: string, propertyId: string): Promise<boolean> {
    const properties = await this.listGa4PropertiesLinkedToGoogleAdsAccount(accountId);
    return properties.some((property) => property.id === propertyId);
  }

  async listGoogleAdsFilterOptions(accountId: string, dateRange: DashboardFilters["dateRange"]): Promise<CampaignFilterOptions> {
    await this.validateSelection("google_ads", accountId);
    return this.adsProvider.listCampaignFilterOptions(accountId, dateRange);
  }

  async listGa4FilterOptions(propertyId: string): Promise<Ga4FilterOptions> {
    await this.validateSelection("ga4", propertyId);
    return this.ga4Provider.listFilterOptions(propertyId);
  }

  async listGa4CampaignOptions(filters: DashboardFilters): Promise<CampaignFilterOptions> {
    const { googleAdsAccountId, ga4PropertyId, dateRange } = filters;
    await this.validateSelection("ga4", ga4PropertyId);
    const adsOptions = await this.listGoogleAdsFilterOptions(googleAdsAccountId, dateRange);
    if (!adsOptions.campaigns.length) return adsOptions;
    const campaignIds = await this.ga4Provider.listCampaignIdsWithSessions(ga4PropertyId, googleAdsAccountId, dateRange);
    return { ...adsOptions, campaigns: adsOptions.campaigns.filter(({ id }) => campaignIds.has(id)) };
  }

  async validateSelection(source: "google_ads" | "ga4", resourceId: string): Promise<{ source: string; selectedId: string; authorized: true; mode: "live" | "mock" }> {
    const resources: ConnectionOption[] = source === "google_ads" ? await this.listGoogleAdsAccounts() : await this.listGa4Properties();
    const selected = resources.find((resource) => resource.id === resourceId);
    if (!selected) throw new NotFoundException(`The selected ${source === "ga4" ? "GA4 property" : "Google Ads account"} is not accessible with the configured Google credentials.`);
    return { source, selectedId: selected.id, authorized: true, mode: selected.mode };
  }
}
