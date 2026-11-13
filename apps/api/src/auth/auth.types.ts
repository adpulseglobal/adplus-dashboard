export interface AuthenticatedUser {
  id: string;
  email: string;
  sessionId: string;
  isSuperAdmin: boolean;
  mustResetPassword: boolean;
  permissions: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresAt: string;
  user: Pick<AuthenticatedUser, "id" | "email" | "isSuperAdmin" | "mustResetPassword" | "permissions">;
}
