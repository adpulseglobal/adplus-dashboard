# AdPulse Analytics — Coding Agent Project Plan

**Version:** 1.0  
**Date:** 2026-10-26  
**Status:** Implementation specification for MVP  
**Product:** Internal performance-marketing analytics dashboard for Google Ads and Google Analytics 4, architected to support Meta Ads and persisted reporting later.

---

## 1. Agent operating instructions

Read this document fully before implementing. Work **one milestone at a time**, in the order given. At the beginning of each milestone, inspect the existing repository, state a concise implementation plan, and identify affected files. At the end, run the relevant checks, summarize changes and limitations, and assess milestone acceptance criteria. Do **not** mark a milestone complete when acceptance tests fail. Do not implement out-of-scope features merely because they are convenient.

**Non-negotiable engineering rule:** Optimize for maintainability and clear ownership. Avoid giant components, giant functions, generic `utils.ts` dumping grounds, unnecessary abstractions, premature microservices, and copying logic between API handlers. Extract reusable, well-named functions and modules with single responsibilities. Prefer a sequence of small, meaningful functions over hundreds or thousands of lines in a single function. Do not split code into trivial wrappers that obscure simple logic.

If real Google credentials are unavailable, provide mock adapters and fixture-driven tests so development is possible without inventing live data. Label mocks in the UI. Never hardcode secrets. If API capabilities, compatibility, or authentication requirements differ from expectations, consult the current official documentation and record the decision before changing scope.

## 2. Objectives and boundaries

### MVP goals

1. Connect to one or more accessible Google Ads accounts and GA4 properties via **backend-only** Google API requests.
2. Deliver three views: **Overview**, **Google Ads**, and **GA4 Analytics**.
3. Support these filters: date range, comparison with previous equal-length period, Google Ads account, GA4 property, campaign, campaign type, device, GA4 default channel group, GA4 source/medium, and GA4 landing page.
4. Provide decision-useful KPIs, trends, tables, and campaign/website diagnostics with explicit data-source labels.
5. Operate **without a reporting database** in the MVP. Retrieve source reports on demand. Support optional in-memory response caching behind an interface.
6. Design interfaces and provider adapters so Meta Ads, Redis, PostgreSQL, scheduled ingestion, and BigQuery can be added later without rewriting dashboard pages.

### Explicit non-goals for MVP

- No Meta Ads integration yet; provide only extensibility seams.
- No persistent historical reporting store, custom report builder, AI insights, attribution engine, automated alerts, client billing, or complex tenant management.
- No false unified "conversions" metric that sums Google Ads conversions and GA4 key events.
- No arbitrary cross-platform joins by campaign name or landing-page string.
- No guarantee of real-time metrics; reporting is subject to upstream processing delays.

## 3. Technical stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js (React) + TypeScript | Component ecosystem and scalable routing |
| Styling | Tailwind CSS + shadcn/ui | Accessible, reusable dashboard primitives |
| Charts | Apache ECharts | Analytical timeseries and breakdowns |
| Tables | TanStack Table | Sortable and pageable reporting tables |
| Client server-state | TanStack Query | Cache, refetch, cancellation and stale handling |
| Backend | Node.js + NestJS + TypeScript | Module boundaries, DI, validation, testing |
| Request/schema validation | Zod or NestJS DTO validators, selected consistently | Runtime validation and shared contracts |
| Google Ads | Official REST API using GAQL | Reporting queries from backend |
| GA4 | Google Analytics Data API (`runReport`, optionally `batchRunReports`) | Aggregated GA4 reporting |
| Cache | `ReportCache` abstraction, in-memory initially | Avoid duplicate upstream requests |
| Testing | Vitest or Jest consistently; Playwright for UI E2E | Unit, integration and workflow testing |
| Later | Redis, PostgreSQL, BigQuery | Caching, configuration, historical analytical storage |

Use a monorepo with package workspaces (pnpm preferred) and shared API contracts. If an existing repository has conventions, follow them unless they impede correctness.

## 4. Visual system: AdPulse Global

**Design direction:** restrained, high-density professional SaaS analytics UI. Default to light mode. Avoid decorative gradients and large shadows.

