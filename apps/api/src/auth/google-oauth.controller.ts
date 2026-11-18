import { CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Header, Injectable, Post, Req, Res, UseGuards } from "@nestjs/common";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { authenticatedRequest, type AuthenticatedRequest, CsrfGuard, SessionGuard } from "./auth.guard";
import { GoogleOAuthService } from "./google-oauth.service";

const STATE_COOKIE = "adpulse_google_oauth_state";
const STATE_MAX_AGE_SECONDS = 600;

@Injectable()
export class GoogleOAuthAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.isSuperAdmin) throw new ForbiddenException("Only the Super Admin can manage the Google connection.");
    if (request.user.mustResetPassword) throw new ForbiddenException("Change your temporary password before managing Google connections.");
    return true;
  }
}

@Controller("auth/google")
export class GoogleOAuthController {
  constructor(private readonly oauth: GoogleOAuthService) {}

  @Get("status")
  @Header("Cache-Control", "no-store")
  @UseGuards(SessionGuard, GoogleOAuthAdminGuard)
  status() {
    return this.oauth.getConnectionStatus();
  }

  @Post("start")
  @Header("Cache-Control", "no-store")
  @UseGuards(SessionGuard, GoogleOAuthAdminGuard, CsrfGuard)
  async start(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ authorizationUrl: string }> {
    const state = randomBytes(32).toString("base64url");
    const authorizationUrl = this.oauth.getAuthorizationUrl(state);
    await this.oauth.createState(state, authenticatedRequest(request).id);
    response.setHeader("Set-Cookie", makeStateCookie(state));
    return { authorizationUrl };
  }

  @Get("callback")
  @Header("Cache-Control", "no-store")
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Set-Cookie", clearStateCookie());

    const returnedState = queryString(request.query.state);
    const savedState = getCookie(request, STATE_COOKIE);
    if (!returnedState || !savedState || !sameSecret(returnedState, savedState)) {
      redirectToSettings(response, "error");
      return;
    }

    const initiatedBy = await this.oauth.consumeState(returnedState);
    if (!initiatedBy || queryString(request.query.error)) {
      redirectToSettings(response, "error");
      return;
    }

    const code = queryString(request.query.code);
    if (!code) {
      redirectToSettings(response, "error");
      return;
    }

    try {
      const refreshToken = await this.oauth.exchangeAuthorizationCode(code);
      if (!refreshToken) {
        redirectToSettings(response, "error");
        return;
      }
      await this.oauth.saveRefreshToken(refreshToken, initiatedBy);
      redirectToSettings(response, "connected");
    } catch {
      redirectToSettings(response, "error");
    }
  }
}

function makeStateCookie(state: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=${STATE_MAX_AGE_SECONDS}${secure}`;
}

function clearStateCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0${secure}`;
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

function redirectToSettings(response: Response, status: "connected" | "error"): void {
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  const destination = new URL("/settings", webOrigin);
  destination.searchParams.set("googleConnection", status);
  response.redirect(303, destination.toString());
}
