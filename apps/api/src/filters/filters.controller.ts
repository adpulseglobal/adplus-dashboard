import { Body, Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { authenticatedRequest, CsrfGuard, SessionGuard } from "../auth/auth.guard";
import { FilterPlanningService } from "./filter-planning.service";

@Controller("filters")
@UseGuards(SessionGuard, CsrfGuard)
export class FiltersController {
  constructor(private readonly filterPlanningService: FilterPlanningService) {}

  @Post("validate")
  @HttpCode(200)
  validateAndPlan(@Body() body: unknown, @Req() request: Request) {
    const user = authenticatedRequest(request);
    if (user.mustResetPassword) throw new ForbiddenException("Change your temporary password before using the dashboard.");
    if (!user.isSuperAdmin && body && typeof body === "object") {
      const filters = body as Record<string, unknown>;
      const hasValues = (value: unknown) => Array.isArray(value) && value.length > 0;
      if ((filters.googleAdsAccountId || hasValues(filters.campaignIds) || hasValues(filters.campaignTypes)) && !user.permissions.includes("google_ads.view")) throw new ForbiddenException("Your role cannot access Google Ads filters.");
      if ((filters.ga4PropertyId || hasValues(filters.channelGroups) || hasValues(filters.sourceMediums) || hasValues(filters.landingPages)) && !user.permissions.includes("ga4.view")) throw new ForbiddenException("Your role cannot access GA4 filters.");
    }
    return this.filterPlanningService.validateAndPlan(body);
  }
}
