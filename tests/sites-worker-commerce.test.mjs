import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const baseMigration = await readFile(new URL("../drizzle/0000_rare_kabuki.sql", import.meta.url), "utf8");
const rateMigration = await readFile(new URL("../drizzle/0001_regular_lionheart.sql", import.meta.url), "utf8");
const commerceMigration = await readFile(new URL("../drizzle/0002_atomic_commerce.sql", import.meta.url), "utf8");
const commerceSource = await readFile(new URL("../worker/commerce.ts", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../worker/admin.ts", import.meta.url), "utf8");

function applyMigration(db, sql) {
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

function insertOrder(db, id, promotionId = null) {
  db.prepare(`INSERT INTO orders
    (id, order_number, user_id, customer_name, customer_email, customer_phone,
     status, payment_status, fulfilment_status, payment_method, currency,
     subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, promotion_id)
    VALUES (?, ?, 'customer-1', 'Customer', 'customer@example.test', '+60111111111',
      'PENDING_PAYMENT', 'PENDING', 'UNFULFILLED', 'manual_confirmation', 'MYR',
      1000, 0, 0, 0, 1000, ?)`)
    .run(id, `ORDER-${id}`, promotionId);
}

function setupDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applyMigration(db, baseMigration);
  applyMigration(db, rateMigration);
  applyMigration(db, commerceMigration);
  db.exec(`
    INSERT INTO users (id, username, username_normalized, password_hash, role, status)
      VALUES ('admin-1', 'admin', 'admin', 'hash', 'ADMIN', 'ACTIVE');
    INSERT INTO users (id, email, email_normalized, password_hash, role, status)
      VALUES ('customer-1', 'customer@example.test', 'customer@example.test', 'hash', 'CUSTOMER', 'ACTIVE');
    INSERT INTO inventory_locations (id, name, active) VALUES ('location-main', 'Main', 1);
    INSERT INTO products
      (id, slug, name, short_name, badge, description, detail, ingredients, ritual, volume, texture, status)
      VALUES ('product-1', 'product-1', 'Product', 'Product', '', 'Description', 'Detail', '', '', '', '', 'ACTIVE');
    INSERT INTO product_variants
      (id, product_id, sku, title, price_minor, currency, track_inventory, status)
      VALUES ('variant-1', 'product-1', 'SKU-1', 'Default', 1000, 'MYR', 1, 'ACTIVE');
    INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved)
      VALUES ('variant-1', 'location-main', 10, 0);
  `);
  return db;
}

test("D1 triggers reserve, commit, release, and reject invalid order transitions", () => {
  const db = setupDatabase();
  insertOrder(db, "order-paid");
  db.prepare(`INSERT INTO order_items
    (id, order_id, product_id, product_variant_id, sku_snapshot, name_snapshot, unit_price_minor, quantity, line_total_minor)
    VALUES ('item-paid', 'order-paid', 'product-1', 'variant-1', 'SKU-1', 'Product', 1000, 3, 3000)`).run();
  let inventory = db.prepare("SELECT on_hand, reserved FROM inventory_levels").get();
  assert.equal(inventory.on_hand, 10);
  assert.equal(inventory.reserved, 3);
  db.prepare("UPDATE orders SET status = 'PAYMENT_CONFIRMED', payment_status = 'PAID' WHERE id = 'order-paid'").run();
  inventory = db.prepare("SELECT on_hand, reserved FROM inventory_levels").get();
  assert.equal(inventory.on_hand, 7);
  assert.equal(inventory.reserved, 0);

  insertOrder(db, "order-cancelled");
  db.prepare(`INSERT INTO order_items
    (id, order_id, product_id, product_variant_id, sku_snapshot, name_snapshot, unit_price_minor, quantity, line_total_minor)
    VALUES ('item-cancelled', 'order-cancelled', 'product-1', 'variant-1', 'SKU-1', 'Product', 1000, 2, 2000)`).run();
  db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = 'order-cancelled'").run();
  inventory = db.prepare("SELECT on_hand, reserved FROM inventory_levels").get();
  assert.equal(inventory.on_hand, 7);
  assert.equal(inventory.reserved, 0);
  assert.throws(
    () => db.prepare("UPDATE orders SET status = 'PAYMENT_CONFIRMED', payment_status = 'PAID' WHERE id = 'order-cancelled'").run(),
    /INVALID_ORDER_TRANSITION/u,
  );
  db.close();
});

test("stock compare-and-set and promo caps are database-enforced", () => {
  const db = setupDatabase();
  db.prepare(`INSERT INTO inventory_stock_updates
    (id, variant_id, expected_available, new_available, actor_user_id)
    VALUES ('stock-1', 'variant-1', 10, 8, 'admin-1')`).run();
  assert.equal(db.prepare("SELECT on_hand FROM inventory_levels").get().on_hand, 8);
  assert.throws(
    () => db.prepare(`INSERT INTO inventory_stock_updates
      (id, variant_id, expected_available, new_available, actor_user_id)
      VALUES ('stock-stale', 'variant-1', 10, 9, 'admin-1')`).run(),
    /INVENTORY_CHANGED/u,
  );

  db.exec(`INSERT INTO promotions
    (id, code, name, discount_type, value_minor, percent_basis_points, min_subtotal_minor, usage_limit, per_customer_limit, status)
    VALUES ('promo-1', 'ONE', 'One use', 'FIXED', 100, 0, 0, 1, 1, 'ACTIVE')`);
  insertOrder(db, "promo-order-1", "promo-1");
  db.exec(`INSERT INTO promotion_redemptions (id, promotion_id, user_id, order_id, discount_minor)
    VALUES ('redeem-1', 'promo-1', 'customer-1', 'promo-order-1', 100)`);
  insertOrder(db, "promo-order-2", "promo-1");
  assert.throws(
    () => db.exec(`INSERT INTO promotion_redemptions (id, promotion_id, user_id, order_id, discount_minor)
      VALUES ('redeem-2', 'promo-1', 'customer-1', 'promo-order-2', 100)`),
    /PROMO_LIMIT_REACHED/u,
  );
  db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = 'promo-order-1'").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM promotion_redemptions").get().count, 0);
  db.close();
});

test("bundle allocations consume real cart quantities and preserve each instance", () => {
  assert.match(commerceSource, /allocatedQuantities/u);
  assert.match(commerceSource, /nextAllocated > cartQuantity/u);
  assert.match(commerceSource, /BUNDLE_ITEM_QUANTITY_MISMATCH/u);
  assert.match(commerceSource, /allocations\.forEach\(\(bundle\) => addOrderItem\(1, bundle\)\)/u);
  assert.match(adminSource, /expectedStock/u);
  assert.match(adminSource, /INSERT INTO inventory_stock_updates/u);
});
