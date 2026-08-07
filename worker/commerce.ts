import { getSession, requireCustomer, verifyCsrf } from "./auth";
import { normalizeEmail, normalizePhone, randomId, sha256 } from "./crypto";
import { ApiError, assertSameOrigin, integerField, ok, optionalString, readJson, requiredString } from "./http";
import { consumeRateLimit } from "./rate-limit";

type RequestedItem = { productId: string; quantity: number };
type PricedItem = RequestedItem & {
  variantId: string;
  sku: string;
  name: string;
  unitPriceMinor: number;
  stock: number;
};

type PromotionCalculation = {
  promotionId: string | null;
  code: string | null;
  discountMinor: number;
  freeShipping: boolean;
};

type BundleItemMetadata = {
  bundleId: string;
  bundleInstanceId: string;
  bundleName: string;
  stepName: string;
};

function parseItems(value: unknown): RequestedItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) {
    throw new ApiError(422, "VALIDATION_ERROR", "Add at least one product before continuing.", { items: "Add between 1 and 30 items." });
  }
  const byProduct = new Map<string, number>();
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Each order item must be valid.", { [`items.${index}`]: "Invalid item." });
    }
    const item = raw as Record<string, unknown>;
    const productId = requiredString(item.productId, `items.${index}.productId`, { min: 1, max: 100 });
    const quantity = integerField(item.quantity, `items.${index}.quantity`, { min: 1, max: 20 });
    byProduct.set(productId, (byProduct.get(productId) ?? 0) + quantity);
  });
  return [...byProduct.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

async function priceItems(db: D1Database, requested: RequestedItem[]): Promise<PricedItem[]> {
  const results = await db.batch(requested.map((item) => db.prepare(`SELECT
      p.id AS productId, p.name, v.id AS variantId, v.sku, v.price_minor AS unitPriceMinor,
      COALESCE(i.on_hand - i.reserved, 0) AS stock
    FROM products p
    JOIN product_variants v ON v.product_id = p.id AND v.status = 'ACTIVE'
    LEFT JOIN inventory_levels i ON i.variant_id = v.id AND i.location_id = 'location-main'
    WHERE p.id = ? AND p.status = 'ACTIVE' LIMIT 1`).bind(item.productId)));
  return requested.map((item, index) => {
    const row = results[index]?.results?.[0] as Omit<PricedItem, "quantity"> | undefined;
    if (!row) throw new ApiError(422, "PRODUCT_UNAVAILABLE", "A selected product is no longer available.", { items: item.productId });
    return { ...row, quantity: item.quantity };
  });
}

async function validateBundleMetadata(
  db: D1Database,
  value: unknown,
  requested: RequestedItem[],
): Promise<Map<string, BundleItemMetadata[]>> {
  const byProduct = new Map<string, BundleItemMetadata[]>();
  if (value === undefined || value === null) return byProduct;
  if (!Array.isArray(value) || value.length > 10) {
    throw new ApiError(422, "INVALID_BUNDLE_METADATA", "Bundle selections must be a valid list.");
  }
  const cartQuantities = new Map(requested.map((item) => [item.productId, item.quantity]));
  const allocatedQuantities = new Map<string, number>();
  for (let bundleIndex = 0; bundleIndex < value.length; bundleIndex += 1) {
    const rawBundle = value[bundleIndex];
    if (!rawBundle || typeof rawBundle !== "object" || Array.isArray(rawBundle)) {
      throw new ApiError(422, "INVALID_BUNDLE_METADATA", "Bundle selections must be valid.");
    }
    const bundleInput = rawBundle as Record<string, unknown>;
    const bundleId = requiredString(bundleInput.bundleId, `bundleMetadata.${bundleIndex}.bundleId`, { min: 1, max: 100 });
    const bundle = await db.prepare("SELECT id, name FROM bundles WHERE id = ? AND status = 'ACTIVE'")
      .bind(bundleId).first<{ id: string; name: string }>();
    if (!bundle) throw new ApiError(422, "BUNDLE_UNAVAILABLE", "A selected set is no longer available.");
    if (!Array.isArray(bundleInput.selections)) {
      throw new ApiError(422, "INVALID_BUNDLE_METADATA", "Each set must include its step selections.");
    }
    const configuredSteps = await db.prepare(`SELECT id, name, min_selections AS minSelections,
      max_selections AS maxSelections FROM bundle_steps WHERE bundle_id = ? ORDER BY sort_order`)
      .bind(bundleId).all<{ id: string; name: string; minSelections: number; maxSelections: number }>();
    const selections = bundleInput.selections as unknown[];
    if (selections.length !== configuredSteps.results.length) {
      throw new ApiError(422, "INCOMPLETE_BUNDLE", "Choose a product for every set step.");
    }
    const instanceId = randomId("bundle_instance");
    for (const configuredStep of configuredSteps.results) {
      const rawSelection = selections.find((selection) => Boolean(
        selection && typeof selection === "object" && !Array.isArray(selection) &&
        (selection as Record<string, unknown>).stepId === configuredStep.id,
      ));
      if (!rawSelection || typeof rawSelection !== "object" || Array.isArray(rawSelection)) {
        throw new ApiError(422, "INCOMPLETE_BUNDLE", `Choose a product for ${configuredStep.name}.`);
      }
      const productIdsRaw = (rawSelection as Record<string, unknown>).productIds;
      if (!Array.isArray(productIdsRaw)) throw new ApiError(422, "INVALID_BUNDLE_METADATA", "Step productIds must be a list.");
      const productIds = productIdsRaw.map((productId, productIndex) => requiredString(
        productId,
        `bundleMetadata.${bundleIndex}.selections.${configuredStep.id}.productIds.${productIndex}`,
        { min: 1, max: 100 },
      ));
      if (productIds.length < configuredStep.minSelections || productIds.length > configuredStep.maxSelections) {
        throw new ApiError(422, "INVALID_BUNDLE_SELECTION_COUNT", `Choose the required number of products for ${configuredStep.name}.`);
      }
      for (const productId of productIds) {
        const cartQuantity = cartQuantities.get(productId) ?? 0;
        if (!cartQuantity) throw new ApiError(422, "BUNDLE_ITEM_MISSING", `${productId} is not in the order items.`);
        const allowed = await db.prepare(`SELECT 1 AS found FROM bundle_step_options o
          JOIN product_variants v ON v.id = o.product_variant_id
          WHERE o.step_id = ? AND v.product_id = ? AND o.enabled = 1 LIMIT 1`)
          .bind(configuredStep.id, productId).first<{ found: number }>();
        if (!allowed) throw new ApiError(422, "BUNDLE_OPTION_UNAVAILABLE", `${productId} is not available for ${configuredStep.name}.`);
        const nextAllocated = (allocatedQuantities.get(productId) ?? 0) + 1;
        if (nextAllocated > cartQuantity) {
          throw new ApiError(422, "BUNDLE_ITEM_QUANTITY_MISMATCH", `${productId} needs another unit in the order items.`);
        }
        allocatedQuantities.set(productId, nextAllocated);
        const productAllocations = byProduct.get(productId) ?? [];
        productAllocations.push({
          bundleId,
          bundleInstanceId: instanceId,
          bundleName: bundle.name,
          stepName: configuredStep.name,
        });
        byProduct.set(productId, productAllocations);
      }
    }
  }
  return byProduct;
}

async function calculatePromotion(
  db: D1Database,
  codeValue: string | null,
  subtotalMinor: number,
  userId?: string,
): Promise<PromotionCalculation> {
  if (!codeValue) return { promotionId: null, code: null, discountMinor: 0, freeShipping: false };
  const code = codeValue.trim().toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  const promotion = await db.prepare(`SELECT id, code, discount_type AS discountType,
      value_minor AS valueMinor, percent_basis_points AS percentBasisPoints,
      min_subtotal_minor AS minSubtotalMinor, max_discount_minor AS maxDiscountMinor,
      usage_limit AS usageLimit, per_customer_limit AS perCustomerLimit
    FROM promotions
    WHERE code = ? AND status = 'ACTIVE'
      AND (starts_at IS NULL OR starts_at <= ?)
      AND (ends_at IS NULL OR ends_at > ?)
    LIMIT 1`).bind(code, now, now).first<{
      id: string; code: string; discountType: string; valueMinor: number; percentBasisPoints: number;
      minSubtotalMinor: number; maxDiscountMinor: number | null; usageLimit: number | null; perCustomerLimit: number | null;
    }>();
  if (!promotion) throw new ApiError(422, "PROMO_NOT_AVAILABLE", "That offer is not available.");
  if (subtotalMinor < promotion.minSubtotalMinor) {
    throw new ApiError(422, "PROMO_MINIMUM_NOT_MET", `Spend RM${(promotion.minSubtotalMinor / 100).toFixed(2)} to use this offer.`);
  }
  const totalUses = await db.prepare("SELECT COUNT(*) AS count FROM promotion_redemptions WHERE promotion_id = ?")
    .bind(promotion.id).first<{ count: number }>();
  if (promotion.usageLimit !== null && Number(totalUses?.count ?? 0) >= promotion.usageLimit) {
    throw new ApiError(422, "PROMO_LIMIT_REACHED", "That offer has reached its usage limit.");
  }
  if (userId && promotion.perCustomerLimit !== null) {
    const customerUses = await db.prepare("SELECT COUNT(*) AS count FROM promotion_redemptions WHERE promotion_id = ? AND user_id = ?")
      .bind(promotion.id, userId).first<{ count: number }>();
    if (Number(customerUses?.count ?? 0) >= promotion.perCustomerLimit) {
      throw new ApiError(422, "PROMO_CUSTOMER_LIMIT_REACHED", "You have already used this offer.");
    }
  }

  let discountMinor = 0;
  let freeShipping = false;
  if (promotion.discountType === "PERCENTAGE") {
    discountMinor = Math.floor(subtotalMinor * promotion.percentBasisPoints / 10_000);
  } else if (promotion.discountType === "FIXED") {
    discountMinor = promotion.valueMinor;
  } else if (promotion.discountType === "FREE_SHIPPING") {
    freeShipping = true;
  }
  if (promotion.maxDiscountMinor !== null) discountMinor = Math.min(discountMinor, promotion.maxDiscountMinor);
  discountMinor = Math.max(0, Math.min(subtotalMinor, discountMinor));
  return { promotionId: promotion.id, code: promotion.code, discountMinor, freeShipping };
}

async function shippingSettings(db: D1Database) {
  const settings = await db.prepare(`SELECT shipping_fee_minor AS shippingFeeMinor,
    free_shipping_threshold_minor AS thresholdMinor FROM store_settings WHERE id = 'default'`)
    .first<{ shippingFeeMinor: number; thresholdMinor: number }>();
  if (!settings) throw new ApiError(503, "SETTINGS_UNAVAILABLE", "Store settings are not available.");
  return settings;
}

export async function handlePromoValidation(request: Request, db: D1Database): Promise<Response> {
  assertSameOrigin(request);
  await consumeRateLimit(db, request, {
    bucket: "promo-validation", limit: 30, windowSeconds: 5 * 60,
    code: "PROMO_RATE_LIMITED", message: "Too many offer checks. Please wait and try again.",
  });
  const body = await readJson<Record<string, unknown>>(request);
  const code = requiredString(body.code, "code", { min: 1, max: 50 }).toUpperCase();
  const requested = parseItems(body.items);
  const priced = await priceItems(db, requested);
  const subtotalMinor = priced.reduce((total, item) => total + item.unitPriceMinor * item.quantity, 0);
  const session = await getSession(request, db);
  const promotion = await calculatePromotion(db, code, subtotalMinor, session?.user.role === "CUSTOMER" ? session.user.id : undefined);
  const settings = await shippingSettings(db);
  const standardShipping = subtotalMinor >= settings.thresholdMinor ? 0 : settings.shippingFeeMinor;
  return ok({
    valid: true,
    code: promotion.code,
    discount: promotion.discountMinor / 100,
    shipping: promotion.freeShipping ? 0 : standardShipping / 100,
    message: "A little care, added.",
  });
}

type ShippingAddress = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postcode: string;
  country: string;
};

