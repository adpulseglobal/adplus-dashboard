ALTER TABLE app_google_oauth_connection
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'connected'
    CHECK (connection_status IN ('connected', 'reauth_required', 'configuration_error')),
  ADD COLUMN IF NOT EXISTS status_message text,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz NOT NULL DEFAULT now();