| Token | Value | Use |
|---|---|---|
| `brand` | `#E50021` | Primary button, active navigation, selective accents |
| `background` | `#F7F8FA` | Page canvas |
| `surface` | `#FFFFFF` | Cards, filter popovers, tables |
| `foreground` | `#17191D` | Headlines, primary KPI text |
| `muted-foreground` | `#667085` | Secondary copy |
| `border` | `#E5E7EB` | Subtle separators |
| `positive` | `#16A34A` | Favourable KPI movement only |
| `warning` | `#D97706` | Warning / incomplete data |
| `series-blue` | `#2563EB` | Conversions series |
| `series-teal` | `#0D9488` | Revenue series |
| `series-purple` | `#7C3AED` | Organic traffic series |
| `series-gray` | `#94A3B8` | Previous-period reference |

**Typography:** Inter; tabular numerals for all financial and numerical rows; page headers ~24–28px, section headings ~16–18px, tables ~13–14px; 8px spacing scale; 10–12px card radius. Use whitespace and thin borders before shadows. Set chart palettes explicitly and consistently; do not rely on default rotating colors. Spend may use AdPulse red, but not every chart should be red. Improvements/worsening depend on metric direction (e.g., lower CPA is favourable).

**Accessibility:** keyboard operability, visible focus indicators, readable contrast, descriptive chart/table alternatives, loading/empty/error states, and text indicators not color alone. Responsive: desktop-first with mobile horizontal scrolling for dense tables.

## 5. Architecture and ownership

```
apps/
  web/                      # Next.js user interface
  api/                      # NestJS backend
packages/
  contracts/                # shared DTOs, report/filter contracts, enums
  config/                   # shared lint/TS configs if useful
```

Suggested backend organization (adjust naming to existing project patterns):

```
apps/api/src/
  auth/                     # secure user/session and scoped account authorization
  connections/              # accessible account/property listings
  reports/
    controllers/            # route handlers only; no upstream query construction here
    services/               # application orchestration
    planners/               # report-specific source/filter planning
    models/                 # normalized metrics and metadata
  providers/
    google-ads/             # auth/client, GAQL builder, adapter, mapper
    ga4/                    # auth/client, Data API builder, adapter, mapper
  filters/                  # validation, canonicalization, compatibility
  comparison/               # period math and derived metric calculators
  cache/                    # ReportCache interface, in-memory implementation
  common/                   # only truly cross-cutting primitives
```

Suggested frontend organization:

```
apps/web/src/
  app/                      # overview, google-ads, ga4 routes
  features/
    filters/                # filter bar, option selectors, URL state
    overview/               # KPI panels and summary trends
    google-ads/             # campaign table and breakdowns
    ga4/                    # acquisition, landing page and engagement
  components/
    ui/                     # reusable primitives (shadcn/ui)
    charts/                 # reusable chart wrappers and formatting
    reporting/              # KPI card, period badge, empty/loading states
  lib/
    api/                    # typed backend client
    formatting/             # money, rates, dates, percentages
```

**Request lifecycle:** UI state → typed reporting DTO → backend auth + validation → report planner → report-specific provider adapters → backend normalized metrics → optional cache → typed response + metadata → UI render. The frontend must not call Google APIs directly.

**Architecture constraints:** NestJS controllers are thin. Source-specific GAQL and GA4 filter construction stays inside providers or query builders. Comparison math and metric formulas stay in dedicated pure functions. The user interface consumes a stable application contract, never raw Google API response shapes.

## 6. Report filters: contracts and semantics

Use one shared request contract, but create **per-report applicable filter subsets**. Never silently discard a filter; return applied/not-applicable/unsupported metadata.

```ts
type DashboardFilters = {
  dateRange: { startDate: string; endDate: string }; // YYYY-MM-DD
  comparison: 'none' | 'previous_period';
  googleAdsAccountId: string;
  ga4PropertyId: string;
  campaignIds?: string[];
  campaignTypes?: string[];
  devices?: Array<'desktop' | 'mobile' | 'tablet'>;
  channelGroups?: string[];
  sourceMediums?: string[];
  landingPages?: string[];
};
```

