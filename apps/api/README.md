# Connections API

The NestJS API provides Google account/property discovery for the dashboard. Its default mode is fixture-backed mock data, so it can run without Google credentials.

## Local run

From the repository root, configure PostgreSQL and the auth values shown in `.env.example`, then run `npm install`. Apply the database schema with `npm run db:migrate` before starting the API. Start the API and frontend with `npm run dev:api` and `npm run dev` in separate terminals. The API listens on `127.0.0.1:4000` by default; open the frontend at `http://localhost:3000` so browser cookies remain same-site with the default API URL.

On a fresh database, the API creates the Super Admin once using `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_INITIAL_PASSWORD`. Set a unique strong initial password per deployment. The account requires a password change at first sign-in; subsequent API starts do not read or reset that password. Set `AUTH_TOKEN_SECRET` to at least 32 random characters (for example, generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`). Never commit the populated `.env` file.

PostgreSQL must be reachable through `DATABASE_URL`. For local development, `DATABASE_SSL=false`; set `DATABASE_SSL=true` when the database requires verified TLS.

Endpoints:

- `GET /connections/google-ads`
- `GET /connections/google-ads/ga4-properties?accountId=1234567890` (lists only GA4 properties linked to the selected Ads customer)
- `GET /connections/ga4`
- `GET /connections/google-ads/filter-options?accountId=1234567890&startDate=2026-10-01&endDate=2026-10-31` (lists campaigns with report rows in the selected date range)
- `GET /connections/ga4/filter-options?propertyId=100000001`
- `POST /connections/google-ads/select` with `{ "id": "1234567890" }`
- `POST /connections/ga4/select` with `{ "id": "100000001" }`
- `POST /filters/validate` with a `DashboardFilters` JSON object
- `POST /reports/google-ads/campaign-performance` with a `DashboardFilters` JSON object and a selected `googleAdsAccountId`
- `POST /reports/ga4/acquisition` requires a selected Ads customer and a GA4 property linked to that customer; mismatched pairs are rejected.
- `GET /auth/google/status` for Super Admin connection status
- `POST /auth/google/start` for a Super Admin to begin Google authorization
- `GET /auth/google/callback` as the OAuth redirect URI

## Local OAuth authorization

For local development, add `http://localhost:4000/auth/google/callback` as an authorized redirect URI on the Google OAuth **Web application** client and set `GOOGLE_OAUTH_REDIRECT_URI` to that exact URI. Sign in as the local Super Admin, open Settings â†’ Reporting sources, and choose **Connect Google**. The API requires the app session and CSRF token to start, uses a short-lived one-time state value, exchanges the authorization code server-side, encrypts the refresh token with AES-256-GCM, and stores it in PostgreSQL. The token is never returned to the browser or logged. Generate `GOOGLE_TOKEN_ENCRYPTION_KEY` as 32 random bytes encoded in hexadecimal (`openssl rand -hex 32`); keep this key stable and backed up separately from the database because it is required to decrypt the stored connection.

The flow requests Google Ads (`adwords`) and GA4 read-only (`analytics.readonly`) access with offline access and a consent prompt. Configure the OAuth consent screen as External / Testing and add your Google account as a test user. Google sign-in still applies the account's authentication requirements; this local flow replaces OAuth Playground but cannot bypass a passkey requirement. Refresh tokens issued while an external app is in Testing expire after seven days for these scopes.

The Google Ads campaign-performance report returns a source and mode, selected account and account currency, requested date range, reconciled totals, campaign rows, daily spend, device, and campaign-type breakdowns. Spend is converted from Google Ads micros. CTR is calculated from aggregate clicks and impressions; cost per conversion is derived from aggregate cost and conversions. Ratios are not averaged across campaigns. The report query is bounded by the contract's maximum 366-day range, pages through up to 100,000 rows, and reports an error when a narrower request is needed.

In mock mode the route produces clearly identified fixture-backed performance data and applies the campaign, campaign-type, device, and date filters. Mock distributions are illustrative, not live Google Ads observations. Live mode uses the OAuth refresh-token and developer-token configuration described below.

Selection validates the ID by rediscovering accessible resources. It does not persist the selection. Unknown or inaccessible IDs return 404.

Filter option routes first validate access to the requested account/property. GA4 channel, source/medium, and landing-page options use a bounded 90-day context and return the top 1,000 rows for each dimension. The planning route validates selected values, returns source applicability and warnings, and calculates the previous equal-length date range.

## Live Google connections

Set `GOOGLE_CONNECTIONS_MODE=live`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and `GOOGLE_TOKEN_ENCRYPTION_KEY` in the API environment. Do not configure `GOOGLE_OAUTH_REFRESH_TOKEN` for a new deployment; a legacy environment token is read only as a migration fallback until the Super Admin connects Google and removes it. In production, the redirect URI must be HTTPS and must exactly match the URI registered in Google Cloud Console. Use the same Google Cloud project for the OAuth client and Google Ads API access level. Its project needs access to production accounts (Explorer or higher); Test access only works with test accounts. Add the authorizing Google account to the Ads account, or give a manager account access. Keep the OAuth client secret and encryption key in a protected runtime secret file, never in the frontend or source control.

This is one shared Google identity for the deployment. App roles decide who can view Ads or GA4 data, but Google account access is not isolated per AdPulse user.

The OAuth user needs the Google Ads API scope (`https://www.googleapis.com/auth/adwords`) and GA4 Analytics read-only scope. Request offline access to obtain a refresh token. Configure the consent screen and OAuth client in Google Cloud Console, then authorize the Google account that can access the Ads customer and GA4 property. Google Ads account access is project-based as of September 2026; the optional `GOOGLE_ADS_DEVELOPER_TOKEN` setting remains only for compatibility with environments that still supply one.

Live endpoints use Google's Ads `listAccessibleCustomers` REST method and the Analytics Admin API `accountSummaries.list`. The Ads API returns directly accessible customers; manager hierarchy traversal is not included in this milestone.

For local mock error handling, set `GOOGLE_CONNECTIONS_MOCK_SCENARIO` to `expired-auth` or `permission-denied`. The default `normal` scenario returns clearly marked mock resources.

## Access boundary

All reporting and connection APIs require an authenticated app-user session. Login and refresh tokens are held in `HttpOnly`, `SameSite=Lax` cookies; production cookies are `Secure`. State-changing requests require a CSRF cookie/header pair and an allowed `Origin`. Access tokens last 15 minutes; refresh tokens rotate and have a 24-hour absolute lifetime. Refresh expiry, logout, or reuse of an invalidated refresh token revokes all sessions for that user. A password reset is required before normal dashboard access after initial user creation or admin reset.

Permissions are enforced by the API. The initial permission codes are `google_ads.view`, `ga4.view`, `users.create`, `roles.create`, `users.view`, `roles.view`, and `users.assign_role`. Super Admin bypasses permission checks but is a protected account and cannot be assigned an ordinary role. Settings provides role/user administration; a new user's temporary credentials are downloadable once as JSON during creation for manual sharing. The original password cannot be recovered after that download; an admin can issue a new temporary password.

Authentication endpoints include `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/password`, and `POST /auth/logout`. Administrative operations are under `/admin/users`, `/admin/roles`, and `/admin/permissions`.

## Reports

`POST /reports/google-ads/campaign-performance` returns account-currency totals, campaigns, daily spend, devices, and campaign types. The Google Ads screen consumes this route, and its CSV export matches the displayed report.

`POST /reports/ga4/acquisition` returns GA4 sessions, distinct users, engaged sessions, engagement rate, key events, daily sessions, channels, source/medium, landing pages, and devices. It applies the selected GA4 filters and optional Google Ads-attributed customer/campaign filters. The request uses Data API `TOTAL` aggregation for distinct users; it does not sum daily users. It requests no ecommerce-specific metrics.

GA4 report dimensions page in blocks of 10,000 up to 50,000 rows. A response sets `truncated` and includes a warning if a dimension exceeds that cap. Narrow the dates or add filters to see the complete result. A Google Analytics 400 response includes an actionable incompatibility message. Live API field compatibility and property behavior still need verification against a connected Google property; mock mode is the default for local work.
