import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
};

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username"),
  usernameNormalized: text("username_normalized"),
  email: text("email"),
  emailNormalized: text("email_normalized"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  emailVerifiedAt: integer("email_verified_at"),
  passwordChangedAt: integer("password_changed_at"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: integer("locked_until"),
  lastLoginAt: integer("last_login_at"),
  deletedAt: integer("deleted_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("uq_users_username_normalized").on(table.usernameNormalized),
  uniqueIndex("uq_users_email_normalized").on(table.emailNormalized),
  index("idx_users_role_status").on(table.role, table.status),
  check("ck_users_role", sql`${table.role} in ('ADMIN', 'CUSTOMER')`),
  check("ck_users_status", sql`${table.status} in ('ACTIVE', 'DISABLED', 'LOCKED')`),
]);

export const userSessions = sqliteTable("user_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  csrfTokenHash: text("csrf_token_hash").notNull(),
  userAgentHash: text("user_agent_hash"),
  ipPrefixHash: text("ip_prefix_hash"),
  lastSeenAt: integer("last_seen_at").notNull(),
  idleExpiresAt: integer("idle_expires_at").notNull(),
  absoluteExpiresAt: integer("absolute_expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("uq_user_sessions_token_hash").on(table.tokenHash),
  index("idx_user_sessions_user_active").on(table.userId, table.revokedAt),
  index("idx_user_sessions_expiry").on(table.absoluteExpiresAt),
]);

export const authTokens = sqliteTable("auth_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("uq_auth_tokens_token_hash").on(table.tokenHash),
  index("idx_auth_tokens_user_type").on(table.userId, table.type),
]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  windowStartedAt: integer("window_started_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  blockedUntil: integer("blocked_until"),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [index("idx_auth_rate_limits_expiry").on(table.blockedUntil, table.updatedAt)]);

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  storageProvider: text("storage_provider").notNull(),
  storageKey: text("storage_key").notNull(),
  publicUrl: text("public_url").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  sha256: text("sha256"),
  altText: text("alt_text").notNull().default(""),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("uq_media_storage_key").on(table.storageProvider, table.storageKey),
  index("idx_media_created_at").on(table.createdAt),
]);

export const customerProfiles = sqliteTable("customer_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  phoneE164: text("phone_e164"),
  birthDate: text("birth_date"),
  preferredLanguage: text("preferred_language").notNull().default("en"),
  avatarMediaId: text("avatar_media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  marketingConsent: integer("marketing_consent", { mode: "boolean" }).notNull().default(false),
  marketingConsentSource: text("marketing_consent_source"),
  marketingConsentAt: integer("marketing_consent_at"),
  ...timestamps,
}, (table) => [index("idx_customer_profiles_phone").on(table.phoneE164)]);