**Filter support matrix:**

| Filter | Google Ads | GA4 | Important rule |
|---|---|---|---|
| Date range | `segments.date` | `dateRanges` | Date values in reporting/property timezone; document boundary differences |
| Compare previous period | Separate or bounded daily query | Two `dateRanges`, where compatible | Previous period equal number of inclusive days |
| Google Ads account | Customer ID in request | Optional `sessionGoogleAdsCustomerId` filter | Selecting an Ads account does not necessarily restrict all GA4 traffic |
| GA4 property | N/A | Property resource | Account/property mapping must be explicit |
| Campaign | `campaign.id` | `sessionGoogleAdsCampaignId` for Ads-attributed sessions | IDs rather than names; scope by Ads customer ID |
| Campaign type | `campaign.advertising_channel_type` | Check availability/compatibility of `sessionGoogleAdsCampaignType` in current schema | Distinct taxonomies; do not assume all values map |
| Device | `segments.device` | `deviceCategory` | Normalize enums and metric semantics |
| Default channel group | N/A | `sessionDefaultChannelGroup` | GA4-only filter |
| Source / medium | N/A | `sessionSourceMedium` | GA4-only filter |
| Landing page | Separate Ads landing-page resource (out of initial combined filtering scope) | `landingPage` | GA4 landing page path; no automatic Ads spend attribution |

**Compatibility behavior:** If the user selects an Ads campaign plus `Organic Search`, GA4's attribution-filtered report can be empty or logically conflicting. Explain the intersection and show an empty-state reason; never manufacture values. Show visible source filter scopes, e.g., “GA4: Ads-attributed sessions matching campaign”. Allow filters to be disabled where unrelated, but preserve user selections on navigation if possible.

**Dependent filter options:** When Ads account changes, refresh campaign IDs/types and invalidate relevant reports. When GA4 property changes, refresh GA4 channel/source/landing-page options. Never use campaign names as primary keys. Prefer filter options sourced from the same account/property the user is actively reporting on. Use a bounded date context for options where relevant.

## 7. Required report templates and metrics

### 7.1 Overview

**Google Ads source:** spend, impressions, clicks, CTR, average CPC, conversions, cost/conversion, conversion value, Ads ROAS.  
**GA4 source:** sessions, active users, engaged sessions, engagement rate, key events; optionally ecommerce revenue when valid for property.  
Show 4–6 priority KPI cards and period-over-period deltas, with additional metrics in grouped sections. Show data source label and applied filter scope on each card.

### 7.2 Google Ads

Campaign table: account, campaign ID/name, status, type, spend, impressions, clicks, CTR, CPC, conversions, CPA, conversion value and ROAS. Sort, paginate, and drill down by selected campaign. Trends: daily spend and conversions. Breakdowns: device and campaign type. First MVP can omit search terms and auction insights.

**Query templates** (separate, tested, report-specific):
- Account/campaign KPI aggregates (avoid excessive segments).
- Campaign table grouped by campaign.
- Daily trend grouped by date, constrained by active campaign/type/device filters.
- Device breakdown by device.
- Campaign type breakdown.

`metrics.cost_micros` must be converted to currency units exactly once in normalization. Be explicit about account currency, conversions settings and attribution.

### 7.3 GA4 Analytics

Acquisition: session default channel group and source/medium; sessions, engaged sessions, engagement rate, key events. Landing pages: `landingPage` with sessions, engagement and key events. Device categories; daily traffic trend. Optional purchase revenue for ecommerce-enabled properties. Do not mix event-scoped and session-scoped fields without checking compatibility.

**GA4 query templates:** overview totals, acquisition, landing pages, daily trend, devices. Prefer `batchRunReports` for up to five independent reports of the same property when beneficial; it is **not** an escape from GA4 quotas or dimension/metric compatibility rules. Verify each report template against the current Data API schema, using `checkCompatibility` as appropriate.

### 7.4 Cross-source campaign diagnostics

