import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const seedSource = await readFile(
  new URL("../worker/seed.ts", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL("../drizzle/0000_rare_kabuki.sql", import.meta.url),
  "utf8",
);
const atomicCommerceMigration = await readFile(
  new URL("../drizzle/0002_atomic_commerce.sql", import.meta.url),
  "utf8",
);
const atomicCommerceTriggers = await readFile(
  new URL("../worker/atomic-commerce-triggers.sql", import.meta.url),
  "utf8",
);

test("production seed preserves the approved current storefront content", () => {
  for (const [id, priceMinor] of [
    ["body-cream", 6900],
    ["champion-soap", 5700],
    ["tree-body-oil", 13800],
    ["tree-body-oil-travel", 4900],
  ]) {
    assert.match(
      seedSource,
      new RegExp(`id: "${id}"[\\s\\S]*?priceMinor: ${priceMinor}`, "u"),
    );
  }
  assert.match(seedSource, /body-cream-texture-v4\.webp/u);
  assert.match(
    seedSource,
    /image: "\/images\/campaign\/story-care\.webp"[\s\S]*?title: "Care began"[\s\S]*?emphasis: "at home\."/u,
  );
  assert.match(
    seedSource,
    /image: "\/images\/generated-v3\/slider-botanical-leaf-v3\.webp"[\s\S]*?title: "From moringa,"[\s\S]*?emphasis: "care takes root\."/u,
  );
  assert.match(seedSource, /title: "Rooted in"[\s\S]*?emphasis: "moringa\."/u);
  assert.match(seedSource, /'support@3rnco\.com\.my'/u);
  assert.match(seedSource, /'\+60177816398'/u);
  assert.match(seedSource, /'https:\/\/www\.instagram\.com\/3rnco'/u);
  assert.match(
    seedSource,
    /'https:\/\/www\.facebook\.com\/officially3randco\/'/u,
  );
  assert.match(seedSource, /VALUES \(\?, 'location-main', 0, 0, 0\)/u);
  assert.match(seedSource, /'gift-set'.*?'Build a gift set'/su);
  assert.match(
    seedSource,
    /'gift-set-carry'.*?'variant-tree-body-oil-travel'/su,
  );
  assert.doesNotMatch(
    seedSource,
    /#3R-108[0-7]|ROOTED10|Aina Rahman|example\.test/u,
  );
});

test("migrations contain production tables and atomic commerce enforcement", () => {
  for (const table of [
    "users",
    "user_sessions",
    "customer_profiles",
    "products",
    "slides",
    "bundles",
    "orders",
    "admin_audit_logs",
  ]) {
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`", "u"));
  }
  assert.match(
    atomicCommerceMigration,
    /CREATE TABLE IF NOT EXISTS `inventory_stock_updates`/u,
  );
  assert.doesNotMatch(atomicCommerceMigration, /CREATE TRIGGER/u);
  assert.match(
    atomicCommerceTriggers,
    /CREATE TRIGGER `trg_order_items_reserve_inventory`/u,
  );
  assert.match(atomicCommerceTriggers, /RAISE\(ABORT, 'INSUFFICIENT_STOCK'\)/u);
  assert.match(
    atomicCommerceTriggers,
    /CREATE TRIGGER `trg_orders_validate_transition`/u,
  );
  assert.match(
    atomicCommerceTriggers,
    /CREATE TRIGGER `trg_promotion_redemptions_limits`/u,
  );
  assert.match(atomicCommerceTriggers, /RAISE\(ABORT, 'INVENTORY_CHANGED'\)/u);
});
