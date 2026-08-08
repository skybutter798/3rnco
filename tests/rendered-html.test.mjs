import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the current 3R&Co storefront", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>3R&amp;Co Malaysia \| Moringa Body Oil &amp; Body Care<\/title>/i,
  );
  assert.match(html, /rel="canonical" href="https:\/\/3rnco\.com\.my\/?"/i);
  assert.match(
    html,
    /property="og:image" content="https:\/\/3rnco\.com\.my\/og-3rnco-moringa-1200x630\.jpg"/i,
  );
  assert.match(html, /property="og:image:width" content="1200"/i);
  assert.match(html, /property="og:image:height" content="630"/i);
  assert.match(html, /aria-label="Mobile app navigation"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
  assert.match(html, /application\/ld\+json/i);
  assert.match(html, /From moringa,/);
  assert.match(html, /care takes root\./);
  assert.match(html, /Care began/);
  assert.match(html, /at home\./);
  assert.match(html, /\/images\/moringa-slider\/moringa-product-ritual\.webp/);
  assert.match(html, /Body Cream/);
  assert.match(html, /Champion Soap Bar/);
  assert.match(html, /Tree Body Oil/);
  assert.match(html, /support@3rnco\.com\.my/);
  assert.match(html, /\+60 17-781 6398/);
  assert.doesNotMatch(
    html,
    /codex-preview|react-loading-skeleton|Your site is taking shape/i,
  );
});

test("includes persistent production commerce and clean seed contracts", async () => {
  const [
    page,
    account,
    admin,
    bundle,
    api,
    layout,
    css,
    productionCss,
    packageJson,
    phpSeeder,
    mysqlSchema,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/AccountDialog.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/AdminDashboard.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/BundleBuilder.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/production.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../server/php/src/Seeder.php", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../server/php/database/migrations/mysql/001_schema.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.equal((page.match(/stock:\s*0/g) || []).length, 4);
  assert.match(page, /Idempotency-Key/);
  assert.match(page, /orderAttemptRef/);
  assert.match(page, /fingerprint\s*=\s*JSON\.stringify\(orderBody\)/);
  assert.match(page, /paymentMethod:\s*"manual_confirmation"/);
  assert.match(page, /AdminDashboard/);
  assert.match(page, /AccountDialog/);
  assert.match(page, /BundleBuilder/);
  assert.match(page, /bundleMetadata/);
  assert.match(page, /fallbackGiftBundle/);
  assert.match(page, /bundleDiscount/);
  assert.doesNotMatch(page, /Open admin portal/);
  assert.doesNotMatch(page, />Admin portal</);
  assert.doesNotMatch(
    page,
    /data\.(?:products|slides|gallery|bundles)\?\.length/,
  );
  assert.match(page, /https:\/\/wa\.me\/\$\{settings\.whatsappNumber\}/);
  assert.match(page, /facebook\.com\/officially3randco/);
  assert.match(page, /instagram\.com\/3rnco/);
  assert.match(account, /\/auth\/register/);
  assert.match(account, /\/auth\/change-password/);
  assert.match(account, /minLength=\{8\}/);
  assert.match(account, /Capitals,\s+numbers and symbols are\s+optional/);
  assert.match(account, /\/profile\/addresses/);
  assert.match(admin, /Gift & ritual set builder/);
  assert.match(admin, /Fixed amount \(RM\)/);
  assert.match(admin, /Percentage \(%\)/);
  assert.match(admin, /Store Settings/);
  assert.match(admin, /Top announcement/);
  assert.match(admin, /top-note-editor__preview/);
  assert.match(admin, /Storefront controls/);
  assert.match(admin, /Change password & unlock/);
  assert.match(admin, /expectedStock/);
  assert.match(admin, /INVENTORY_CHANGED/);
  assert.match(admin, /Total use limit/);
  assert.match(admin, /Internal note only/);
  assert.doesNotMatch(admin, />Send reply</);
  assert.match(bundle, /unavailable/i);
  assert.match(bundle, /set saving/i);
  assert.match(api, /X-CSRF-Token/);
  assert.match(api, /credentials:\s*"same-origin"/);
  assert.match(phpSeeder, /passwordHash\('88888888'\)/);
  assert.match(phpSeeder, /'stock_quantity'\s*=>\s*0/);
  assert.match(mysqlSchema, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(mysqlSchema, /CREATE TABLE IF NOT EXISTS orders/);
  assert.match(mysqlSchema, /UNIQUE KEY uq_orders_customer_idempotency/);
  for (const source of [page, account, admin, bundle, phpSeeder]) {
    assert.doesNotMatch(
      source,
      /ROOTED10|WELCOME15|TRAVELDUO|CARE15|HELLOSHIP|SLOW20|example\.test|Place demo order|commerce simulation/i,
    );
  }
  assert.match(layout, /export const metadata/);
  assert.match(layout, /\/og-3rnco-moringa-1200x630\.jpg/);
  assert.match(layout, /width:\s*1200/);
  assert.match(layout, /height:\s*630/);
  assert.match(layout, /alternates:/);
  assert.match(layout, /googleBot:/);
  assert.match(layout, /structuredData/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /\.mobile-app-nav/);
  assert.match(css, /\.site-header--solid\s*\{[^}]*top:\s*0;/s);
  assert.match(productionCss, /\.admin-control-grid/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(packageJson, /cross-env WRANGLER_LOG_PATH/);
});