Optionally show campaign Ads clicks/spend adjacent to GA4 campaign-attributed sessions/engagement, joined only where the Google Ads customer ID, campaign ID and date/reporting conditions are meaningful. Do not imply Ads clicks equal sessions. Avoid a blended conversion or revenue total in MVP. If a dimension cannot be reliably joined, display separate source panels.

### 7.5 Metric formulas and edge cases

- CTR = clicks / impressions; average CPC = spend / clicks; CPA = spend / conversions; Ads ROAS = conversion value / spend.
- Recompute ratios from aggregate numerators and denominators, never by averaging per-campaign rates.
- Comparison delta = `(current - previous) / previous * 100`. If previous is zero, show N/A and preserve raw values.
- Preserve missing vs zero distinction. Indicate currency and any incompatible cross-account totals.
- For equal-length previous period, use inclusive dates and the immediately preceding calendar days. Example Oct 1–25, 2026 compares to Sep 6–30, 2026.
- Treat upstream data as subject to later processing and attribution changes; show `generatedAt`, any caching age and warnings.

## 8. Public backend API contract

Recommended endpoints:

| Method/path | Responsibility |
|---|---|
| `GET /api/connections` | List authorized Google Ads accounts and GA4 properties |
| `GET /api/filters/options` | Return report-relevant options scoped to selections |
| `POST /api/reports/overview` | KPIs + equal-period comparisons |
| `POST /api/reports/trends` | Daily timeseries |
| `POST /api/reports/campaigns` | Paginated/sortable Ads table |
| `POST /api/reports/acquisition` | GA4 channel and source/medium report |
| `POST /api/reports/landing-pages` | GA4 landing-page table |
| `POST /api/reports/devices` | Device breakdown |

Use typed request/response DTOs, validation, explicit rate/limit protections and bounded pagination. Deny requests to account/property IDs not authorized for the session. A response includes `source`, `period`, `comparisonPeriod`, `appliedFilters`, `notApplicableFilters`, `warnings`, `generatedAt`, and data payload. For partially unavailable sources, return transparent partial data/warnings where appropriate, not apparently complete empty results. Create consistent error codes (invalid filter, unauthorized account, API quota, Google auth expired, unsupported combination, upstream failure).

## 9. Query efficiency and caching

- Ask only for the selected report's dimensions/metrics; do not fetch all platform data and filter client-side.
- Combine related metrics in one source query when dimension compatibility permits.
- Keep separate aggregate, daily, campaign, device and landing-page report templates to prevent combinatorial row explosion.
- Fetch independent Google Ads and GA4 reports concurrently with **bounded concurrency**, request timeouts and sensible retries/backoff (especially 429/5xx). Avoid retrying invalid queries or auth failures.
- Debounce filter searches and cancel superseded browser queries; TanStack Query keys should include canonical filter state.
- Use stable, canonical cache keys: authenticated connection/tenant, source account/property, report template version, dates, normalized sorted filters, page/sort parameters.
- Define `ReportCache` interface. In-memory TTLs initially: recent reports 5–15 min, filter options 15–30 min, historical reports 1–6 hr, subject to observed performance.
- In-memory cache is process-local and lost on restart; never imply it is a durable datastore or shared across replicas.
- Display a "last fetched" indicator and provide refresh behavior; a cache hit must not reset the true source-fetch timestamp.
- Avoid storing OAuth refresh tokens in logs or client-side local storage. Even a DB-free reporting MVP still needs secure credential/token storage if OAuth user connections are implemented.

## 10. Security, operations and correctness

- Google API calls and secrets remain server-side. Use environment-based secret management; include `.env.example` with placeholder names but no real values.
- For internal single-owner usage, choose the simplest compliant authentication mechanism supported by each API; verify account/property permissions. For future customer connections, plan OAuth with consent, minimum scopes and encrypted refresh-token persistence.
- Implement backend session access control, allowlisted resource IDs, input validation, maximum date span, rate limiting, CORS protection and security headers.
- Do not allow arbitrary GAQL strings, API paths, account identifiers, dimension names or unlimited query complexity from frontend input.
- Use structured request logs with correlation IDs, latency, provider, resource category and error code; redact tokens and personally identifying data.
- API requests should be observable: cache hit/miss, upstream latency, quota/rate errors, cancellation and partial-result state.
- Account for selected reporting timezones and currency. Do not sum currencies into an unlabeled total.
- Verify up-to-date Google Ads API authorization/access process and supported API version before implementing Google Ads. Check current official docs instead of assuming older developer-token flows or field names.

