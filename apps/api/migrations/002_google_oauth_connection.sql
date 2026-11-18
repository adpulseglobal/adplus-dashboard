CREATE TABLE IF NOT EXISTS app_google_oauth_connection (
  connection_key text PRIMARY KEY CHECK (connection_key = 'shared'),
  refresh_token_ciphertext bytea NOT NULL,
  refresh_token_iv bytea NOT NULL,
  refresh_token_auth_tag bytea NOT NULL,
  connected_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_google_oauth_states (
  state_hash text PRIMARY KEY,
  initiated_by uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS app_google_oauth_states_expiry_idx
  ON app_google_oauth_states(expires_at);
