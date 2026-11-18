# Milestone Tracking

Project: AdPulse Analytics Dashboard  
Plan: `AdPulse_Analytics_Dashboard_Project_Plan.md`

## Milestone 1 — Design system and dashboard shell

**Status:** Implemented; typecheck and production frontend build pass.

### Completed changes

- Added a strict TypeScript Next.js frontend foundation with Overview, Google Ads, and GA4 Analytics routes.
- Added responsive AdPulse styling tokens, typography, sidebar navigation, workspace header, and date/account/campaign filter controls.
- Added reusable KPI cards, trend chart, campaign table, traffic source panel, and demo-data notice.
- Used clearly labeled static fixture values. The filter controls are visual placeholders and do not yet alter report data.
- Shared one dashboard shell and component set across all three views; navigation reflects the active view.
- Added visible keyboard focus styling, semantic navigation/table markup, responsive navigation and a horizontally scrollable dense table.
- Added an SVG favicon after the browser sanity check exposed a missing `/favicon.ico` request.

### Acceptance review

- [x] Consistent AdPulse styling and responsive shell.
- [x] Overview, Google Ads, and GA4 Analytics navigation/routes.
- [x] Shared reporting components are reused across multiple routes.
- [x] Mock data is explicitly labeled; no live API calls are made.
- [x] Keyboard focus indicators and mobile-safe table behavior.
- [x] Typecheck passes with the currently available dependencies.
- [x] Production frontend build passes.

### Files

- `package.json`, `tsconfig.json`, `next-env.d.ts`, `.gitignore`: frontend foundation and scripts.
- `src/app/layout.tsx`, `src/app/globals.css`: shared document metadata and visual system.
- `src/app/page.tsx`, `src/app/google-ads/page.tsx`, `src/app/ga4/page.tsx`: dashboard routes.
- `src/components/dashboard-page.tsx`: shared shell, navigation, filters, fixture metrics and reporting components.

### Scope boundary and limitations

The workspace initially contained only the project plan and was not a Git checkout; Git was initialized afterward. Milestone 0's NestJS API, shared contracts package, CI, `.env.example`, and README were not part of the Milestone 1 work. The NestJS API foundation was added during Milestone 2, but shared contracts, CI, and the root README remain absent. The Milestone 1 frontend has no live Google integration. The filters, export, search, support, and settings controls are presentation-only placeholders. Chart and table values are demonstration fixtures.

### Verification

- `node --version`: passed (`v24.15.0`).
- `npm.cmd --version`: passed (`11.12.1`).
- `npm.cmd install`: initially blocked (`ENOTCACHED`); dependencies later became available in `node_modules`.
- `npm.cmd run typecheck`: passed during Milestone 3 verification.
- `npm.cmd run build`: passed after stopping the local server.
- Playwright MCP: Overview, Google Ads, and GA4 pages rendered; navigation worked; demo notice was visible; no page-level horizontal overflow at 390px; campaign table had horizontal scrolling; fresh Overview load had no browser console errors. Favicon now responds with HTTP 200.

## Later milestones

- Milestone 0: Partially complete. Foundation, API, shared contracts, mock mode, and `.env.example` exist; one-command full-stack start, root README, lint/format setup, and baseline CI remain.
- Milestone 2: OAuth and account/property discovery implemented and live-checked for My Home Closet. App-user sessions are delivered by Milestone 9; Google account access is still one shared deployment-level identity, and server-side selection persistence remains unimplemented.
- Milestone 3: Implemented; contract tests and live Ads-to-GA4 property linking verified. The comparison selector was removed at the user's direction.
- Milestone 4: Implemented; live Google Ads reports verified for My Home Closet.
- Milestone 5: Implemented and live GA4 report verified for My Home Closet; adapter tests need alignment with the current filter contract and execution.
- Milestone 6: Overview and Settings UI implemented. Comparisons are excluded per the removed control; latest responsive layout and partial-failure behavior still need browser/integration verification.
- Milestone 7: Not started.
- Milestone 8: Not started.
- Milestone 9: In progress. Production deployment, sign-in, mandatory first-login password reset, and live Ads/GA4 reports have been confirmed by the operator. Role and permission edge cases still need verification. A production OAuth connection flow is implemented: Super Admin authorization, one-time state validation, and AES-256-GCM encrypted refresh-token storage in PostgreSQL. TypeScript checking and the API build pass; frontend production build, deployment, Google Cloud callback registration, and production connection-flow verification remain pending.

## Milestone 2 — Google authentication and connection discovery

