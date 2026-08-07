# 3R&Co production runbook

## Runtime layout

The public storefront remains a static Vinext export. Browser requests to `/api/v1/*` are routed by Apache to the PHP 8.3 API, which stores production data in the account-scoped MySQL database.

```text
/home/rncomy/public_html                 current static release and api/index.php
/home/rncomy/3rnco_app/current          symlink to the active PHP application release
/home/rncomy/3rnco_app/releases/*       immutable PHP application releases
/home/rncomy/3rnco_shared/.env          private production configuration, mode 0600
/home/rncomy/3rnco_shared/uploads       persistent validated product/slider images
/home/rncomy/backups/3rnco              retained local database/upload backups
```

`public_html/uploads` is a same-owner symlink to the shared upload directory. Executable file types are denied there. No application secret or database credential belongs under `public_html`.

## Initial data

Use a newly created, empty production database for the first release. The idempotent seed is additive and never deletes existing business records; it is not a reset command. It creates only:

- the four current products with inventory `0`;
- the three current landing sliders and current social gallery;
- the official support email, WhatsApp, Instagram and Facebook settings;
- the configurable **Build the two-step set** definition;
- the bootstrap administrator.

Orders, customers, promo codes and enquiries remain empty in that fresh database. Verify those exact zero counts before cutover. The bootstrap administrator is `admin` / `88888888`; every admin mutation is blocked until the password is changed in **Store Settings**. While that known temporary password is active, login and password change are also restricted to the exact deployment-owner IPs in `BOOTSTRAP_ADMIN_IPS`.

## Private environment

Copy `server/php/.env.example` to `/home/rncomy/3rnco_shared/.env`, replace every placeholder and set mode `0600`. Production requires HTTPS, a random application key of at least 32 characters and a least-privilege MySQL user restricted to this one database and localhost.

Never place raw card details, online-banking credentials or customer passwords in the database. The current checkout records `manual_confirmation` orders only.

## Build and package

From a clean source checkout on Node.js 22 or newer:

```powershell
npm ci
npm run lint
npx tsc --noEmit
npm test
php server/php/tests/run.php
powershell -ExecutionPolicy Bypass -File scripts/build-cpanel-package.ps1
```

The packaging script creates `public-html.tar.gz`, `application.tar.gz` and `shared-uploads.tar.gz` under a timestamped ignored `artifacts/` directory. The third archive contains only upload-directory hardening, not uploaded media. No archive includes populated `.env` files, runtime databases, customer uploads or backups.

## Release sequence

1. Confirm local, GitHub and live source parity and record the target Git commit.
2. Create a timestamped tar backup of the current document root and download a copy off-host.
3. Upload and extract the application archive into a new immutable application release.
4. Extract `shared-uploads.tar.gz` into the persistent shared upload directory, verify its executable-deny `.htaccess`, preserve `.well-known`, create the public upload symlink and verify ownership before cutover.
5. Run `php scripts/migrate.php --seed` against the private production environment.
6. Verify the clean-table counts and confirm the bootstrap password is stored only as a password hash.
7. Extract the static archive into a new document-root directory, run PHP syntax checks and Apache configuration checks, then atomically swap the document root.
8. Smoke-test the public page, API health/storefront, protected admin, CSRF rejection, zero-inventory order rejection and official contact links.
9. Run the backup command once, download that first database backup off-host and install the operational crons below.

Example cPanel cron entries (adjust the PHP binary path if the host changes):

```cron
*/5 * * * * RNCO_ENV_FILE=/home/rncomy/3rnco_shared/.env /usr/local/bin/php /home/rncomy/3rnco_app/current/scripts/release-expired-orders.php >/dev/null 2>&1
17 * * * * RNCO_ENV_FILE=/home/rncomy/3rnco_shared/.env /usr/local/bin/php /home/rncomy/3rnco_app/current/scripts/cleanup.php >/dev/null 2>&1
17 3 * * * RNCO_ENV_FILE=/home/rncomy/3rnco_shared/.env /usr/local/bin/php /home/rncomy/3rnco_app/current/scripts/backup.php >/dev/null 2>&1
```

The five-minute job releases expired pending-order inventory reservations. The hourly job removes expired/revoked sessions and stale rate-limit buckets. The daily job keeps the documented server-local database/upload retention set; pull its first successful output off-host immediately.

Do not manufacture inventory to make checkout appear available. A store operator must enter the real quantities under **Admin → Products**.

## Backup and restore

The application backup command dumps the database and archives persistent uploads without writing credentials into the archive. Local retention is seven daily and four weekly copies. The server-local copy is not disaster recovery; send or pull backups to a separately administered off-host destination.

To restore, place the storefront in maintenance, restore the matching database dump and upload archive, point `3rnco_app/current` to the matching application release, replace `public_html` with the matching static release, then repeat every smoke test before reopening orders.

## Platform risks

The current host runs an end-of-life CentOS 7/cPanel generation and MySQL 5.7. Port 3306 is also reachable publicly at the server level. The application user is localhost-only, but long-term production should move to a supported AlmaLinux/cPanel and MySQL 8 or MariaDB platform. Coordinate any firewall or MySQL bind-address change with the owner because it can affect other accounts on the server.

The domain currently accepts `support@3rnco.com.my` through the account catch-all. Create or verify a dedicated mailbox/forwarder before using email as a formal support SLA.