## 11. Mandatory code quality standard

These conventions are an **acceptance requirement**, not optional polish.

1. **Descriptive names:** `getCampaignPerformance`, `buildGoogleAdsCampaignQuery`, `normalizeGa4Sessions`, `calculatePreviousPeriod`, `isCampaignFilterApplicable`; avoid `data`, `obj`, `handler2`, `processAll`, `temp` unless tightly scoped and self-evident.
2. **Single responsibility:** one function handles one conceptual task. Keep controllers thin; move query building, normalization and formatting to dedicated pure functions/services.
3. **Readable function size:** target roughly 10–40 lines for ordinary functions where natural. Review functions over ~60 lines for extraction. These are heuristics, not rigid limits. Never build multi-hundred-line controller functions or multi-thousand-line UI components.
4. **Readable file size:** aim for cohesive files; review files >~250–350 lines for separation by concern. Avoid fragmenting into dozens of files with meaningless wrappers.
5. **Avoid excessive nesting:** use guard clauses and early returns; prefer named predicates (`hasSupportedDeviceFilter`) over deeply nested conditional expressions.
6. **Pure reusable calculations:** dates, ratio handling, comparison deltas, sorting/canonicalizing filters, currency formatting and metric normalization belong in tested utility modules with clear interfaces.
7. **Explicit contracts:** strict TypeScript, typed DTOs, discriminated unions where appropriate; avoid `any`, unchecked casts and undocumented magic strings. Validate external API payloads where warranted.
8. **Do not repeat yourself:** abstract repeated business rules after identifying actual repeated use; avoid generic abstraction layers for one-off code.
9. **Separate concerns:** UI components render and manage local UI state; hooks/query clients fetch; backend services orchestrate; provider adapters call upstream APIs; formatters handle display; tests verify behavior.
10. **No hidden side effects:** functions named `get` should not mutate shared state. Explicitly name side effects (`save`, `refresh`, `invalidate`, `fetch`).
11. **Comments explain why:** document non-obvious attribution, compatibility, timezone and API limitations; avoid comments narrating basic syntax.
12. **Consistency:** ESLint + Prettier + strict tsconfig; consistent imports; remove dead code, unused variables, commented-out blocks and console debugging before completion.
13. **Error handling:** handle expected failures near their boundary, with actionable errors. Don't silently swallow upstream errors or return zeros to mask failures.
14. **UI components:** create reusable `MetricCard`, `PeriodComparison`, `FilterBar`, `ReportTable`, `ReportChart`, `ReportStatus` without stuffing all screen logic into one page component.
15. **Tests accompany meaningful logic:** unit-test calculations, filter mapping, builders, normalization and conflict states; integration-test adapters with mocked upstream responses.

**Before merging any milestone, perform a maintainability review:** Are names meaningful? Are there duplicate formulas? Can a long function be split by purpose? Are responsibilities clear? Is the result simpler than the code it replaces?

## 12. Milestone execution plan

### Milestone 0 — Repository scaffolding and standards

**Deliverables**
- Next.js frontend, NestJS backend, shared contract package, workspace scripts.
- Strict TypeScript, lint, format, tests, baseline CI and `.env.example`.
- README with local run commands, env requirements and architecture overview.
- Provider client interfaces and mock fixture mode (no invented claim of live connection).

**Acceptance criteria**
- One command starts frontend and backend locally.
- Typecheck, lint and baseline tests pass in CI.
- No secrets committed, no huge starter files, consistent naming and folder responsibility.

### Milestone 1 — Design system and dashboard shell

**Deliverables**
- AdPulse colour tokens and typography; responsive application shell.
- Navigation: Overview, Google Ads, GA4 Analytics.
- Shared KPI cards, chart wrappers, report tables, error/empty/loading states.
- Mock data clearly labeled; date/account filter bar with placeholder option data.

