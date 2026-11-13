const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadTypeScriptModule(filename) {
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const result = new Module(filename, module);
  result.filename = filename;
  result.paths = Module._nodeModulePaths(join(__dirname, "../src"));
  result._compile(compiled, filename);
  return result.exports;
}

const { defaultDashboardFilters } = loadTypeScriptModule(join(__dirname, "../../../packages/contracts/src/dashboard-filters.ts"));
const { buildGa4ReportRequest, buildMockGa4Report } = loadTypeScriptModule(join(__dirname, "../src/reports/ga4-report.ts"));
const filters = {
  ...defaultDashboardFilters(new Date("2026-10-26T12:00:00Z")),
  dateRange: { startDate: "2026-10-01", endDate: "2026-10-03" },
  googleAdsAccountId: "1234567890",
  ga4AccountId: "200000001",
  ga4PropertyId: "100000001",
};

test("GA4 query scopes by Ads customer only when the switch is on", () => {
  const allTraffic = buildGa4ReportRequest("date", filters);
  const scoped = buildGa4ReportRequest("date", { ...filters, ga4AdsScope: true });
  assert.equal(JSON.stringify(allTraffic).includes("sessionGoogleAdsCustomerId"), false);
  assert.equal(JSON.stringify(scoped).includes('"fieldName":"sessionGoogleAdsCustomerId"'), true);
  assert.equal(JSON.stringify(scoped).includes('"values":["1234567890"]'), true);
});

test("mock GA4 totals narrow to the selected Ads customer when enabled", () => {
  const allTraffic = buildMockGa4Report(filters, filters.ga4PropertyId);
  const scoped = buildMockGa4Report({ ...filters, ga4AdsScope: true }, filters.ga4PropertyId);
  assert.ok(scoped.totals.sessions > 0);
  assert.ok(scoped.totals.sessions < allTraffic.totals.sessions);
});
