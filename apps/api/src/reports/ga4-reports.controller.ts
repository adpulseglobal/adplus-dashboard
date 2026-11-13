import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { authenticatedRequest, CsrfGuard, PermissionsGuard, RequirePermissions, SessionGuard } from "../auth/auth.guard";
import { Ga4ReportsService } from "./ga4-reports.service";

@Controller("reports/ga4")
@UseGuards(SessionGuard, PermissionsGuard, CsrfGuard)
export class Ga4ReportsController {
  constructor(private readonly reports: Ga4ReportsService) {}

  @Post("acquisition")
  @RequirePermissions("ga4.view")
  acquisition(@Body() body: unknown, @Req() request: Request) {
    const user = authenticatedRequest(request);
    if (!user.isSuperAdmin && hasAdsFilters(body) && !user.permissions.includes("google_ads.view")) throw new ForbiddenException("Your role does not have permission to use Google Ads report filters.");
    return this.reports.getAcquisition(body);
  }
}

function hasAdsFilters(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const filters = body as Record<string, unknown>;
  const hasValues = (value: unknown) => Array.isArray(value) && value.length > 0;
  return Boolean(filters.googleAdsAccountId || hasValues(filters.campaignIds) || hasValues(filters.campaignTypes) || filters.ga4AdsScope);
}
