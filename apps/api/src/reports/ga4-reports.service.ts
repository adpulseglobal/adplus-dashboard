import { BadRequestException, Injectable } from "@nestjs/common";
import { validateDashboardFilters, type DashboardFilters } from "../../../../packages/contracts/src/dashboard-filters";
import { ConnectionsService } from "../connections/connections.service";
import { Ga4Provider } from "../providers/ga4.provider";

@Injectable()
export class Ga4ReportsService {
  constructor(private readonly connections: ConnectionsService, private readonly ga4Provider: Ga4Provider) {}

  async getAcquisition(input: unknown) {
    const parsed = validateDashboardFilters(input);
    if (!parsed.success) throw new BadRequestException({ message: "Dashboard filters are invalid.", issues: parsed.issues });
    const filters = parsed.data;
    if (!filters.ga4PropertyId) throw new BadRequestException("Choose a GA4 property to request acquisition reports.");
    const property = (await this.connections.listGa4Properties()).find((item) => item.id === filters.ga4PropertyId);
    if (!property) throw new BadRequestException("The selected GA4 property is not accessible with the configured Google credentials.");
    if (filters.ga4AccountId && property.accountId !== filters.ga4AccountId) throw new BadRequestException("The selected GA4 property does not belong to the selected GA4 account.");
    if (filters.ga4AdsScope) await this.connections.validateSelection("google_ads", filters.googleAdsAccountId);
    await this.validateSelections(filters);
    const report = await this.ga4Provider.getAcquisitionReport(filters.ga4PropertyId, filters);
    return { ...report, warnings: report.truncated ? ["Some GA4 breakdowns exceeded 50,000 rows and were capped. Narrow the date range or add a filter to see the full breakdown."] : [] as string[] };
  }

  private async validateSelections(filters: DashboardFilters) {
    if (filters.channelGroups.length || filters.sourceMediums.length || filters.landingPages.length) {
      const options = await this.connections.listGa4FilterOptions(filters.ga4PropertyId);
      const invalidChannelGroups = filters.channelGroups.filter((value) => !options.channelGroups.includes(value));
      const invalidSourceMediums = filters.sourceMediums.filter((value) => !options.sourceMediums.includes(value));
      const invalidLandingPages = filters.landingPages.filter((value) => !options.landingPages.includes(value));
      if (invalidChannelGroups.length || invalidSourceMediums.length || invalidLandingPages.length) {
        throw new BadRequestException({ message: "Selected GA4 filters are not available for this property.", invalidChannelGroups, invalidSourceMediums, invalidLandingPages });
      }
    }
    if (filters.googleAdsAccountId && (filters.campaignIds.length || filters.campaignTypes.length)) {
      await this.connections.validateSelection("google_ads", filters.googleAdsAccountId);
      const options = await this.connections.listGoogleAdsFilterOptions(filters.googleAdsAccountId, filters.dateRange);
      const invalidCampaignIds = filters.campaignIds.filter((id) => !options.campaigns.some((campaign) => campaign.id === id));
      const invalidCampaignTypes = filters.campaignTypes.filter((type) => !options.campaignTypes.includes(type));
      if (invalidCampaignIds.length || invalidCampaignTypes.length) throw new BadRequestException({ message: "Selected Google Ads filters are not available for this account.", invalidCampaignIds, invalidCampaignTypes });
    }
    if (!filters.googleAdsAccountId && (filters.campaignIds.length || filters.campaignTypes.length)) {
      throw new BadRequestException("Choose a Google Ads account to filter GA4 by attributed Google Ads campaigns.");
    }
  }
}
