import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { CSRF_COOKIE, readCookie, ACCESS_COOKIE } from "./auth.cookies";
import type { AuthenticatedUser } from "./auth.types";

export const PERMISSIONS_KEY = "adpulse:permissions";
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export interface AuthenticatedRequest extends Request { user: AuthenticatedUser }

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.auth.authenticateAccess(readCookie(request, ACCESS_COOKIE));
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user.mustResetPassword) throw new ForbiddenException("Change your temporary password before using the dashboard.");
    if (request.user.isSuperAdmin || required.every((permission) => request.user.permissions.includes(permission))) return true;
    throw new ForbiddenException("Your role does not have permission to perform this action.");
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (request.get("origin") !== expectedOrigin) throw new ForbiddenException("Request origin is not allowed.");
    if (request.path === "/auth/login") return true;
    const cookie = readCookie(request, CSRF_COOKIE);
    const header = request.header("x-csrf-token");
    if (!cookie || !header || !constantTimeEqual(cookie, header)) throw new ForbiddenException("CSRF token is missing or invalid.");
    return true;
  }
}

export function authenticatedRequest(request: Request): AuthenticatedUser {
  const user = (request as AuthenticatedRequest).user;
  if (!user) throw new UnauthorizedException("Please log in to continue.");
  return user;
}

function constantTimeEqual(first: string, second: string): boolean {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}
