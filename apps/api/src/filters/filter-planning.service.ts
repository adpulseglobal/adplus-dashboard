import { BadRequestException, Injectable } from "@nestjs/common";
import {
  buildReportQueryKey, calculatePreviousPeriod, getFilterWarnings, isFilterApplicable,
  validateDashboardFilters, type DashboardFilters, type ReportSource,
} from "../../../../packages/contracts/src/dashboard-filters";
import { ConnectionsService } from "../connections/connections.service";

@Injectable()
export class FilterPlanningService {
  constructor(private readonly connections: ConnectionsService) {}

  async validateAndPlan(input: unknown) {
    const parsed = validateDashboardFilters(input);
    if (!parsed.success) throw new BadRequestException({ message: "Dashboard filters are invalid.", issues: parsed.issues });
    const filters = parsed.data;
    await this.validateAdsFilters(filters);
    await this.validateGa4Filters(filters);
    return {
      filters,
      previousPeriod: filters.comparison === "previous_period" ? calculatePreviousPeriod(filters.dateRange) : null,
      queryKeys: { googleAds: buildReportQueryKey("google_ads", filters), ga4: buildReportQueryKey("ga4", filters) },
      support: { google_ads: sourceFilterSupport("google_ads", filters), ga4: sourceFilterSupport("ga4", filters) },
      warnings: getFilterWarnings(filters),
    };
  }

  private async validateAdsFilters(filters: DashboardFilters): Promise<void> {
    const hasCampaignFilters = filters.campaignIds.length > 0 || filters.campaignTypes.length > 0;
    if (!filters.googleAdsAccountId) {
      if (hasCampaignFilters) throw new BadRequestException("Choose a Google Ads account before selecting campaigns or campaign types.");
      return;
    }
    await this.connections.validateSelection("google_ads", filters.googleAdsAccountId);
    if (!hasCampaignFilters) return;
    const options = await this.connections.listGoogleAdsFilterOptions(filters.googleAdsAccountId);
    const campaignIds = new Set(options.campaigns.map((campaign) => campaign.id));
    const campaignTypes = new Set(options.campaignTypes);
    const invalidIds = filters.campaignIds.filter((id) => !campaignIds.has(id));
    const invalidTypes = filters.campaignTypes.filter((type) => !campaignTypes.has(type));
    if (invalidIds.length || invalidTypes.length) throw new BadRequestException({ message: "Selected campaign filters are not available for this Google Ads account.", invalidCampaignIds: invalidIds, invalidCampaignTypes: invalidTypes });
  }

  private async validateGa4Filters(filters: DashboardFilters): Promise<void> {
    const hasGa4DimensionFilters = filters.channelGroups.length > 0 || filters.sourceMediums.length > 0 || filters.landingPages.length > 0;
    if (!filters.ga4PropertyId) {
      if (hasGa4DimensionFilters) throw new BadRequestException("Choose a GA4 property before selecting channel, source/medium, or landing page filters.");
      return;
    }
    const property = (await this.connections.listGa4Properties()).find((item) => item.id === filters.ga4PropertyId);
    if (!property) throw new BadRequestException("The selected GA4 property is not accessible with the configured Google credentials.");
    if (filters.ga4AccountId && property.accountId !== filters.ga4AccountId) throw new BadRequestException("The selected GA4 property does not belong to the selected GA4 account.");
    if (filters.ga4AdsScope) await this.connections.validateSelection("google_ads", filters.googleAdsAccountId);
    if (!hasGa4DimensionFilters) return;
    const options = await this.connections.listGa4FilterOptions(filters.ga4PropertyId);
    const invalidChannels = filters.channelGroups.filter((value) => !options.channelGroups.includes(value));
    const invalidSourceMediums = filters.sourceMediums.filter((value) => !options.sourceMediums.includes(value));
    const invalidLandingPages = filters.landingPages.filter((value) => !options.landingPages.includes(value));
    if (invalidChannels.length || invalidSourceMediums.length || invalidLandingPages.length) throw new BadRequestException({
      message: "Selected GA4 filters are not available for this property in the current options window.",
      invalidChannels, invalidSourceMediums, invalidLandingPages, optionsMayBeTruncated: options.truncated,
    });
  }
}

function sourceFilterSupport(source: ReportSource, filters: DashboardFilters): Record<string, "applied" | "not_applicable" | "not_selected"> {
  const result: Record<string, "applied" | "not_applicable" | "not_selected"> = {};
  for (const key of Object.keys(filters) as Array<keyof DashboardFilters>) {
    const value = filters[key];
    const selected = Array.isArray(value) ? value.length > 0 : key === "dateRange" || key === "comparison" || value === true || (typeof value === "string" && value.length > 0);
    result[key] = !selected ? "not_selected" : isFilterApplicable(source, key) ? "applied" : "not_applicable";
  }
  return result;
}