function parseShippingAddress(value: unknown): ShippingAddress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Enter a shipping address.", { shippingAddress: "Required." });
  }
  const body = value as Record<string, unknown>;
  const postcode = requiredString(body.postcode, "shippingAddress.postcode", { min: 5, max: 5 });
  if (!/^\d{5}$/u.test(postcode)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Enter a five-digit Malaysian postcode.", { "shippingAddress.postcode": "Enter five digits." });
  }
  return {
    recipientName: requiredString(body.recipientName, "shippingAddress.recipientName", { min: 2, max: 120 }),
    phone: normalizePhone(requiredString(body.phone, "shippingAddress.phone", { min: 7, max: 30 })),
    line1: requiredString(body.line1, "shippingAddress.line1", { min: 3, max: 180 }),
    line2: optionalString(body.line2, "shippingAddress.line2", 180),
    city: requiredString(body.city, "shippingAddress.city", { min: 2, max: 100 }),
    state: requiredString(body.state, "shippingAddress.state", { min: 2, max: 100 }),
    postcode,
    country: requiredString(body.country ?? "Malaysia", "shippingAddress.country", { min: 2, max: 80 }),
  };
}

function publicOrder(order: {
  id: string; orderNumber: string; createdAt: number; customerName: string; customerEmail: string;
  status: string; paymentStatus: string; paymentMethod: string; totalMinor: number; subtotalMinor: number;
  shippingMinor: number; discountMinor: number;
}, items: PricedItem[]) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: new Date(order.createdAt * 1000).toISOString(),
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    status: order.status.toLowerCase(),
    paymentStatus: order.paymentStatus.toLowerCase(),
    paymentMethod: order.paymentMethod,
    total: order.totalMinor / 100,
    subtotal: order.subtotalMinor / 100,
    shipping: order.shippingMinor / 100,
    discount: order.discountMinor / 100,
    lines: items.map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPriceMinor / 100,
    })),
  };
}

