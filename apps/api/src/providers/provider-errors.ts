import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";

export async function assertGoogleResponse(response: Response, providerName: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 401) throw new UnauthorizedException(`${providerName} rejected authorization. Reconnect the Google account.`);
  if (response.status === 403) throw new ForbiddenException(`${providerName} access is missing or the required API is not enabled.`);
  if (response.status === 429 || response.status >= 500) throw new ServiceUnavailableException(`${providerName} is temporarily unavailable. Try again later.`);
  if (response.status === 400 && providerName === "Google Analytics Data API") throw new BadRequestException("Google Analytics rejected an incompatible report dimension, metric, or filter combination. Remove a filter and try again.");
  if (response.status === 400) throw new BadRequestException(`${providerName} rejected the request: ${await googleErrorMessage(response)}`);
  throw new ServiceUnavailableException(`${providerName} request failed with status ${response.status}.`);
}

async function googleErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as {
      error?: {
        message?: unknown;
        details?: Array<{ message?: unknown; errors?: Array<{ message?: unknown }> }>;
      };
    };
    const detail = payload.error?.details?.flatMap((item) => [
      ...(typeof item.message === "string" ? [item.message] : []),
      ...(item.errors ?? []).flatMap((error) => typeof error.message === "string" ? [error.message] : []),
    ])[0];
    const message = detail ?? payload.error?.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 500);
  } catch {
    // Keep the public error generic when Google's response is not valid JSON.
  }
  return "check the selected account, API access, and query fields.";
}

export function isMockMode(): boolean {
  return (process.env.GOOGLE_CONNECTIONS_MODE ?? "mock") === "mock";
}

export function throwMockScenarioIfRequired(): void {
  const scenario = process.env.GOOGLE_CONNECTIONS_MOCK_SCENARIO ?? "normal";
  if (scenario === "expired-auth") throw new UnauthorizedException("Mock Google authorization is expired.");
  if (scenario === "permission-denied") throw new ForbiddenException("Mock Google permissions are insufficient for connection discovery.");
}
