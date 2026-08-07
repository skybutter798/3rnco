# 3R&Co Production Store

The 3R&Co Malaysia storefront, customer account area and protected commerce admin. The existing earth-toned landing page, product stories, moringa sliders, gallery and official support/social links remain the public experience; operational data is now persisted by a server-side API.

## Production capabilities

- Editable products, stock, pricing, imagery and long-form product stories
- Editable landing sliders, store contact/delivery settings and promo rules
- Admin-configured multi-product options for **Build the two-step set**
- Customer registration, login, profile, password rotation, addresses and order history
- Server-calculated MYR totals, inventory checks, promos and idempotent order creation
- Admin orders, customers, enquiries, CSV export and live zero-based dashboard metrics
- Secure cookie sessions, CSRF protection, rate limiting, password hashing and upload validation
- MySQL 5.7-compatible PHP 8.3 API for the current cPanel host
- D1/R2-compatible Worker API for OpenAI Sites

The initial production seed contains the four current products, three current sliders, landing gallery, official contact settings and the two-step set. Inventory starts at zero. Customers, orders, promo codes and enquiries start empty.

## Local development

Node.js `>=22.13.0` is required.

```bash
npm install
npm run dev
```

The PHP API has its own environment template, migration command and test runner in `server/php/README.md`.

## Verification

```bash
npm run lint
npx tsc --noEmit
npm test
php server/php/tests/run.php
```

## Administration

Open the Admin portal from the storefront. The one-time bootstrap account is username `admin` with password `88888888`. Store mutations remain locked until that temporary password is changed in **Store Settings**, and use of the known temporary credential is restricted to the configured owner IPs.

Never commit a production `.env`, database password, application key, session token or backup archive. See `docs/production.md` for the deployment, backup and rollback runbook.
