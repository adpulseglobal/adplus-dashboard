import { BadRequestException, Injectable } from "@nestjs/common";
import { validateDashboardFilters, type DashboardFilters } from "../../../../packages/contracts/src/dashboard-filters";
import { ConnectionsService } from "../connections/connections.service";
import { GoogleAdsProvider } from "../providers/google-ads.provider";

@Injectable()
export class GoogleAdsReportsService {
  constructor(private readonly connections: ConnectionsService, private readonly adsProvider: GoogleAdsProvider) {}

  async getCampaignPerformance(input: unknown) {
    const parsed = validateDashboardFilters(input);
    if (!parsed.success) throw new BadRequestException({ message: "Dashboard filters are invalid.", issues: parsed.issues });
    const filters = parsed.data;
    if (!filters.googleAdsAccountId) throw new BadRequestException("Choose a Google Ads account to request campaign reports.");

    await this.connections.validateSelection("google_ads", filters.googleAdsAccountId);
    await this.validateCampaignSelections(filters);
    const report = await this.adsProvider.getCampaignPerformance(filters.googleAdsAccountId, filters);
    return { ...report, warnings: [] as string[] };
  }

  private async validateCampaignSelections(filters: DashboardFilters): Promise<void> {
    if (!filters.campaignIds.length && !filters.campaignTypes.length) return;
    const options = await this.connections.listGoogleAdsFilterOptions(filters.googleAdsAccountId);
    const campaignIds = new Set(options.campaigns.map(({ id }) => id));
    const campaignTypes = new Set(options.campaignTypes);
    const invalidCampaignIds = filters.campaignIds.filter((id) => !campaignIds.has(id));
    const invalidCampaignTypes = filters.campaignTypes.filter((type) => !campaignTypes.has(type));
    if (invalidCampaignIds.length || invalidCampaignTypes.length) {
      throw new BadRequestException({ message: "Selected campaign filters are not available for this Google Ads account.", invalidCampaignIds, invalidCampaignTypes });
    }
  }
}
