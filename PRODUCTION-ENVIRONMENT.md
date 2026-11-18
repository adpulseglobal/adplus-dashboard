# Production environment profile

This file records deployment-specific facts verified while deploying AdPulse to `analytics.adpulseglobal.com`. It supplements the general deployment procedure. Keep secrets, private keys, passwords, tokens, and full connection strings out of this file.

Last updated: 2026-11-18

## Verified environment

- **Application URL:** `https://analytics.adpulseglobal.com`
- **Source repository and branch:** `adpulseglobal/adplus-dashboard`, `main`
- **Deployment user:** `ubuntu`
- **Application directory on the VM:** `/opt/adpulse-dashboard/adplus-dashboard`
- **Runtime:** Docker Compose. The AdPulse images use Node 24; the VM's Node 12 and n8n's runtime are unchanged.
- **Existing services:** Nginx and n8n already run on the VM. n8n uses a separate PostgreSQL container. AdPulse uses the host's PostgreSQL service and database `adpulse` with database role `adpulse`.
- **Public host ports:** Compose binds the web and API containers to loopback only: `127.0.0.1:3000` and `127.0.0.1:4000`. PostgreSQL port `5432` must not be exposed publicly.
- **Cloudflare:** `adpulseglobal.com` is managed in Cloudflare. The zone's SSL/TLS mode is **Full (strict)**.
- **TLS:** Nginx uses a Certbot certificate for `analytics.adpulseglobal.com`. `sudo certbot renew --dry-run` succeeded.
- **Application checks:** Super Admin sign-in and first-password reset succeeded; live Google Ads and GA4 data loaded.

## Docker and PostgreSQL network

The checked VM routes and Docker networks did not overlap the selected AdPulse subnet:

| Network | Subnet | Gateway |
|---|---:|---:|
| Docker bridge | `172.17.0.0/16` | `172.17.0.1` |
| `n8n_default` | `172.18.0.0/16` | `172.18.0.1` |
| `adpulse-production` | `172.29.240.0/24` | `172.29.240.1` |

The host PostgreSQL service must listen on `localhost,172.29.240.1`. Its `pg_hba.conf` needs this narrow rule:

```text
host    adpulse    adpulse    172.29.240.0/24    scram-sha-256
```

The host firewall initially rejected the bridge connection. A narrow `iptables` INPUT allow rule resolved it and the migration then completed:

```bash
sudo iptables -I INPUT 1 -s 172.29.240.0/24 -d 172.29.240.1 -p tcp --dport 5432 -j ACCEPT
```

The rule was configured for persistence with `adpulse-postgres-firewall.service`, which runs `/usr/local/sbin/adpulse-firewall.sh` at boot. Confirm the service is enabled and active before relying on it after a reboot:

```bash
sudo systemctl status adpulse-postgres-firewall.service --no-pager
sudo iptables -C INPUT -s 172.29.240.0/24 -d 172.29.240.1 -p tcp --dport 5432 -j ACCEPT
```

Do not replace this with a public ingress rule for port `5432`.

## Nginx routing

Nginx runs on the VM host and proxies the public hostname to the loopback-bound containers:

- API paths (`/auth`, `/admin`, `/connections`, `/filters`, `/reports`) go to `127.0.0.1:4000`.
- All other paths go to `127.0.0.1:3000`.
- Keep one active Nginx server block for `analytics.adpulseglobal.com`. During setup, duplicate declarations in the Certbot-managed `default` site and a separate AdPulse site caused a conflicting `server_name` warning, even though `nginx -t` also reported success.
- For the production OAuth connection flow, do not block `/auth/google/`. Add an exact `/auth/google/callback` location to the API and turn off access logging for that exact path because its query contains a short-lived authorization code:

```nginx
location = /auth/google/callback {
    access_log off;
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Keep this location inside the HTTPS `server` block and before the general API route. Validate and reload after editing:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Runtime configuration handling

- Runtime secrets belong in `/etc/adpulse/adpulse.env`, owned by `root:root` with mode `600`; edit with `sudoedit`.
- The API uses `API_HOST=0.0.0.0` inside its container and `API_PORT=4000`; Compose publishes it only on host loopback.
- Set `WEB_ORIGIN=https://analytics.adpulseglobal.com` in the API runtime environment.
- Set `NEXT_PUBLIC_API_BASE_URL=https://analytics.adpulseglobal.com` in the build-time `.env.production` file. It is a public URL, not a secret, and is embedded in the frontend image at build time.
- Database passwords, OAuth client secrets, auth signing secrets, the initial Super Admin password, Google refresh tokens, and encryption keys must never be placed in this document, source code, or frontend build variables.

## Google OAuth connection migration

The deployed version currently uses the refresh token that was generated locally and supplied through the protected runtime environment file. The production OAuth connection flow is in `main` but still needs to be deployed and authorized.

When deploying that update:

1. Register `https://analytics.adpulseglobal.com/auth/google/callback` as an authorized redirect URI on the Google OAuth Web client.
2. Set `GOOGLE_OAUTH_REDIRECT_URI` to that exact URI.
3. Generate a separate stable 32-byte encryption key on the VM with `openssl rand -hex 32`, and set it as `GOOGLE_TOKEN_ENCRYPTION_KEY` in `/etc/adpulse/adpulse.env`. Back it up securely; losing it prevents decryption of the database-stored token. Do not regenerate it after connecting Google.
4. Remove any Nginx rule returning 404 for `/auth/google/`; install the exact callback location above.
5. Build the images, run the Compose migration profile, and start AdPulse. Then sign in as Super Admin and use **Settings → Reporting sources → Secure Google connection**.
6. Confirm the UI reports that the connection is encrypted in PostgreSQL and verify live Ads/GA4 reports. Only then remove the legacy `GOOGLE_OAUTH_REFRESH_TOKEN` from `/etc/adpulse/adpulse.env` and recreate the API container.

The OAuth client ID and client secret remain server-side runtime configuration. The refresh token is stored encrypted in PostgreSQL; it is never displayed in the UI. The current connection is shared by reporting-authorized AdPulse users, not isolated per app user.

## Deployment commands

Run from the application directory as `ubuntu`; use `sudo` for Docker, Nginx, PostgreSQL, and system configuration operations:

```bash
cd /opt/adpulse-dashboard/adplus-dashboard
git pull origin main
sudo docker compose -f compose.production.yaml -p adpulse build --pull
sudo docker compose -f compose.production.yaml -p adpulse --profile tools run --rm migrate
sudo docker compose -f compose.production.yaml -p adpulse up -d
sudo docker compose -f compose.production.yaml -p adpulse ps
```

After deployments, verify the login page and authenticated data access over HTTPS. For the current production domain, the host and API are behind the same origin, so browser auth cookies remain same-site.
