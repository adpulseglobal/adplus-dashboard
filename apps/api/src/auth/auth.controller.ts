import { Body, Controller, Get, Header, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { clearAuthCookies, CSRF_COOKIE, readCookie, REFRESH_COOKIE, setAuthCookies } from "./auth.cookies";
import { authenticatedRequest, CsrfGuard, SessionGuard } from "./auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async login(@Body() body: { email?: unknown; password?: unknown }, @Res({ passthrough: true }) response: Response) {
    const tokens = await this.auth.login(body?.email, body?.password);
    setAuthCookies(response, tokens);
    return { user: tokens.user, expiresAt: tokens.expiresAt };
  }

  @Post("refresh")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      const tokens = await this.auth.refresh(readCookie(request, REFRESH_COOKIE));
      tokens.csrfToken = readCookie(request, CSRF_COOKIE) ?? tokens.csrfToken;
      setAuthCookies(response, tokens);
      return { user: tokens.user, expiresAt: tokens.expiresAt };
    } catch (error) {
      if (error instanceof UnauthorizedException) clearAuthCookies(response);
      throw error;
    }
  }

  @Get("me")
  @Header("Cache-Control", "no-store")
  @UseGuards(SessionGuard)
  me(@Req() request: Request) {
    const user = authenticatedRequest(request);
    return { id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin, mustResetPassword: user.mustResetPassword, permissions: user.permissions };
  }

  @Post("password")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  @UseGuards(SessionGuard, CsrfGuard)
  async changePassword(@Req() request: Request, @Body() body: { currentPassword?: unknown; newPassword?: unknown }, @Res({ passthrough: true }) response: Response) {
    const tokens = await this.auth.changePassword(authenticatedRequest(request), body?.currentPassword, body?.newPassword);
    setAuthCookies(response, tokens);
    return { user: tokens.user, expiresAt: tokens.expiresAt };
  }

  @Post("logout")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  @UseGuards(SessionGuard, CsrfGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(authenticatedRequest(request));
    clearAuthCookies(response);
    return { ok: true };
  }
}