**Status:** OAuth and account/property discovery are implemented and live-checked for My Home Closet. The production OAuth connection is deployment-wide and shared by report-authorized app users; per-user Google connections and persisted server-side selections are not implemented.

### Completed changes

- Added a small NestJS API application and root scripts to run/build it alongside the existing Next.js frontend.
- Added server-side OAuth refresh-token handling with short-lived in-memory access-token caching, concurrent refresh deduplication, timeouts, and safe credential-free error messages.
- The initial loopback token-copy flow was superseded by the production Super Admin OAuth connection flow described under Milestone 9; refresh tokens are no longer displayed in the browser.
- Added Google Ads account discovery through `CustomerService.ListAccessibleCustomers`; normalized direct-access customer resource names into IDs.
- Added descriptive Google Ads account names and discovery of enabled advertiser accounts under accessible manager accounts. Reports and campaign-option requests for discovered child accounts use the manager as `login-customer-id`.
- Added GA4 property discovery through paginated Analytics Admin API `accountSummaries.list`.
- Initially added an optional dashboard API-key guard and loopback-only bind. Milestone 9 replaced the shared-key boundary with app-user sessions and report permissions; CORS and Helmet headers remain.
- Added selection endpoints that rediscover accessible resources and reject IDs not returned by Google. Selection is validated but not persisted.
- Added fixture-backed mock mode and `expired-auth` / `permission-denied` mock scenarios. API responses include `mode` so callers can distinguish mock from live.
- Added `.env.example` and API setup notes; credentials are read only by the API process.

### Acceptance review

- [x] Server-only credential configuration and authenticated provider requests.
- [x] Accessible account/property discovery endpoints and authorization-by-discovery selection validation.
- [x] Mock mode plus expired-auth / permission-denied fixtures.
- [x] Typecheck and API build pass.
- [x] Live Google Ads discovery, selection, campaign-option, and report smoke checks passed for My Home Closet (UAE); linked GA4 property selection and live report were verified.

### Architecture notes and limitations

Google Ads `ListAccessibleCustomers` returns directly accessible customers; manager hierarchies are expanded through `customer_client` queries for enabled advertiser descendants. GA4 discovery uses Admin API v1beta summaries with pagination. The Google authorization is one shared deployment-level identity stored encrypted in PostgreSQL after the production connection flow is deployed; it is not a per-user Google identity. The selection endpoint does not persist server-side user state; dashboard selections currently live in the URL.

### Verification

- `npm.cmd run build:api`: passed; emitted API entry at `apps/api/dist/apps/api/src/main.js`.
- Mock API discovery and selection checks: passed earlier; valid resource accepted and inaccessible resource returned 404.
- Live Google Ads discovery, selection, campaign-option, and report smoke checks passed for My Home Closet (UAE); linked GA4 property selection and report verification also passed.
- Live Google Ads smoke check (2026-11-06): discovered and selected My Home Closet (UAE), loaded 36 live campaign options, and received live reports for historical periods. Campaign ID and mobile-device filtering returned a live filtered report. Recent 30-day range returned no rows; this account has older serving data.
- Local mock API smoke check: Ads and GA4 discovery returned HTTP 200; a valid GA4 mock selection returned HTTP 201; an inaccessible property returned HTTP 404.

### References checked

