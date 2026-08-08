# 3R&Co production API

Dependency-free PHP 8.3 JSON API for the 3R&Co storefront and administration area. Production uses MySQL 5.7 with `utf8mb4`; the automated integration suite uses SQLite.

## Runtime requirements

- PHP 8.3 with PDO, `pdo_mysql`, mbstring, JSON, fileinfo, and zlib
- MySQL 5.7/InnoDB in production
- `pdo_sqlite` for local integration tests
- `mysqldump` and `tar` for backups
- HTTPS for production session cookies

No Composer packages are required.

## Production paths

The public entry point resolves the private application root from `RNCO_APP_ROOT`, falling back to `/home/rncomy/3rnco_app/current`. It resolves secrets from `RNCO_ENV_FILE`, falling back to `/home/rncomy/3rnco_shared/.env`. Both variables should also be exported for CLI jobs.

Only `public/index.php` and `public/.htaccess` belong in the public API document root. The populated `.env`, source, database tools, uploads, and backups must remain outside `public_html`. Copy `.env.example` to the shared private path, replace every placeholder, and set mode `0600`.

Generate a production key with a cryptographically secure source, for example:

```sh
php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
```

`APP_ORIGIN` must exactly match the browser origin, without a trailing slash. `SESSION_COOKIE_SECURE=1` is mandatory on live HTTPS.

## Database initialization

Create the cPanel MySQL database and user first, grant the user all privileges on only that database, then run:

```sh
RNCO_ENV_FILE=/home/rncomy/3rnco_shared/.env \
php /home/rncomy/3rnco_app/current/scripts/migrate.php --seed
```

Migrations are recorded in `schema_migrations` and are idempotent. The initial seed inserts only missing storefront content: four products, three current slides, gallery entries, Store Settings, the two-step set, the gift set, and the administrator. Stock starts at zero. It does not create customers, orders, promo codes, or enquiries.

The initial administrator credentials are `admin` / `88888888`. The password is stored only as a password hash and `mustChangePassword` is enabled. Until it is changed, the account may read Store Settings but all other admin access and every admin mutation returns `PASSWORD_CHANGE_REQUIRED`. Change it immediately through `POST /api/v1/auth/change-password`.

Production requires `BOOTSTRAP_ADMIN_IPS`, a comma-separated list of exact IPv4 or IPv6 addresses. While the temporary password is active, both admin login and password change are accepted only from those addresses. This prevents an internet visitor from claiming the known bootstrap account. The restriction automatically stops applying after the password is changed; keep the normal admin password private and remove obsolete bootstrap addresses during later configuration maintenance.

## Session and CSRF flow

Sessions are application-owned and stored in `auth_sessions`; the browser receives only a random `Secure`, `HttpOnly`, `SameSite=Lax` cookie. Passwords use `password_hash()` and `password_verify()`.

1. Call `GET /api/v1/auth/session` with credentials enabled.
2. Keep the returned `csrfToken` in memory.
3. Send it as `X-CSRF-Token` on every POST, PATCH, and DELETE request.
4. Continue sending the session cookie. Login, registration, and password changes rotate the session.

Calling `/auth/session` again with the same valid cookie returns the same per-session CSRF token, so a second browser tab does not invalidate a form already open in the first tab. Anonymous sessions use the shorter `GUEST_SESSION_TTL_SECONDS` lifetime.

Customer registration and password changes require any 8 or more characters. Administrator password changes retain the stronger rule of at least 12 characters with a letter and number.

Successful responses use `{ "ok": true, "data": ... }`. Failures use `{ "ok": false, "error": { "code": "...", "message": "...", "fields": ... } }`.

## Main API routes

- `GET|HEAD /api/v1/health`
- `GET /api/v1/storefront`
- `POST /api/v1/auth/register`, `/auth/login`, `/auth/logout`, `/auth/change-password`
- `GET /api/v1/auth/session`
- `GET|PATCH /api/v1/profile`
- address CRUD under `/api/v1/profile/addresses`
- `GET|POST /api/v1/orders`
- `POST /api/v1/promos/validate`, `/enquiries`, `/newsletter`
- admin CRUD under `/api/v1/admin/settings`, `/products`, `/slides`, `/bundles`, `/promos`, `/orders`, `/customers`, `/enquiries`, and `/uploads`
- `GET /api/v1/admin/dashboard` and `/admin/audit-logs`