**Acceptance criteria**
- Consistent styling, keyboard accessible controls and mobile-safe tables.
- Shared components demonstrate reuse across two or more pages without duplicated layout logic.
- No live API required to view the shell.

### Milestone 2 — Google authentication and connection discovery

**Deliverables**
- Secure server-side credential configuration and authenticated API client wrappers.
- Google Ads accessible customer listing and GA4 accessible property listing (using appropriate APIs/permissions).
- Connection selector endpoints with authorization checks and helpful missing-permission errors.
- Local mock mode and test fixtures for permission / expired-auth cases.

**Acceptance criteria**
- Authorized account/property can be selected, unauthorized ones rejected.
- No API token or refresh token exposed in frontend or logs.
- Selection invalidates dependent report/filter queries.

### Milestone 3 — Filters and report planning

**Deliverables**
- Shared filter DTO, runtime validation, URL state for shareable dashboard views (without secrets).
- Dynamic campaign IDs/types from Ads account; GA4 channel/source/landing-page options from property.
- Filter support/compatibility matrix, applied/not-applicable warnings.
- Pure helper for current/previous period and canonical query keys.

**Acceptance criteria**
- All ten requested filters represented with correct scope.
- Invalid account, dates, unsupported enums and logically conflicting filters are handled clearly.
- Unit tests cover filter mapping, equal-length date windows and normalization.

### Milestone 4 — Google Ads reporting adapter

**Deliverables**
- Typed Google Ads client wrapper, GAQL builders, query templates and normalizers.
- Campaign table, KPIs, daily trend, device/type breakdown.
- Spend conversion from micros, ratio calculations, account currency labeling.
- Proper upstream error mapping, pagination/streaming as appropriate.

**Acceptance criteria**
- All supported Ads filters alter source queries correctly.
- Aggregated rates computed from base totals, not averaged ratios.
- Campaign and day totals reconcile within rounding/segmentation expectations.
- Adapter and builder tests pass with fixtures; real smoke test when credentials available.

### Milestone 5 — GA4 reporting adapter

**Deliverables**
- Typed GA4 Data API client wrapper, report builders, mappers.
- Website KPIs, acquisition, landing pages, daily trend, device breakdown.
- Optional `batchRunReports` optimization for compatible same-property reports.
- Session-scoped Google Ads campaign/ID filter where supported and clearly labeled.

**Acceptance criteria**
- GA4-only filters affect relevant reports and do not mutate Ads metrics.
- Incompatible dimensions/metrics generate explicit errors/warnings.
- Pagination/cardinality and missing/non-ecommerce-property fields are handled.
- Adapter tests and permission-failure behavior pass.

### Milestone 6 — Overview integration and comparisons

**Deliverables**
- Combined page with separately labeled Ads and GA4 sections.
- Prior equal-length period comparisons, normalized KPI deltas, chart overlays.
- Source status and filter-scope annotations, partial-data/error states.
- Optional side-by-side campaign-level Ads and GA4 session diagnostics when safe.

**Acceptance criteria**
- No misleading unified conversion total or unsupported campaign join.
- Previous-zero values display N/A for delta rather than infinity.
- Filtered cards and trends use the same effective source filters.
- Integration tests verify partial failures and comparison calculations.

### Milestone 7 — Performance, caching and operational hardening

**Deliverables**
- `ReportCache` in-memory adapter, stable cache keys and TTL policy.
- TanStack Query request deduplication, cancellation, stale-response handling.
- Bounded provider concurrency, retry/backoff, request timeouts and rate limiting.
- Structured logging, no-secret redaction, refresh timestamps, loading/empty/error UX.

**Acceptance criteria**
- Identical report filters produce a cache hit; altered filters are cache misses.
- No duplicate concurrent upstream request where deduplication is applicable.
- Quota failures produce honest messages; no false zeros.
- Smoke test with long date range, rapid filter toggles and concurrent widgets.

### Milestone 8 — Quality assurance, docs and release

**Deliverables**
- Unit, API integration and end-to-end tests for the major user journeys.
- API contracts / OpenAPI, setup/runbook, deploy notes and security review checklist.
- Production build/CI passing, sample demo using labeled fixtures.
- Known limitations and technical-debt document; future iteration backlog.

