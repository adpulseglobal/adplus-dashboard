CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  must_reset_password boolean NOT NULL DEFAULT true,
  is_super_admin boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_single_super_admin_idx
  ON app_users (is_super_admin) WHERE is_super_admin = true;

CREATE TABLE IF NOT EXISTS app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_permissions (
  code text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS app_role_permissions (
  role_id uuid NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES app_permissions(code) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS app_user_roles (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES app_roles(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_sessions_user_active_idx ON app_sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS app_refresh_tokens (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES app_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  replaced_by_hash text
);
CREATE INDEX IF NOT EXISTS app_refresh_tokens_session_idx ON app_refresh_tokens(session_id);

CREATE TABLE IF NOT EXISTS app_audit_events (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_audit_events_created_at_idx ON app_audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS app_schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_system_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_permissions (code, description) VALUES
  ('google_ads.view', 'View Google Ads reports and connection options'),
  ('ga4.view', 'View GA4 reports and connection options'),
  ('users.create', 'Create users and issue temporary credentials'),
  ('roles.create', 'Create roles and configure their permissions'),
  ('users.view', 'View users'),
  ('roles.view', 'View roles'),
  ('users.assign_role', 'Assign a role to a user')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
