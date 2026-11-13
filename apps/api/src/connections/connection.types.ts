export type ConnectionSource = "google_ads" | "ga4";

export interface GoogleAdsAccount {
  id: string;
  resourceName: string;
  displayName: string;
  source: "google_ads";
  mode: "live" | "mock";
}

export interface Ga4Property {
  id: string;
  resourceName: string;
  displayName: string;
  accountName: string;
  accountId: string;
  source: "ga4";
  mode: "live" | "mock";
}

export interface Ga4Account {
  id: string;
  displayName: string;
  properties: Ga4Property[];
  mode: "live" | "mock";
}

export type ConnectionOption = GoogleAdsAccount | Ga4Property;