export const customerAddresses = sqliteTable("customer_addresses", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("Home"),
  recipientName: text("recipient_name").notNull(),
  phoneE164: text("phone_e164").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postcode: text("postcode").notNull(),
  countryCode: text("country_code").notNull().default("MY"),
  isDefaultShipping: integer("is_default_shipping", { mode: "boolean" }).notNull().default(false),
  isDefaultBilling: integer("is_default_billing", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [index("idx_customer_addresses_user").on(table.userId)]);

export const storeSettings = sqliteTable("store_settings", {
  id: text("id").primaryKey(),
  brandName: text("brand_name").notNull(),
  tagline: text("tagline").notNull(),
  supportEmail: text("support_email").notNull(),
  whatsappE164: text("whatsapp_e164").notNull(),
  whatsappDisplay: text("whatsapp_display").notNull(),
  announcement: text("announcement").notNull().default(""),
  currency: text("currency").notNull().default("MYR"),
  country: text("country").notNull().default("Malaysia"),
  shippingFeeMinor: integer("shipping_fee_minor").notNull().default(0),
  freeShippingThresholdMinor: integer("free_shipping_threshold_minor").notNull().default(0),
  seoTitle: text("seo_title").notNull(),
  seoDescription: text("seo_description").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

export const socialLinks = sqliteTable("social_links", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  handle: text("handle"),
  url: text("url").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (table) => [uniqueIndex("uq_social_links_platform").on(table.platform)]);

export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("PUBLISHED"),
  ...timestamps,
}, (table) => [uniqueIndex("uq_pages_slug").on(table.slug)]);

export const pageSections = sqliteTable("page_sections", {
  id: text("id").primaryKey(),
  pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  sectionKey: text("section_key").notNull(),
  sectionType: text("section_type").notNull(),
  eyebrow: text("eyebrow"),
  heading: text("heading"),
  body: text("body"),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  mediaId: text("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  visible: integer("visible", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("uq_page_sections_key").on(table.pageId, table.sectionKey),
  index("idx_page_sections_public").on(table.pageId, table.visible, table.sortOrder),
]);

export const sectionBlocks = sqliteTable("section_blocks", {
  id: text("id").primaryKey(),
  sectionId: text("section_id").notNull().references(() => pageSections.id, { onDelete: "cascade" }),
  blockType: text("block_type").notNull(),
  eyebrow: text("eyebrow"),
  heading: text("heading"),
  body: text("body"),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  mediaId: text("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  visible: integer("visible", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (table) => [index("idx_section_blocks_section").on(table.sectionId, table.sortOrder)]);

export const sliders = sqliteTable("sliders", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex("uq_sliders_slug").on(table.slug)]);

export const slides = sqliteTable("slides", {
  id: text("id").primaryKey(),
  sliderId: text("slider_id").notNull().references(() => sliders.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  mediaId: text("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  eyebrow: text("eyebrow").notNull(),
  title: text("title").notNull(),
  emphasis: text("emphasis").notNull(),
  copy: text("copy").notNull(),
  caption: text("caption").notNull(),
  tone: text("tone").notNull().default("light"),
  position: text("position").notNull().default("center"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [index("idx_slides_slider_public").on(table.sliderId, table.enabled, table.sortOrder)]);

export const galleryItems = sqliteTable("gallery_items", {
  id: text("id").primaryKey(),
  imageUrl: text("image_url").notNull(),
  mediaId: text("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  altText: text("alt_text").notNull(),
  caption: text("caption").notNull(),
  href: text("href").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (table) => [index("idx_gallery_public").on(table.enabled, table.sortOrder)]);

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  badge: text("badge").notNull(),
  description: text("description").notNull(),
  detail: text("detail").notNull(),
  ingredients: text("ingredients").notNull(),
  ritual: text("ritual").notNull(),
  volume: text("volume").notNull(),
  texture: text("texture").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("uq_products_slug").on(table.slug),
  index("idx_products_public").on(table.status, table.sortOrder),
]);

export const productVariants = sqliteTable("product_variants", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  sku: text("sku").notNull(),
  title: text("title").notNull().default("Default"),
  priceMinor: integer("price_minor").notNull(),
  compareAtMinor: integer("compare_at_minor"),
  currency: text("currency").notNull().default("MYR"),
  trackInventory: integer("track_inventory", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull().default("ACTIVE"),
  ...timestamps,
}, (table) => [
  uniqueIndex("uq_product_variants_sku").on(table.sku),
  index("idx_product_variants_product").on(table.productId, table.status),
  check("ck_product_variants_price", sql`${table.priceMinor} >= 0`),
]);

export const productBenefits = sqliteTable("product_benefits", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  benefit: text("benefit").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [index("idx_product_benefits_product").on(table.productId, table.sortOrder)]);

export const productMedia = sqliteTable("product_media", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  mediaId: text("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  usage: text("usage").notNull(),
  imageUrl: text("image_url").notNull(),
  altText: text("alt_text").notNull(),
  eyebrow: text("eyebrow"),
  title: text("title"),
  copy: text("copy"),
  position: text("position").notNull().default("center"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [index("idx_product_media_product_usage").on(table.productId, table.usage, table.sortOrder)]);

export const inventoryLocations = sqliteTable("inventory_locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

export const inventoryLevels = sqliteTable("inventory_levels", {
  variantId: text("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "cascade" }),
  onHand: integer("on_hand").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  reorderThreshold: integer("reorder_threshold").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  primaryKey({ columns: [table.variantId, table.locationId] }),
  check("ck_inventory_nonnegative", sql`${table.onHand} >= 0 and ${table.reserved} >= 0`),
]);

export const inventoryStockUpdates = sqliteTable("inventory_stock_updates", {
  id: text("id").primaryKey(),
  variantId: text("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  expectedAvailable: integer("expected_available").notNull(),
  newAvailable: integer("new_available").notNull(),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [index("idx_inventory_stock_updates_variant").on(table.variantId, table.createdAt)]);

export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(),
  variantId: text("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  locationId: text("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  movementType: text("movement_type").notNull(),
  quantityDelta: integer("quantity_delta").notNull(),
  reason: text("reason").notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [index("idx_inventory_movements_variant").on(table.variantId, table.createdAt)]);

export const bundles = sqliteTable("bundles", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull().default(""),
  ctaLabel: text("cta_label").notNull(),
  description: text("description").notNull(),
  selectionMode: text("selection_mode").notNull().default("MIX_MATCH"),
  pricingMode: text("pricing_mode").notNull().default("SUM_ITEMS"),
  priceValueMinor: integer("price_value_minor"),
  status: text("status").notNull().default("ACTIVE"),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [uniqueIndex("uq_bundles_slug").on(table.slug)]);

export const bundleSteps = sqliteTable("bundle_steps", {
  id: text("id").primaryKey(),
  bundleId: text("bundle_id").notNull().references(() => bundles.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  minSelections: integer("min_selections").notNull().default(1),
  maxSelections: integer("max_selections").notNull().default(1),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("uq_bundle_steps_number").on(table.bundleId, table.stepNumber),
  index("idx_bundle_steps_bundle").on(table.bundleId, table.sortOrder),
]);

export const bundleStepOptions = sqliteTable("bundle_step_options", {
  id: text("id").primaryKey(),
  stepId: text("step_id").notNull().references(() => bundleSteps.id, { onDelete: "cascade" }),
  productVariantId: text("product_variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  priceAdjustmentMinor: integer("price_adjustment_minor").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("uq_bundle_step_options_variant").on(table.stepId, table.productVariantId),
  index("idx_bundle_step_options_step").on(table.stepId, table.enabled, table.sortOrder),
]);

export const carts = sqliteTable("carts", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  anonymousTokenHash: text("anonymous_token_hash"),
  currency: text("currency").notNull().default("MYR"),
  promotionId: text("promotion_id"),
  expiresAt: integer("expires_at").notNull(),
  ...timestamps,
}, (table) => [index("idx_carts_user").on(table.userId, table.updatedAt)]);

export const cartItems = sqliteTable("cart_items", {
  id: text("id").primaryKey(),
  cartId: text("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
  productVariantId: text("product_variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  bundleId: text("bundle_id").references(() => bundles.id, { onDelete: "set null" }),
  bundleInstanceId: text("bundle_instance_id"),
  bundleStepId: text("bundle_step_id").references(() => bundleSteps.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_cart_items_cart").on(table.cartId),
  check("ck_cart_items_quantity", sql`${table.quantity} > 0`),
]);

export const promotions = sqliteTable("promotions", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  discountType: text("discount_type").notNull(),
  valueMinor: integer("value_minor").notNull().default(0),
  percentBasisPoints: integer("percent_basis_points").notNull().default(0),
  minSubtotalMinor: integer("min_subtotal_minor").notNull().default(0),
  maxDiscountMinor: integer("max_discount_minor"),
  usageLimit: integer("usage_limit"),
  perCustomerLimit: integer("per_customer_limit"),
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  status: text("status").notNull().default("ACTIVE"),
  ...timestamps,
}, (table) => [uniqueIndex("uq_promotions_code").on(table.code)]);

export const promotionProducts = sqliteTable("promotion_products", {
  promotionId: text("promotion_id").notNull().references(() => promotions.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.promotionId, table.productId] })]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  status: text("status").notNull().default("AWAITING_PAYMENT"),
  paymentStatus: text("payment_status").notNull().default("PENDING"),
  fulfilmentStatus: text("fulfilment_status").notNull().default("UNFULFILLED"),
  paymentMethod: text("payment_method").notNull(),
  currency: text("currency").notNull().default("MYR"),
  subtotalMinor: integer("subtotal_minor").notNull(),
  discountMinor: integer("discount_minor").notNull().default(0),
  shippingMinor: integer("shipping_minor").notNull().default(0),
  taxMinor: integer("tax_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull(),
  promotionId: text("promotion_id").references(() => promotions.id, { onDelete: "set null" }),
  placedAt: integer("placed_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("uq_orders_order_number").on(table.orderNumber),
  index("idx_orders_user_placed").on(table.userId, table.placedAt),
  index("idx_orders_status_placed").on(table.status, table.placedAt),
]);

export const orderAddresses = sqliteTable("order_addresses", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  addressType: text("address_type").notNull(),
  recipientName: text("recipient_name").notNull(),
  phoneE164: text("phone_e164").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postcode: text("postcode").notNull(),
  countryCode: text("country_code").notNull().default("MY"),
}, (table) => [uniqueIndex("uq_order_addresses_type").on(table.orderId, table.addressType)]);

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
  productVariantId: text("product_variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  skuSnapshot: text("sku_snapshot").notNull(),
  nameSnapshot: text("name_snapshot").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotalMinor: integer("line_total_minor").notNull(),
  bundleId: text("bundle_id").references(() => bundles.id, { onDelete: "set null" }),
  bundleInstanceId: text("bundle_instance_id"),
  bundleNameSnapshot: text("bundle_name_snapshot"),
  bundleStepNameSnapshot: text("bundle_step_name_snapshot"),
}, (table) => [index("idx_order_items_order").on(table.orderId)]);

export const orderAdjustments = sqliteTable("order_adjustments", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  adjustmentType: text("adjustment_type").notNull(),
  label: text("label").notNull(),
  amountMinor: integer("amount_minor").notNull(),
}, (table) => [index("idx_order_adjustments_order").on(table.orderId)]);

export const orderStatusHistory = sqliteTable("order_status_history", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),
  note: text("note"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [index("idx_order_status_history_order").on(table.orderId, table.createdAt)]);

export const promotionRedemptions = sqliteTable("promotion_redemptions", {
  id: text("id").primaryKey(),
  promotionId: text("promotion_id").notNull().references(() => promotions.id, { onDelete: "restrict" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  discountMinor: integer("discount_minor").notNull(),
  redeemedAt: integer("redeemed_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("uq_promotion_redemptions_order").on(table.orderId),
  index("idx_promotion_redemptions_user").on(table.promotionId, table.userId),
]);

export const paymentAttempts = sqliteTable("payment_attempts", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerReference: text("provider_reference"),
  amountMinor: integer("amount_minor").notNull(),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [index("idx_payment_attempts_order").on(table.orderId, table.createdAt)]);

export const enquiryThreads = sqliteTable("enquiry_threads", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  subject: text("subject").notNull(),
  status: text("status").notNull().default("NEW"),
  assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  lastMessageAt: integer("last_message_at").notNull().default(sql`(unixepoch())`),
  ...timestamps,
}, (table) => [index("idx_enquiry_threads_status").on(table.status, table.lastMessageAt)]);

export const enquiryMessages = sqliteTable("enquiry_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => enquiryThreads.id, { onDelete: "cascade" }),
  senderType: text("sender_type").notNull(),
  senderUserId: text("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [index("idx_enquiry_messages_thread").on(table.threadId, table.createdAt)]);

export const newsletterSubscribers = sqliteTable("newsletter_subscribers", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  emailNormalized: text("email_normalized").notNull(),
  status: text("status").notNull().default("SUBSCRIBED"),
  consentAt: integer("consent_at").notNull().default(sql`(unixepoch())`),
  unsubscribedAt: integer("unsubscribed_at"),
}, (table) => [uniqueIndex("uq_newsletter_email").on(table.emailNormalized)]);

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [index("idx_admin_audit_created").on(table.createdAt)]);

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  keyHash: text("key_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status"),
  responseJson: text("response_json"),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [index("idx_idempotency_expiry").on(table.expiresAt)]);
