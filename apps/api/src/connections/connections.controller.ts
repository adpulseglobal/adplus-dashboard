import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ConnectionsService } from "./connections.service";
import { authenticatedRequest, CsrfGuard, PermissionsGuard, RequirePermissions, SessionGuard } from "../auth/auth.guard";

interface SelectConnectionBody { id?: unknown }

@Controller("connections")
@UseGuards(SessionGuard)
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get("google-ads")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("google_ads.view")
  listGoogleAdsAccounts() {
    return this.connectionsService.listGoogleAdsAccounts();
  }

  @Get("google-ads/ga4-properties")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("google_ads.view", "ga4.view")
  listGa4PropertiesForGoogleAdsAccount(@Query("accountId") accountId?: string) {
    if (!accountId || !/^\d{1,32}$/.test(accountId)) throw new BadRequestException("A valid Google Ads account ID is required.");
    return this.connectionsService.listGa4PropertiesLinkedToGoogleAdsAccount(accountId);
  }

  @Get("ga4")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("ga4.view")
  listGa4Properties() {
    return this.connectionsService.listGa4Properties();
  }

  @Get("ga4/accounts")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("ga4.view")
  listGa4Accounts() {
    return this.connectionsService.listGa4Accounts();
  }

  @Get("google-ads/filter-options")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("google_ads.view")
  listAdsFilterOptions(@Query("accountId") accountId?: string) {
    if (!accountId || !/^\d{1,32}$/.test(accountId)) throw new BadRequestException("A valid Google Ads account ID is required.");
    return this.connectionsService.listGoogleAdsFilterOptions(accountId);
  }

  @Get("ga4/filter-options")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("ga4.view")
  listGa4FilterOptions(@Query("propertyId") propertyId?: string) {
    if (!propertyId || !/^\d{1,32}$/.test(propertyId)) throw new BadRequestException("A valid GA4 property ID is required.");
    return this.connectionsService.listGa4FilterOptions(propertyId);
  }

  @Post(":source/select")
  @UseGuards(CsrfGuard)
  selectConnection(@Param("source") source: string, @Body() body: SelectConnectionBody, @Req() request: Request) {
    if (source !== "google-ads" && source !== "ga4") throw new BadRequestException("Unsupported connection source.");
    const user = authenticatedRequest(request);
    if (user.mustResetPassword) throw new ForbiddenException("Change your temporary password before using the dashboard.");
    const requiredPermission = source === "ga4" ? "ga4.view" : "google_ads.view";
    if (!user.isSuperAdmin && !user.permissions.includes(requiredPermission)) throw new ForbiddenException("Your role cannot access this reporting source.");
    if (typeof body.id !== "string" || !/^\d{1,32}$/.test(body.id)) throw new BadRequestException("A valid numeric resource ID is required.");
    return this.connectionsService.validateSelection(source === "ga4" ? "ga4" : "google_ads", body.id);
  }
}