export async function handleCreateOrder(request: Request, db: D1Database): Promise<Response> {
  const session = await requireCustomer(request, db);
  await verifyCsrf(request, session);
  await consumeRateLimit(db, request, {
    bucket: "order-create", discriminator: session.user.id, limit: 10, windowSeconds: 10 * 60,
    code: "ORDER_RATE_LIMITED", message: "Too many order attempts. Please wait and try again.",
  });
  const idempotencyKey = requiredString(request.headers.get("idempotency-key"), "Idempotency-Key", { min: 8, max: 128 });
  const body = await readJson<Record<string, unknown>>(request);
  const requestHash = await sha256(JSON.stringify(body));
  const keyHash = await sha256(`${session.user.id}:${idempotencyKey}`);
  const existing = await db.prepare(`SELECT request_hash AS requestHash, response_json AS responseJson
    FROM idempotency_keys WHERE key_hash = ? AND expires_at > unixepoch()`)
    .bind(keyHash).first<{ requestHash: string; responseJson: string | null }>();
  if (existing) {
    if (existing.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_MISMATCH", "This request key was already used for a different order.");
    if (existing.responseJson) return ok(JSON.parse(existing.responseJson));
    throw new ApiError(409, "ORDER_IN_PROGRESS", "This order is already being processed.");
  }

  const requested = parseItems(body.items);
  const items = await priceItems(db, requested);
  const bundleMetadata = await validateBundleMetadata(db, body.bundleMetadata, requested);
  const unavailable = items.find((item) => item.quantity > item.stock);
  if (unavailable) throw new ApiError(409, "OUT_OF_STOCK", `${unavailable.name} does not have enough stock.`);
  const shippingAddress = parseShippingAddress(body.shippingAddress);
  const paymentMethod = requiredString(body.paymentMethod, "paymentMethod", { min: 1, max: 50 });
  if (paymentMethod !== "manual_confirmation") {
    throw new ApiError(422, "PAYMENT_METHOD_UNAVAILABLE", "Only manual payment confirmation is currently available.");
  }
  const profile = await db.prepare(`SELECT u.email, p.full_name AS fullName, p.phone_e164 AS phone
    FROM users u JOIN customer_profiles p ON p.user_id = u.id WHERE u.id = ?`)
    .bind(session.user.id).first<{ email: string; fullName: string; phone: string | null }>();
  if (!profile) throw new ApiError(404, "PROFILE_NOT_FOUND", "Complete your profile before placing an order.");

  const subtotalMinor = items.reduce((total, item) => total + item.unitPriceMinor * item.quantity, 0);
  const promotion = await calculatePromotion(db, optionalString(body.promoCode, "promoCode", 50), subtotalMinor, session.user.id);
  const settings = await shippingSettings(db);
  const shippingMinor = promotion.freeShipping || subtotalMinor >= settings.thresholdMinor ? 0 : settings.shippingFeeMinor;
  const totalMinor = subtotalMinor - promotion.discountMinor + shippingMinor;
  const orderId = randomId("order");
  const orderNumber = `3R-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomId("").slice(-6).toUpperCase()}`;
  const placedAt = Math.floor(Date.now() / 1000);
  const orderData = publicOrder({
    id: orderId,
    orderNumber,
    createdAt: placedAt,
    customerName: shippingAddress.recipientName || profile.fullName,
    customerEmail: profile.email,
    status: "PENDING_PAYMENT",
    paymentStatus: "PENDING",
    paymentMethod,
    totalMinor,
    subtotalMinor,
    shippingMinor,
    discountMinor: promotion.discountMinor,
  }, items);
  const responseData = { order: orderData };
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO orders
      (id, order_number, user_id, customer_name, customer_email, customer_phone,
       status, payment_status, fulfilment_status, payment_method, currency,
       subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, promotion_id, placed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', 'PENDING', 'UNFULFILLED', ?, 'MYR', ?, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(orderId, orderNumber, session.user.id, shippingAddress.recipientName || profile.fullName,
        profile.email, shippingAddress.phone || profile.phone, paymentMethod, subtotalMinor,
        promotion.discountMinor, shippingMinor, totalMinor, promotion.promotionId, placedAt, placedAt),
    db.prepare(`INSERT INTO order_addresses
      (id, order_id, address_type, recipient_name, phone_e164, line1, line2, city, state, postcode, country_code)
      VALUES (?, ?, 'SHIPPING', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(randomId("order_address"), orderId, shippingAddress.recipientName, shippingAddress.phone,
        shippingAddress.line1, shippingAddress.line2, shippingAddress.city, shippingAddress.state,
        shippingAddress.postcode, shippingAddress.country === "Malaysia" ? "MY" : shippingAddress.country),
    db.prepare(`INSERT INTO order_status_history
      (id, order_id, previous_status, new_status, note, actor_user_id)
      VALUES (?, ?, NULL, 'PENDING_PAYMENT', 'Order placed for manual payment confirmation.', ?)`)
      .bind(randomId("order_status"), orderId, session.user.id),
  ];
  items.forEach((item) => {
    const allocations = bundleMetadata.get(item.productId) ?? [];
    const addOrderItem = (quantity: number, bundle?: BundleItemMetadata) => statements.push(
      db.prepare(`INSERT INTO order_items
        (id, order_id, product_id, product_variant_id, sku_snapshot, name_snapshot,
         unit_price_minor, quantity, line_total_minor, bundle_id, bundle_instance_id,
         bundle_name_snapshot, bundle_step_name_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(randomId("order_item"), orderId, item.productId, item.variantId, item.sku, item.name,
          item.unitPriceMinor, quantity, item.unitPriceMinor * quantity,
          bundle?.bundleId ?? null, bundle?.bundleInstanceId ?? null,
          bundle?.bundleName ?? null, bundle?.stepName ?? null),
    );
    allocations.forEach((bundle) => addOrderItem(1, bundle));
    const unallocatedQuantity = item.quantity - allocations.length;
    if (unallocatedQuantity > 0) addOrderItem(unallocatedQuantity);
    statements.push(
      db.prepare(`INSERT INTO inventory_movements
        (id, variant_id, location_id, movement_type, quantity_delta, reason, reference_type, reference_id, actor_user_id)
        VALUES (?, ?, 'location-main', 'RESERVATION', ?, 'Customer order reservation', 'ORDER', ?, ?)`)
        .bind(randomId("inventory"), item.variantId, -item.quantity, orderId, session.user.id),
    );
  });
  if (promotion.promotionId) {
    statements.push(db.prepare(`INSERT INTO promotion_redemptions
      (id, promotion_id, user_id, order_id, discount_minor)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(randomId("redemption"), promotion.promotionId, session.user.id, orderId, promotion.discountMinor));
  }
  statements.push(db.prepare(`INSERT INTO idempotency_keys
    (key_hash, user_id, request_hash, response_status, response_json, resource_type, resource_id, expires_at)
    VALUES (?, ?, ?, 201, ?, 'ORDER', ?, ?)`)
    .bind(keyHash, session.user.id, requestHash, JSON.stringify(responseData), orderId, placedAt + 24 * 60 * 60));

  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("idempotency_keys")) {
      const raced = await db.prepare("SELECT request_hash AS requestHash, response_json AS responseJson FROM idempotency_keys WHERE key_hash = ?")
        .bind(keyHash).first<{ requestHash: string; responseJson: string | null }>();
      if (raced?.requestHash === requestHash && raced.responseJson) return ok(JSON.parse(raced.responseJson));
    }
    throw error;
  }
  return ok(responseData, 201);
}

export async function handleNewsletter(request: Request, db: D1Database): Promise<Response> {
  assertSameOrigin(request);
  await consumeRateLimit(db, request, {
    bucket: "newsletter", limit: 10, windowSeconds: 60 * 60,
    code: "NEWSLETTER_RATE_LIMITED", message: "Too many signup attempts. Please try again later.",
  });
  const body = await readJson<Record<string, unknown>>(request);
  const email = normalizeEmail(requiredString(body.email, "email", { min: 5, max: 254 }));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Enter a valid email address.", { email: "Enter a valid email address." });
  }
  await db.prepare(`INSERT INTO newsletter_subscribers
    (id, email, email_normalized, status, consent_at)
    VALUES (?, ?, ?, 'SUBSCRIBED', unixepoch())
    ON CONFLICT(email_normalized) DO UPDATE SET email = excluded.email,
      status = 'SUBSCRIBED', consent_at = unixepoch(), unsubscribed_at = NULL`)
    .bind(randomId("subscriber"), email, email).run();
  return ok({ subscribed: true }, 201);
}

export async function handleCreateEnquiry(request: Request, db: D1Database): Promise<Response> {
  assertSameOrigin(request);
  await consumeRateLimit(db, request, {
    bucket: "enquiry", limit: 10, windowSeconds: 60 * 60,
    code: "ENQUIRY_RATE_LIMITED", message: "Too many enquiries. Please try again later.",
  });
  const body = await readJson<Record<string, unknown>>(request);
  const name = requiredString(body.name, "name", { min: 2, max: 120 });
  const email = optionalString(body.email, "email", 254);
  const phoneValue = optionalString(body.phone, "phone", 30);
  if (!email && !phoneValue) {
    throw new ApiError(422, "VALIDATION_ERROR", "Provide an email address or mobile number.", { email: "Email or phone is required." });
  }
  const subject = requiredString(body.subject, "subject", { min: 2, max: 160 });
  const message = requiredString(body.message, "message", { min: 2, max: 4000 });
  const threadId = randomId("enquiry");
  const user = await getSession(request, db);
  await db.batch([
    db.prepare(`INSERT INTO enquiry_threads
      (id, user_id, channel, customer_name, customer_email, customer_phone, subject, status)
      VALUES (?, ?, 'WEB', ?, ?, ?, ?, 'NEW')`)
      .bind(threadId, user?.user.id ?? null, name, email ? normalizeEmail(email) : null,
        phoneValue ? normalizePhone(phoneValue) : null, subject),
    db.prepare(`INSERT INTO enquiry_messages
      (id, thread_id, sender_type, sender_user_id, body)
      VALUES (?, ?, 'CUSTOMER', ?, ?)`)
      .bind(randomId("message"), threadId, user?.user.id ?? null, message),
  ]);
  return ok({ enquiry: { id: threadId, status: "new" } }, 201);
}