**Acceptance criteria**
- User can select account/property/date; apply required contextual filters; view Overview, Ads and GA4; compare with previous period; handle errors and refresh.
- All lint/typecheck/test/build checks pass.
- No committed secrets or unexplained `any`, repeated query builders, massive functions or data-source ambiguity.
- A new developer can understand module boundaries and run the project from the README.

### Milestone 9 — Authentication, roles and access control

**Status:** Implementation in progress. The scope and policy decisions are complete. PostgreSQL, admin-created email/password accounts, mandatory password reset at first sign-in, one role per user, non-assignable Super Admin, bootstrap credentials, cookie settings, and session policies are specified. This milestone must be completed before enabling multi-user or production access.

**Deliverables**
- Add a PostgreSQL database and versioned migration setup, consistent with the future-ready extension below.
- Create the initial Super Admin through an idempotent bootstrap step after migrations. On a fresh database, require the operator-provided `SUPER_ADMIN_INITIAL_PASSWORD`, hash it, and set the required password-reset flag. If the Super Admin already exists, do not read or apply the bootstrap password again. Fail bootstrap clearly if the initial password is missing for a fresh database.
- Treat Super Admin as a protected system role that cannot be created or assigned through normal user/role management.
- Add app-user authentication with 15-minute access tokens and refresh tokens with a 24-hour absolute lifetime from login, in `HttpOnly` cookies. Rotate refresh tokens on use without extending the original 24-hour expiry. Reuse of an invalidated refresh token revokes all active sessions for that user. At expiry, revoke all active sessions for that user, clear auth cookies in the requesting browser, and require email/password login. Logout revokes all active sessions for that user and clears auth cookies in the current browser. Use `SameSite=Lax`, require a CSRF token for state-changing requests, and set `Secure` in production; allow the localhost development exception.
- Use admin-created email/password accounts and require the user to set a new password before completing their first sign-in.
- When an admin creates a user, provide a **Download credentials** action that downloads a JSON file containing that user's login identifier and temporary password for manual sharing. Download it once as part of user creation; if it is lost, the admin must reset/reissue the temporary password because the original plaintext is not stored. Never persist or log plaintext passwords, and force a password change at first sign-in.
- Add permission-based authorization enforced by the API for report access and Settings administration; frontend hiding is supplementary and never the security boundary.
- Add Settings screens and API operations for creating roles, assigning permissions to roles, creating users, and assigning exactly one role to each user.
- Seed the initial permissions requested: `google_ads.view`, `ga4.view`, `users.create`, and `roles.create`, plus the approved management permissions `users.view`, `roles.view`, and `users.assign_role`.
- Add audit-safe handling for user/role changes and prevent unsafe bootstrap or privilege-escalation paths.

**Acceptance criteria**
- Database migrations/bootstrap create a usable Super Admin once on a clean install and never reset or duplicate it on subsequent runs.
- Super Admin cannot be assigned, recreated, or removed through standard role/user administration endpoints or the Settings UI.
- The initial Super Admin password is stored only as a password hash and must be changed before normal report access.
- Access and refresh cookies use the approved production attributes; refresh tokens rotate/revoke correctly, and logout invalidates the session.
- Anonymous users cannot access protected APIs. Users without `google_ads.view` or `ga4.view` cannot read those report endpoints, even by calling the API directly.
- Each user has exactly one role; that role's permissions determine the user's authorization.
- Role and user creation require their corresponding permissions; role assignment cannot grant permissions the acting user does not hold.
- Permission changes and role changes take effect within the approved session policy; tests cover authorized, unauthorized, expired, revoked, and bootstrap cases.
- Settings UI clearly separates account/property configuration from user and role administration.

**Confirmed bootstrap password policy**
- Use `SUPER_ADMIN_INITIAL_PASSWORD` in every deployment, with a different strong random value supplied by the operator per deployment. Use it only when creating the Super Admin on first bootstrap, store only its password hash, require a change at first sign-in, and never reapply or reset the credential on later application starts. If a fresh database has no Super Admin and this variable is unset, fail bootstrap with a clear configuration error.

