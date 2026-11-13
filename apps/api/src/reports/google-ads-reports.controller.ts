import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CsrfGuard, PermissionsGuard, RequirePermissions, SessionGuard } from "../auth/auth.guard";
import { GoogleAdsReportsService } from "./google-ads-reports.service";

@Controller("reports/google-ads")
@UseGuards(SessionGuard, PermissionsGuard, CsrfGuard)
export class GoogleAdsReportsController {
  constructor(private readonly reports: GoogleAdsReportsService) {}

  @Post("campaign-performance")
  @RequirePermissions("google_ads.view")
  campaignPerformance(@Body() body: unknown) {
    return this.reports.getCampaignPerformance(body);
  }
}