- [Google Ads API authorization and HTTP headers](https://developers.google.com/google-ads/api/rest/auth)
- [Google Ads list accessible accounts](https://developers.google.com/google-ads/api/docs/account-management/listing-accounts)
- [GA4 accountSummaries.list](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list)
- [Google OAuth 2.0 web server flow and offline refresh](https://developers.google.com/identity/protocols/oauth2/web-server)

## Milestone 3 — Filters and report planning

**Status:** Implemented; contract tests pass and My Home Closet Ads-to-GA4 property linking is live-verified.

### Completed changes

- Added the shared `packages/contracts/src/dashboard-filters.ts` contract with all ten requested filters, runtime validation, date-span/future-date validation, canonical array ordering, stable source-specific report query keys, and equal-inclusive-period calculation.
- Added the filter support matrix and explicit warnings for cross-source filter intersections, GA4 Ads-attributed account scope, landing-page/campaign scope, and Ads-vs-GA4 campaign type semantics.
- Scoped GA4 property options to the selected Google Ads customer using GA4 Admin API Google Ads links. Changing the Ads customer clears the selected GA4 property and its dependent filters; accounts with no linked properties show an empty disabled property selector. The API rejects stale or mismatched account/property pairs.
- Added API-driven account/property selectors and dependent Ads campaign/type plus GA4 channel/source/landing-page option endpoints. Live Ads options query campaigns for the selected customer; GA4 options use three compatible dimensions in `batchRunReports`, capped to the top 1,000 values per dimension from the last 90 days.
- Added `POST /filters/validate` to verify resource access and selected dynamic values, normalize filters, calculate the previous equal period, return canonical report keys, source applicability metadata, and compatibility warnings.
- Replaced the Milestone 1 placeholder filter bar with working date, account, property, comparison, campaign, campaign type, device, GA4 channel, source/medium, and landing-page controls. Filter state is URL encoded, validated client/server side, and preserved between dashboard routes.
- Added `.playwright-mcp/` to `.gitignore` to exclude generated browser snapshots/logs.

### Acceptance review

- [x] All ten filters are represented with declared source scope.
- [x] Invalid account/property/campaign selections, invalid/future dates, unsupported enums, and conflicting intersections produce errors or visible warnings.
- [x] URL state survives dashboard navigation; Ads changes clear the selected property and reload linked GA4 options; property options refresh when the property changes.
- [x] Only GA4 properties linked to the selected Ads customer are listed; no-link accounts show no property options, and mismatched pairs are rejected by the API.
- [x] Contract tests cover source applicability and source-specific report query keys, equal-length previous-period windows, normalization, invalid ranges and URL round-tripping.
- [x] Live Ads-to-GA4 link discovery verified for My Home Closet (UAE); the matching property is returned, Pillowpacker is excluded, linked GA4 reporting is accepted, and the mismatched Ads/property pair is rejected.

### Verification

- `npm.cmd run typecheck`: passed.
- `npm.cmd run test:contracts`: passed (7 tests; filter normalization, validation, date windows, source mapping and URL state).
- `npm.cmd run build:api`: passed.
- API mock smoke check: options returned HTTP 200; filter planning returned HTTP 200 and the expected previous range (`2026-09-05`–`2026-09-30`) for `2026-10-01`–`2026-10-26`; an inaccessible Ads account returned HTTP 404.
- Playwright MCP: account/property options populated; selecting a campaign and channel updated repeated URL parameters; navigation to GA4 preserved filter values; the incompatible campaign plus Organic Search intersection produced an explicit warning; at 390px the page had no horizontal overflow.
- Nest dev watcher: a hot reload attempt failed with Windows `EPERM` while trying to stop a child process. The compiled API was started with `npm.cmd run start:api` and its mock filter routes then returned HTTP 200. Restart the dev watcher manually after source changes if it hits the same error.

### Additional test files and scripts

- `packages/contracts/test/dashboard-filters.test.cjs`: Node test-runner coverage against the TypeScript contract source; no additional test framework or runtime dependency.
- `package.json`: `test:contracts` command.

### Milestone 3 hand-off

The contract-planning slice is complete for mock development and Milestone 4 can proceed. Live Google account/property option discovery and provider field compatibility remain unverified because credentials are unavailable; confirm them during integration setup.

### Files

- `packages/contracts/src/dashboard-filters.ts`: shared filter types, runtime validation, canonicalization, comparison-period math, scope matrix, and warnings.
- `apps/api/src/connections/connections.controller.ts`, `connections.service.ts`, provider files: dependent filter option endpoints and source-specific campaign/property option discovery.
- `apps/api/src/filters/filters.controller.ts`, `filter-planning.service.ts`: validation, authorization-by-discovery, report planning metadata, and warnings.
- `apps/api/src/app.module.ts`, `apps/api/tsconfig.json`, `nest-cli.json`, `package.json`, `tsconfig.json`: API module wiring, shared source resolution, and scripts.
- `src/components/filter-bar.tsx`, `src/components/dashboard-page.tsx`, `src/app/globals.css`: URL-backed responsive filters and cross-route state preservation.
- `.gitignore`, `.env.example`, `apps/api/README.md`: local API URL, generated browser artifact ignore, and option/validation endpoint documentation.

### References checked

- [Google Ads API v26 campaign fields](https://developers.google.com/google-ads/api/fields/v26/campaign)
- [Google Ads API v26 campaign type enum](https://developers.google.com/google-ads/api/reference/rpc/v26/AdvertisingChannelTypeEnum.AdvertisingChannelType)
- [GA4 Data API dimensions and metrics schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)

## Milestone 4 — Google Ads reporting adapter

**Status:** Implemented and live-verified for My Home Closet.

### Completed changes

- Added an authenticated `POST /reports/google-ads/campaign-performance` route. It validates the shared filter contract, verifies the selected Ads account, and checks selected campaign IDs and types against that account before querying.
- Added GAQL construction for requested dates, campaign IDs/types, and device categories. Account IDs are validated as numeric and used only in the URL path; all query values come from validated dates and enums.
- Added paginated Google Ads search with a 10-page / 100,000-row ceiling and actionable feedback to narrow larger reports.
- Added normalization for account currency and spend micros; campaign, daily, device, and campaign-type groupings; and click/impression-weighted CTR and aggregate cost per conversion. Empty denominators produce zero CTR and null CPA.
- Added deterministic, labeled mock report data which honors campaign, date, and device filters.
- Connected the Google Ads screen to the report API with source-aware KPIs, daily trend, device and type breakdowns, campaign rows, and report-aware CSV export.
- Added honest empty, loading, error, sample/live, and source-selection states; inspected at desktop, tablet, and phone sizes.
- Added adapter tests covering GAQL predicates, arithmetic and rate derivation, zero denominators, and mock-filter reconciliation.
- Documented the endpoint, response shape, units, and mock/live behavior in `apps/api/README.md`.

### Acceptance review

- [x] Typed campaign report endpoint and source-specific filter application.
- [x] Spend conversion from micros, ratio calculations, and account-currency metadata.
- [x] Campaign, daily, device, and campaign-type aggregates reconcile from the same base rows.
- [x] Fixture tests cover query construction, normalization, zero denominators, and filter behavior.
- [x] Frontend Google Ads report screen consumes the new report route.
- [x] Live Google Ads smoke test and field/query compatibility verified for My Home Closet (UAE); recent 30-day period is empty, while historical report periods return data.

### Verification

- `npm.cmd run test:contracts`: passed (11 tests across the shared filter contract and Google Ads report adapter).
- `npm.cmd run build:api`: passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed.
- TasteSkill browser inspection: no failures at 1440px, 768px, or 390px; small-text and panel-whitespace warnings remain.
- Live Google Ads report check (2026-11-06): account `9883721648` returned live campaign options and live report data for 2025 and 2026; a single campaign plus mobile-device filter also returned a live report.

## Milestone 5 - GA4 reporting adapter

**Status:** Implemented; live My Home Closet property verification completed. Existing adapter test code needs alignment with the current filter contract and execution.

### Completed changes

- Added authenticated `POST /reports/ga4/acquisition`, validating shared filters and the accessible GA4 property before querying.
- Added Data API `batchRunReports` requests for daily sessions, default channel group, source/medium, landing page, and device.
- Used GA4 `TOTAL` metric aggregation for distinct users; daily user counts are never summed into a period total.
- Applied channel, source/medium, landing-page, device, and Google Ads-attributed account/campaign/type filters. Ads campaign selections require a selected, validated Ads account.
- Added five pages of 10,000 rows per dimension and a truncation response/message when a result exceeds 50,000 rows. Google Analytics 400 responses describe incompatible dimension, metric, or filter combinations.
- Added deterministic mock rows whose source breakdowns reconcile and respond to date and selection filters. The GA4 view now includes KPIs, daily trend, acquisition, landing pages, devices, CSV export, and visible sample/live status.
- The adapter does not request ecommerce-only metrics, so it works with properties without ecommerce configuration.

### Acceptance review

- [x] GA4 website KPIs, acquisition, landing pages, daily trend, and device breakdown are connected.
- [x] GA4 filters stay within GA4; Ads-attributed filters validate their Ads account and selections.
- [x] Pagination limit, truncation message, and incompatibility error are implemented.
- [x] Live My Home Closet GA4 property verification: 11-month request returned live data for 2025-12-07 to 2026-11-06, including 7,623 sessions, 6,117 users, and 15,327 key events.
- [ ] Align `apps/api/test/ga4-report.test.cjs` with current filter semantics, then run and complete adapter coverage.

### Verification

- `npm.cmd run typecheck`: passed.
- `npm.cmd run build:api`: passed.
- `npm.cmd run build`: passed.
- TasteSkill inspection: GA4 rendered at 1440px, 768px, and 390px with no failures; one small-text warning remains.

## Milestone 6 - Cross-source Overview integration

**Status:** Overview and Settings UI integration implemented; comparison work is excluded because the comparison control was removed at the user's direction. Latest responsive layout has not yet been browser-verified.

### Completed changes

- Connected Overview to the selected Google Ads account and linked GA4 property using their report endpoints and the active date and source filters.
- Kept Google Ads and GA4 metrics, dates, and source status visibly separate; no cross-source conversion total or unsupported campaign join is shown.
- Added independent loading, missing-selection, and error states so one provider can fail while the other source remains visible.
- CSV export controls and browser download handling were removed temporarily at the user's direction.
- Refined shared dashboard visuals to use individually framed KPI cards, consistent rounded report panels, an explicit filter disclosure control, and a red active-navigation marker while preserving the AdPulse palette.
- Moved Google Ads account and linked GA4 property selection into a Settings page; placed date controls and advanced report filters beside the report heading. Settings is positioned above the profile block in the sidebar, with full-width source selectors.
- GA4 detail view uses distinct visualizations for channels (donut), source/medium (ranked horizontal bars), landing pages (ranked table), and devices (vertical bars).

### Verification

- `npm.cmd run typecheck`: passed.
- Live report API was verified previously for My Home Closet GA4; this UI change was not browser-verified because the local services remain stopped.

## Milestone 9 - Authentication, roles and access control

**Status:** In progress. Core authentication/access-control APIs and the initial Settings/login UI are deployed and production sign-in, password reset, and live reports are confirmed. Role/permission edge-case verification remains. The production OAuth connection flow has been implemented locally but is not yet deployed or live-verified.

### Requested scope

- Cookie-based access/refresh token authentication using secure, HttpOnly cookies.
- 15-minute access-token lifetime; refresh tokens rotate on use but retain a 24-hour absolute lifetime from login. At expiry, on logout, and on reuse of an invalidated refresh token, revoke all sessions for that user and clear auth cookies in the requesting browser; require email/password login after expiry and reject other devices' revoked sessions server-side when next used. Use `SameSite=Lax`, a CSRF token on state-changing requests, and `Secure` in production with localhost development exception.
- Admin-created email/password accounts; users must reset their password on first sign-in.
- Permission-based API authorization, with roles and permissions managed from Settings.
- Admin-created users with exactly one assigned role; initial permissions are Google Ads view, GA4 view, user creation, role creation, user listing, role listing, and role assignment.
- As part of user creation, provide a one-time JSON download containing the login identifier and temporary password for the admin to share manually. Do not store or log plaintext passwords; require password reset at first login. If the download is lost, admin must reset/reissue the temporary password.
- An idempotent post-migration bootstrap creates the initial Super Admin on a fresh database using operator-provided `SUPER_ADMIN_INITIAL_PASSWORD`, stores only its hash, and requires password reset at first login. Missing variable on a fresh database is a clear bootstrap error; later starts never reapply or reset the credential.
- Super Admin is a protected system role and cannot be assigned from normal role management.
- Versioned PostgreSQL database migrations.

### Planning status

- All Milestone 9 scope and policy decisions are resolved.

### Implementation started

- Added PostgreSQL access-control schema and an idempotent migration runner; Super Admin bootstrap reads the operator-provided email/password once, hashes the password, and requires a first-login change.
- Added cookie-based app-user login, session validation, refresh-token rotation/replay revocation, CSRF checks, password reset, permission guards, audit events, and protected admin APIs.
- Added login/first-login password reset UI and Settings controls for roles, permissions, users, one-time credential JSON downloads, role assignment, and password reissue.
- Replaced the shared dashboard API-key guard with user authentication and Google Ads / GA4 permission enforcement; wired browser API requests to cookies and automatic refresh.
- Fixed localhost authentication redirects caused by a `localhost` frontend calling a loopback API as `127.0.0.1`; browser verification now shows login succeeds and `/auth/me` returns 200 on the required first-password-reset page.
- Added a Super Admin-only production Google OAuth connection flow from Settings. It validates CSRF on initiation, stores one-time OAuth state hashes in PostgreSQL, exchanges authorization codes server-side, encrypts the shared refresh token with AES-256-GCM, and never returns or logs the token.
- Added a token vault migration and a Reporting Sources status/reconnect control. The API prefers the encrypted database token and retains the environment token only as a transition fallback until production connects and removes it.
- Added `pg` as an API dependency and configured API/migration scripts to load `.env`. PostgreSQL migration and Super Admin bootstrap now run locally.

### Implementation checks

- `npm run typecheck`: passed.
- `npm run build:api`: passed.
- Design-taste frontend lint: passed with no banned patterns or warnings.
- No automated tests were run. Chrome DevTools reproduced the initial login redirect loop and verified the fix: login returns 200 and `/auth/me` returns 200 on the required first-password-reset screen. Dashboard verification remains pending the Super Admin's new password.
- The new production OAuth flow, migration, and Settings UI have passed TypeScript checking and the API build, and are pushed to `main`. The frontend production build and deployment remain pending; verify the Google Cloud production callback URI and remove the legacy refresh-token environment variable after the database connection is established.
