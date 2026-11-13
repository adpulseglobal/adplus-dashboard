import { Module } from "@nestjs/common";
import { ConnectionsController } from "./connections/connections.controller";
import { ConnectionsService } from "./connections/connections.service";
import { GoogleAdsProvider } from "./providers/google-ads.provider";
import { GoogleAuthService } from "./providers/google-auth.service";
import { Ga4Provider } from "./providers/ga4.provider";
import { FiltersController } from "./filters/filters.controller";
import { FilterPlanningService } from "./filters/filter-planning.service";
import { GoogleAdsReportsController } from "./reports/google-ads-reports.controller";
import { GoogleAdsReportsService } from "./reports/google-ads-reports.service";
import { Ga4ReportsController } from "./reports/ga4-reports.controller";
import { Ga4ReportsService } from "./reports/ga4-reports.service";
import { GoogleOAuthController, LocalhostOnlyGuard } from "./auth/google-oauth.controller";
import { GoogleOAuthService } from "./auth/google-oauth.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { SessionGuard, PermissionsGuard, CsrfGuard } from "./auth/auth.guard";
import { DatabaseService } from "./database/database.service";
import { AdminController } from "./admin/admin.controller";
import { AdminService } from "./admin/admin.service";

@Module({
  controllers: [ConnectionsController, FiltersController, GoogleAdsReportsController, Ga4ReportsController, GoogleOAuthController, AuthController, AdminController],
  providers: [ConnectionsService, GoogleAuthService, GoogleAdsProvider, Ga4Provider, FilterPlanningService, GoogleAdsReportsService, Ga4ReportsService, GoogleOAuthService, LocalhostOnlyGuard, DatabaseService, AuthService, AdminService, SessionGuard, PermissionsGuard, CsrfGuard],
})
export class AppModule {}
