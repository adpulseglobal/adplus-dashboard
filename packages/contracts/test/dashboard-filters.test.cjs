const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");

// Keep the contracts package dependency-free while exercising its TypeScript source directly.
const sourcePath = join(__dirname, "../src/dashboard-filters.ts");
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText;
const contractModule = new Module(sourcePath, module);
contractModule.filename = sourcePath;
contractModule.paths = Module._nodeModulePaths(join(__dirname, "../src"));
contractModule._compile(compiled, sourcePath);
const {
  buildReportQueryKey,
  calculatePreviousPeriod,
  defaultDashboardFilters,
  isFilterApplicable,
  parseDashboardFiltersFromSearch,
  serializeDashboardFilters,
  validateDashboardFilters,
} = contractModule.exports;

function validFilters(overrides = {}) {
  return {
    ...defaultDashboardFilters(new Date("2026-10-26T12:00:00Z")),
    ...overrides,
  };
}

test("normalizes filter arrays into sorted, unique values", () => {
  const result = validateDashboardFilters(validFilters({
    campaignIds: ["20", "10", "20"],
    devices: ["tablet", "mobile", "tablet"],
    channelGroups: ["Organic Search", "Paid Search", "Organic Search"],
  }));

  assert.equal(result.success, true);
  assert.deepEqual(result.data.campaignIds, ["10", "20"]);
  assert.deepEqual(result.data.devices, ["mobile", "tablet"]);
  assert.deepEqual(result.data.channelGroups, ["Organic Search", "Paid Search"]);
});

test("rejects malformed dates, reversed ranges, and unsupported filter values", () => {
  const malformed = validateDashboardFilters(validFilters({ dateRange: { startDate: "2026-02-30", endDate: "2026-03-01" } }));
  assert.equal(malformed.success, false);
  assert.ok(malformed.issues.some(({ field }) => field === "startDate"));

  const reversed = validateDashboardFilters(validFilters({ dateRange: { startDate: "2026-10-20", endDate: "2026-10-10" } }));
  assert.equal(reversed.success, false);
  assert.ok(reversed.issues.some(({ field, message }) => field === "dateRange" && message.includes("on or before")));

  const unsupported = validateDashboardFilters(validFilters({ devices: ["console"] }));
  assert.equal(unsupported.success, false);
  assert.ok(unsupported.issues.some(({ field }) => field === "devices"));
});

test("calculates the immediately preceding equal inclusive window", () => {
  assert.deepEqual(calculatePreviousPeriod({ startDate: "2026-10-01", endDate: "2026-10-26" }), {
    startDate: "2026-09-05", endDate: "2026-09-30",
  });
});

test("calculates equal windows across month boundaries and leap day", () => {
  assert.deepEqual(calculatePreviousPeriod({ startDate: "2024-03-01", endDate: "2024-03-01" }), {
    startDate: "2024-02-29", endDate: "2024-02-29",
  });
  assert.deepEqual(calculatePreviousPeriod({ startDate: "2025-01-30", endDate: "2025-02-02" }), {
    startDate: "2025-01-26", endDate: "2025-01-29",
  });
});

test("omits filters unsupported by a source from its report query key", () => {
  const filters = validFilters({
    googleAdsAccountId: "123456",
    ga4PropertyId: "987654",
    campaignIds: ["2", "1"],
    channelGroups: ["Organic Search"],
    landingPages: ["/offers"],
  });

  const adsKey = buildReportQueryKey("google_ads", filters);
  const ga4Key = buildReportQueryKey("ga4", filters);

  assert.ok(adsKey.includes('"account":"123456"'));
  assert.ok(adsKey.includes('"campaigns":["1","2"]'));
  assert.ok(!adsKey.includes("987654"));
  assert.ok(!adsKey.includes("Organic Search"));
  assert.ok(ga4Key.includes('"property":"987654"'));
  assert.ok(ga4Key.includes('"channels":["Organic Search"]'));
});

test("declares source applicability for Ads and GA4-specific filters", () => {
  assert.equal(isFilterApplicable("google_ads", "campaignIds"), true);
  assert.equal(isFilterApplicable("google_ads", "channelGroups"), false);
  assert.equal(isFilterApplicable("ga4", "channelGroups"), true);
  assert.equal(isFilterApplicable("ga4", "landingPages"), true);
});

test("round-trips canonical filters through repeated URL parameters", () => {
  const filters = validFilters({
    googleAdsAccountId: "123456",
    campaignIds: ["20", "10", "20"],
    devices: ["tablet", "mobile"],
    channelGroups: ["Paid Search", "Organic Search"],
  });
  const url = serializeDashboardFilters("/ga4", filters);
  const parsed = parseDashboardFiltersFromSearch(url.slice(url.indexOf("?")), new Date("2026-10-26T12:00:00Z"));

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, validateDashboardFilters(filters).data);
  assert.deepEqual(new URLSearchParams(url.slice(url.indexOf("?"))).getAll("campaignIds"), ["10", "20"]);
});

test("GA4 Ads scope is off by default and requires an Ads account when enabled", () => {
  const defaults = validFilters({ ga4AccountId: "200000001", ga4PropertyId: "100000001" });
  assert.equal(validateDashboardFilters(defaults).data.ga4AdsScope, false);
  assert.equal(validateDashboardFilters({ ...defaults, ga4AdsScope: true }).success, false);

  const scoped = { ...defaults, googleAdsAccountId: "1234567890", ga4AdsScope: true };
  const url = serializeDashboardFilters("/ga4", scoped);
  assert.equal(parseDashboardFiltersFromSearch(url.slice(url.indexOf("?"))).data.ga4AdsScope, true);
  assert.equal(buildReportQueryKey("ga4", scoped).includes('"adsCustomer":"1234567890"'), true);
  assert.equal(buildReportQueryKey("ga4", { ...scoped, ga4AdsScope: false }).includes('"adsCustomer":""'), true);
});