**Confirmed cookie and token policy**
- Access-token lifetime: 15 minutes. Refresh-token absolute lifetime: 24 hours from login; rotation does not extend it, and expiry requires email/password login again.
- Set auth cookies `HttpOnly`; use `SameSite=Lax`; require a CSRF token for state-changing requests; set `Secure` in production and allow a localhost development exception.
- Refresh-token expiry revokes all active sessions for the affected user and clears auth cookies in the browser making the expired request; sessions on other devices are rejected server-side when next used.
- Logout revokes all active sessions for the user and clears auth cookies in the browser making the logout request; other devices' revoked sessions are rejected server-side when next used.
- Reuse of a rotated/invalidated refresh token revokes all active sessions for that user; all revoked sessions are rejected server-side.
- Newly created user credentials are downloaded once in JSON during account creation. If lost, an admin resets/reissues a temporary password; plaintext credentials are never recoverable from the database.

**Planning status**
- All Milestone 9 scope and policy decisions are resolved; ready for implementation.

## 13. Testing matrix (minimum)

| Test area | Scenarios |
|---|---|
| Periods | Leap day, month/year boundary, one-day range, invalid dates, same-length previous window |
| Filter combinations | Campaign + device; Ads campaign + GA4 channel; no matches; multiple selections; account/property change |
| Authorization | Unauthorized resource, expired credentials, permissions revoked |
| Ads mapping | Micros conversion, empty campaign, zero-click CPC, zero-spend ROAS, currency label |
| GA4 mapping | Missing ecommerce revenue, incompatible fields, high-cardinality limit, source/medium filtering |
| Comparisons | Positive/negative movement, previous zero, missing metrics, percent vs percentage-point semantics |
| Upstream resilience | 429, 5xx, timeout, partial platform failure, stale cache |
| UI | Filter state, a11y, table sorting, long names, mobile overflow, loading/empty/error |
| Cache | Same filter key, ordered vs unordered selected arrays, isolation by account/user, TTL |

## 14. Milestone hand-off template for coding agent

At the end of each milestone, return:

1. **Implemented:** concise description of features.
2. **Changed files:** list paths and each file's responsibility.
3. **Architecture notes:** relevant decisions and tradeoffs.
4. **Verification:** exact commands run and pass/fail results.
5. **Acceptance checklist:** pass/fail for every milestone criterion.
6. **Known issues:** limitations and blockers; mark mock vs live behavior honestly.
7. **Next milestone:** recommended next scoped work only.

If checks fail, fix the issue in the same milestone wherever possible; do not quietly advance. Keep commits small and focused.

## 15. Future-ready extensions (do not implement in MVP)

**Meta Ads:** add a `MetaAdsProvider` implementing a standard reporting interface, normalize account/campaign identifiers, currencies, attribution windows and event definitions. Do not assume Meta conversions are equivalent to Google Ads conversions.

**Database:** PostgreSQL for users, workspaces, selected connections, OAuth credentials (encrypted at rest), dashboards and saved filters. It can also store moderate normalized history if justified.

**Analytical pipeline:** scheduled ingestion jobs, incremental windows, backfills, raw provider payload storage as needed, fact tables keyed by source + account + entity + date + breakdown and idempotent upserts. BigQuery becomes useful when report history/cross-client scale justify it.

**Multi-client operations:** robust tenant isolation, per-user roles, connected-account permissions, per-tenant caches, currency normalization policy, audit logging and cost controls.

## 16. References to verify before coding integrations

- Google Ads API: https://developers.google.com/google-ads/api/docs/start
- Google Ads Query Language: https://developers.google.com/google-ads/api/docs/query/overview
- Google Ads API fields: https://developers.google.com/google-ads/api/fields/overview
- GA4 Data API: https://developers.google.com/analytics/devguides/reporting/data/v1
- GA4 API schema: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- GA4 quota: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- GA4 dimensions/metrics compatibility: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/checkCompatibility

**Final instruction to agent:** Build the smallest correct, maintainable slice per milestone. Readability, testable boundaries, and truthful metrics are more important than maximizing feature count or code output.
