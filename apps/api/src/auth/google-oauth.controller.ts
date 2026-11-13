import { Controller, Get, Injectable, Req, Res, UseGuards } from "@nestjs/common";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { GoogleOAuthService } from "./google-oauth.service";

const STATE_COOKIE = "adpulse_oauth_state";
const STATE_MAX_AGE_SECONDS = 600;

@Injectable()
export class LocalhostOnlyGuard {
  canActivate(context: { switchToHttp(): { getRequest(): Request } }): boolean {
    const request = context.switchToHttp().getRequest();
    const remoteAddress = request.socket.remoteAddress?.toLowerCase() ?? "";
    const localAddress = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
    let localHost = false;
    try {
      localHost = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(`http://${request.headers.host}`).hostname.toLowerCase());
    } catch {
      localHost = false;
    }
    return localAddress && localHost;
  }
}

@Controller("auth/google")
@UseGuards(LocalhostOnlyGuard)
export class GoogleOAuthController {
  constructor(private readonly oauth: GoogleOAuthService) {}

  @Get("start")
  start(@Res() response: Response): void {
    const state = randomBytes(32).toString("base64url");
    response.setHeader("Set-Cookie", makeStateCookie(state));
    response.setHeader("Cache-Control", "no-store");
    response.redirect(this.oauth.getAuthorizationUrl(state));
  }

  @Get("callback")
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const returnedState = queryString(request.query.state);
    const savedState = getCookie(request, STATE_COOKIE);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Set-Cookie", clearStateCookie());

    if (!returnedState || !savedState || !sameSecret(returnedState, savedState)) {
      sendPage(response, 400, "Authorization could not be verified", "The OAuth state check failed. Start again from the local authorization link.");
      return;
    }

    const providerError = queryString(request.query.error);
    if (providerError) {
      sendPage(response, 400, "Authorization was not completed", "Google did not grant access. Start again if you want to retry.");
      return;
    }

    const code = queryString(request.query.code);
    if (!code) {
      sendPage(response, 400, "Authorization code missing", "Google returned no authorization code. Start again from the local authorization link.");
      return;
    }

    try {
      const refreshToken = await this.oauth.exchangeAuthorizationCode(code);
      if (!refreshToken) {
        sendPage(response, 400, "No refresh token returned", "Google did not return a refresh token. Remove AdPulse from your Google Account third-party connections, then restart authorization.");
        return;
      }
      sendTokenPage(response, refreshToken);
    } catch {
      sendPage(response, 502, "Token exchange failed", "Google could not exchange the authorization code. Check the OAuth client and exact localhost redirect URI, then try again.");
    }
  }
}

function makeStateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=${STATE_MAX_AGE_SECONDS}`;
}

function clearStateCookie(): string {
  return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0`;
}

function getCookie(request: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  return request.headers.cookie?.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sameSecret(first: string, second: string): boolean {
  const firstBytes = Buffer.from(first);
  const secondBytes = Buffer.from(second);
  return firstBytes.length === secondBytes.length && timingSafeEqual(firstBytes, secondBytes);
}

function sendTokenPage(response: Response, refreshToken: string): void {
  const safeToken = escapeHtml(refreshToken);
  sendHtmlPage(response, 200, "Authorization complete", `<p>Copy this refresh token into the API environment as <code>GOOGLE_OAUTH_REFRESH_TOKEN</code>. Keep it secret.</p><label for="refresh-token">Refresh token</label><br><textarea id="refresh-token" readonly rows="4" cols="72">${safeToken}</textarea>`);
}

function sendPage(response: Response, status: number, title: string, message: string): void {
  sendHtmlPage(response, status, title, `<p>${escapeHtml(message).replaceAll("\n", "<br>")}</p>`);
}

function sendHtmlPage(response: Response, status: number, title: string, body: string): void {
  response.status(status).type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · AdPulse</title><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
