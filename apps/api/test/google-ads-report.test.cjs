const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");

const contractPath = join(__dirname, "../../../packages/contracts/src/dashboard-filters.ts");
const reportPath = join(__dirname, "../src/reports/google-ads-report.ts");
function loadTypeScriptModule(filename) {
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const result = new Module(filename, module);
  result.filename = filename;
  result.paths = Module._nodeModulePaths(join(__dirname, "../src"));
  result._compile(compiled, filename);
  return result.exports;
}

const { defaultDashboardFilters } = loadTypeScriptModule(contractPath);
const { buildCampaignReportQuery, buildMockCampaignRows, normalizeCampaignReport } = loadTypeScriptModule(reportPath);
const filters = {
  ...defaultDashboardFilters(new Date("2026-10-26T12:00:00Z")),
  dateRange: { startDate: "2026-10-01", endDate: "2026-10-03" },
  googleAdsAccountId: "1234567890",
};

test("builds GAQL with date, campaign ID, campaign type and device predicates", () => {
  const query = buildCampaignReportQuery({
    ...filters,
    campaignIds: ["501", "502"],
    campaignTypes: ["SEARCH"],
    devices: ["mobile", "tablet"],
  });

  assert.match(query, /segments\.date BETWEEN '2026-10-01' AND '2026-10-03'/);
  assert.match(query, /campaign\.id IN \(501, 502\)/);
  assert.match(query, /advertising_channel_type IN \('SEARCH'\)/);
  assert.match(query, /segments\.device IN \('MOBILE', 'TABLET'\)/);
  assert.match(query, /metrics\.cost_micros/);
  assert.match(query, /metrics\.clicks/);
  assert.match(query, /ORDER BY segments\.date, campaign\.id/);
});

test("sums base metrics before deriving CTR and cost per conversion", () => {
  const rows = [
    { customer: { currencyCode: "USD" }, campaign: { id: "7", name: "Search", status: "ENABLED", advertisingChannelType: "SEARCH" }, segments: { date: "2026-10-01", device: "MOBILE" }, metrics: { costMicros: "1234567", clicks: "10", impressions: "100", conversions: "1.25" } },
    { customer: { currencyCode: "USD" }, campaign: { id: "7", name: "Search", status: "ENABLED", advertisingChannelType: "SEARCH" }, segments: { date: "2026-10-02", device: "DESKTOP" }, metrics: { costMicros: "8765433", clicks: "15", impressions: "100", conversions: "2.75" } },
  ];
  const report = normalizeCampaignReport(rows, "1234567890", "live", filters.dateRange);

  assert.equal(report.currency, "USD");
  assert.deepEqual(report.totals, { spend: 10, clicks: 25, impressions: 200, conversions: 4, ctr: 12.5, costPerConversion: 2.5 });
  assert.equal(report.campaigns.length, 1);
  assert.equal(report.campaigns[0].spend, report.totals.spend);
  assert.equal(report.daily[0].date, "2026-10-01");
  assert.equal(report.devices.length, 2);
});

test("keeps zero denominators honest and emits a null CPA", () => {
  const report = normalizeCampaignReport([
    { campaign: { id: "8", advertisingChannelType: "DISPLAY" }, segments: { date: "2026-10-03", device: "DESKTOP" }, metrics: { costMicros: "0", clicks: "0", impressions: "0", conversions: "0" } },
  ], "1234567890", "live", filters.dateRange);

  assert.equal(report.totals.ctr, 0);
  assert.equal(report.totals.costPerConversion, null);
});

test("mock rows respect campaign and device filters and reconcile totals", () => {
  const rows = buildMockCampaignRows({ ...filters, campaignIds: ["501"], devices: ["mobile"] });
  const report = normalizeCampaignReport(rows, filters.googleAdsAccountId, "mock", filters.dateRange);

  assert.equal(report.mode, "mock");
  assert.deepEqual(report.campaigns.map(({ id }) => id), ["501"]);
  assert.deepEqual(report.devices.map(({ device }) => device), ["MOBILE"]);
  assert.equal(report.totals.spend, 4286.2);
  assert.equal(report.totals.clicks, 2841);
  assert.equal(report.totals.conversions, 186);
  assert.ok(rows.every(({ segments }) => segments.date >= filters.dateRange.startDate && segments.date <= filters.dateRange.endDate));
});
