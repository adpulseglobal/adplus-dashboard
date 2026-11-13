import { Body, Controller, Get, Header, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { authenticatedRequest, CsrfGuard, PermissionsGuard, RequirePermissions, SessionGuard } from "../auth/auth.guard";
import { AdminService, type PermissionRow } from "./admin.service";

@Controller("admin")
@UseGuards(SessionGuard, PermissionsGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("permissions")
  @RequirePermissions("roles.view")
  permissions(): Promise<PermissionRow[]> { return this.admin.listPermissions(); }

  @Get("roles")
  @RequirePermissions("roles.view")
  roles() { return this.admin.listRoles(); }

  @Post("roles")
  @UseGuards(CsrfGuard)
  @RequirePermissions("roles.create", "roles.view")
  createRole(@Req() request: Request, @Body() body: { name?: unknown; permissions?: unknown }) {
    return this.admin.createRole(authenticatedRequest(request), body?.name, body?.permissions);
  }

  @Get("users")
  @RequirePermissions("users.view")
  users() { return this.admin.listUsers(); }

  @Post("users")
  @Header("Cache-Control", "no-store")
  @UseGuards(CsrfGuard)
  @RequirePermissions("users.create", "users.assign_role", "roles.view")
  createUser(@Req() request: Request, @Body() body: { email?: unknown; roleId?: unknown }) {
    return this.admin.createUser(authenticatedRequest(request), body?.email, body?.roleId);
  }

  @Patch("users/:id/role")
  @UseGuards(CsrfGuard)
  @RequirePermissions("users.assign_role", "roles.view")
  assignRole(@Req() request: Request, @Param("id") userId: string, @Body() body: { roleId?: unknown }) {
    return this.admin.assignRole(authenticatedRequest(request), userId, body?.roleId);
  }

  @Post("users/:id/reset-password")
  @Header("Cache-Control", "no-store")
  @UseGuards(CsrfGuard)
  @RequirePermissions("users.create")
  resetPassword(@Req() request: Request, @Param("id") userId: string) { return this.admin.resetUserPassword(authenticatedRequest(request), userId); }
}
