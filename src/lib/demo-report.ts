// Fixed demo snapshot; live reporting filters do not alter these sample figures.
export const campaigns = [
  { name: "Spring collection | Search", type: "Search", status: "Active", spend: 4286.20, clicks: 2841, ctr: 4.82, conversions: 186 },
  { name: "Brand | US", type: "Search", status: "Active", spend: 2914.80, clicks: 3092, ctr: 8.14, conversions: 241 },
  { name: "Prospecting | Performance Max", type: "Performance Max", status: "Active", spend: 3760.45, clicks: 1927, ctr: 2.31, conversions: 129 },
  { name: "Remarketing | Display", type: "Display", status: "Paused", spend: 1145.00, clicks: 1604, ctr: 1.76, conversions: 42 },
];
export const channels = [
  { name: "Organic Search", sessions: 12340 }, { name: "Paid Search", sessions: 8216 },
  { name: "Direct", sessions: 4728 }, { name: "Referral", sessions: 3207 },
];
export const totals = {
  spend: campaigns.reduce((sum, row) => sum + Math.round(row.spend * 100), 0) / 100,
  conversions: campaigns.reduce((sum, row) => sum + row.conversions, 0),
  clicks: campaigns.reduce((sum, row) => sum + row.clicks, 0),
  sessions: channels.reduce((sum, row) => sum + row.sessions, 0),
};
// Preserve the illustrative trend, scaled to the campaign total in whole cents.
const weights = [46,57,52,66,59,72,64,78,69,82,73,88,79,67,76,91,82,97,83,89,77,94,85,99,91,104,96,112,103,119];
const weightTotal = weights.reduce((sum, value) => sum + value, 0);
const dailyCents = weights.map((value) => Math.floor(value / weightTotal * Math.round(totals.spend * 100)));
dailyCents[dailyCents.length - 1] += Math.round(totals.spend * 100) - dailyCents.reduce((sum, value) => sum + value, 0);
export const dailySpend = dailyCents.map((cents) => cents / 100);
export const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
export const count = (value: number) => new Intl.NumberFormat("en-US").format(value);