Admin routes require the `admin` role. Customer orders require the `customer` role. The login endpoint accepts `identifier` as the canonical field and also accepts `email` or `username` for compatibility.

When a product PATCH includes `stock`, it must also include `expectedStock`, the value on which the editor was based. The server locks the product row and returns `INVENTORY_CHANGED` if a checkout changed stock in the meantime; reload and reapply the adjustment instead of overwriting the sale.

## Orders, bundles, and inventory

Order totals, automatic fixed/percentage set savings, promo discounts, shipping, and product prices are calculated again on the server. Each order requires `paymentMethod: "manual_confirmation"` and an `Idempotency-Key` of 8–128 safe characters. Reusing a key with the same body returns the original order; reusing it with a different body returns `IDEMPOTENCY_CONFLICT`.

The canonical bundle payload is:

```json
{
  "bundleMetadata": [{
    "bundleId": "two-step",
    "selections": [
      {"stepId": "cleanse", "productIds": ["champion-soap"]},
      {"stepId": "layer", "productIds": ["body-cream"]}
    ]
  }]
}
```

Pending manual-payment orders reserve stock until `ORDER_RESERVATION_MINUTES`. Run the release job frequently so abandoned orders cannot hold stock indefinitely:

Customer receipt files are stored in `PAYMENT_RECEIPT_DIR`, which must remain outside the public document root and use mode `0700`. The customer receives only receipt metadata; staff download the file through the authenticated API. The backup command includes a separate private receipts archive.

```cron
*/5 * * * * RNCO_ENV_FILE=/home/rncomy/3rnco_shared/.env /usr/local/bin/php /home/rncomy/3rnco_app/current/scripts/release-expired-orders.php >/dev/null 2>&1
```

The job locks and rechecks each order, restores inventory and promo usage exactly once, and marks the order cancelled. It exits nonzero on failure. `--limit=1000` is the maximum optional batch size.

Run session/rate-limit cleanup hourly:

```cron
17 * * * * RNCO_ENV_FILE=/home/rncomy/3rnco_shared/.env /usr/local/bin/php /home/rncomy/3rnco_app/current/scripts/cleanup.php >/dev/null 2>&1
```

This removes expired sessions, revoked sessions after seven days, and rate-limit buckets idle for two days. The command is idempotent and exits nonzero on failure.

## Uploads

The upload endpoint accepts JPEG, PNG, or WebP only. It verifies MIME type and raster dimensions, rejects files larger than `UPLOAD_MAX_BYTES`, generates a random storage name, and never accepts SVG. Product and slide image references accept only same-origin `/images/` or `/uploads/` paths, or HTTPS URLs. Instagram and Facebook settings require HTTPS links on their expected domains.

Expose the private upload directory through a narrowly scoped symlink or equivalent web-server mapping at `/uploads`; do not expose the shared directory itself.

## Backups

Run the private backup command daily after first verifying `BACKUP_DIR` is outside the document root:

```cron
25 3 * * * RNCO_ENV_FILE=/home/rncomy/3rnco_shared/.env /usr/local/bin/php /home/rncomy/3rnco_app/current/scripts/backup.php >>/home/rncomy/3rnco_shared/backup.log 2>&1
```

It writes a gzipped `mysqldump`, a gzipped uploads archive, and a SHA-256 manifest. A non-blocking lock prevents overlapping runs. Retention keeps one set for each of the latest seven days plus one set for each of the latest four ISO weeks. The command removes an incomplete set and exits nonzero on any failure. Test restoration to an isolated database regularly; a successful backup command is not itself a restore test.

## Local SQLite verification

The test configuration is represented by `config/local.example.php`. The automated suite creates a fresh temporary SQLite database, applies the SQLite migration twice, seeds twice, and exercises the API:

```sh
php server/php/tests/run.php
```

Lint all PHP sources with:

```sh
find server/php -name '*.php' -print0 | xargs -0 -n1 php -l
```

For a manual local API, create a private `.env` with `APP_ENV=local`, `DB_DRIVER=sqlite`, `DB_DATABASE` pointing to `runtime/local.sqlite`, `SESSION_COOKIE_SECURE=0`, and an `APP_ORIGIN` matching the local browser. Then run `scripts/migrate.php --seed` and serve `public/` with PHP's local server. Never reuse that configuration in production.
