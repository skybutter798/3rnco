import { normalizePhone, randomId } from "./crypto";
import { allRows } from "./database";
import { requireCustomer, verifyCsrf } from "./auth";
import { ApiError, booleanField, ok, optionalString, readJson, requiredString } from "./http";

function isoTime(seconds: number | null | undefined): string | undefined {
  return seconds ? new Date(seconds * 1000).toISOString() : undefined;
}

async function loadAddresses(db: D1Database, userId: string) {
  const rows = await allRows<{
    id: string; label: string; recipientName: string; phone: string; line1: string; line2: string | null;
    city: string; state: string; postcode: string; country: string; isDefault: number; createdAt: number;
  }>(db.prepare(`SELECT id, label, recipient_name AS recipientName, phone_e164 AS phone,
    line1, line2, city, state, postcode, country_code AS country,
    is_default_shipping AS isDefault, created_at AS createdAt
    FROM customer_addresses WHERE user_id = ?
    ORDER BY is_default_shipping DESC, created_at`).bind(userId));
  return rows.map((address) => ({ ...address, line2: address.line2 ?? "", isDefault: Boolean(address.isDefault) }));
}

export async function handleGetProfile(request: Request, db: D1Database): Promise<Response> {
  const session = await requireCustomer(request, db);
  const [profile, addresses] = await Promise.all([
    db.prepare(`SELECT u.id, u.email, u.created_at AS createdAt,
      p.full_name AS fullName, p.phone_e164 AS phone, p.birth_date AS birthDate,
      p.marketing_consent AS marketingConsent
      FROM users u JOIN customer_profiles p ON p.user_id = u.id WHERE u.id = ?`)
      .bind(session.user.id).first<{
        id: string; email: string; createdAt: number; fullName: string; phone: string | null;
        birthDate: string | null; marketingConsent: number;
      }>(),
    loadAddresses(db, session.user.id),
  ]);
  if (!profile) throw new ApiError(404, "PROFILE_NOT_FOUND", "The customer profile could not be found.");
  return ok({
    id: profile.id,
    email: profile.email,
    role: "customer",
    fullName: profile.fullName,
    phone: profile.phone ?? "",
    birthDate: profile.birthDate ?? "",
    marketingConsent: Boolean(profile.marketingConsent),
    addresses,
    createdAt: isoTime(profile.createdAt),
  });
}

export async function handlePatchProfile(request: Request, db: D1Database): Promise<Response> {
  const session = await requireCustomer(request, db);
  await verifyCsrf(request, session);
  const body = await readJson<Record<string, unknown>>(request);
  const current = await db.prepare(`SELECT full_name AS fullName, phone_e164 AS phone,
    birth_date AS birthDate, marketing_consent AS marketingConsent
    FROM customer_profiles WHERE user_id = ?`).bind(session.user.id).first<{
      fullName: string; phone: string | null; birthDate: string | null; marketingConsent: number;
    }>();
  if (!current) throw new ApiError(404, "PROFILE_NOT_FOUND", "The customer profile could not be found.");
  const fullName = body.fullName === undefined ? current.fullName : requiredString(body.fullName, "fullName", { min: 2, max: 120 });
  const phone = body.phone === undefined ? current.phone : normalizePhone(requiredString(body.phone, "phone", { min: 7, max: 30 }));
  const birthDate = body.birthDate === undefined ? current.birthDate : optionalString(body.birthDate, "birthDate", 10);
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/u.test(birthDate)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Use YYYY-MM-DD for the birth date.", { birthDate: "Use YYYY-MM-DD." });
  }
  const marketingConsent = booleanField(body.marketingConsent, Boolean(current.marketingConsent));
  await db.prepare(`UPDATE customer_profiles SET full_name = ?, phone_e164 = ?, birth_date = ?,
    marketing_consent = ?, marketing_consent_source = CASE WHEN ? = 1 THEN 'account' ELSE NULL END,
    marketing_consent_at = CASE WHEN ? = 1 THEN COALESCE(marketing_consent_at, unixepoch()) ELSE NULL END,
    updated_at = unixepoch() WHERE user_id = ?`)
    .bind(fullName, phone, birthDate, marketingConsent ? 1 : 0, marketingConsent ? 1 : 0, marketingConsent ? 1 : 0, session.user.id).run();
  return handleGetProfile(request, db);
}

type AddressInput = {
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postcode: string;
  country: string;
  isDefault: boolean;
};

function addressInput(body: Record<string, unknown>, current?: Partial<AddressInput>): AddressInput {
  const pickRequired = (key: keyof AddressInput, min: number, max: number) => body[key] === undefined && current?.[key] !== undefined
    ? String(current[key])
    : requiredString(body[key], String(key), { min, max });
  const phone = normalizePhone(pickRequired("phone", 7, 30));
  const postcode = pickRequired("postcode", 4, 10);
  if (!/^\d{5}$/u.test(postcode)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Enter a five-digit Malaysian postcode.", { postcode: "Enter five digits." });
  }
  return {
    label: pickRequired("label", 1, 40),
    recipientName: pickRequired("recipientName", 2, 120),
    phone,
    line1: pickRequired("line1", 3, 180),
    line2: body.line2 === undefined ? current?.line2 ?? null : optionalString(body.line2, "line2", 180),
    city: pickRequired("city", 2, 100),
    state: pickRequired("state", 2, 100),
    postcode,
    country: body.country === undefined ? current?.country ?? "MY" : requiredString(body.country, "country", { min: 2, max: 80 }),
    isDefault: booleanField(body.isDefault, current?.isDefault ?? false),
  };
}

export async function handleListAddresses(request: Request, db: D1Database): Promise<Response> {
  const session = await requireCustomer(request, db);
  return ok({ addresses: await loadAddresses(db, session.user.id) });
}

export async function handleCreateAddress(request: Request, db: D1Database): Promise<Response> {
  const session = await requireCustomer(request, db);
  await verifyCsrf(request, session);
  const input = addressInput(await readJson<Record<string, unknown>>(request));
  const id = randomId("address");
  const statements: D1PreparedStatement[] = [];
  if (input.isDefault) {
    statements.push(db.prepare("UPDATE customer_addresses SET is_default_shipping = 0, updated_at = unixepoch() WHERE user_id = ?")
      .bind(session.user.id));
  }
  statements.push(db.prepare(`INSERT INTO customer_addresses
    (id, user_id, label, recipient_name, phone_e164, line1, line2, city, state, postcode,
     country_code, is_default_shipping, is_default_billing)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, session.user.id, input.label, input.recipientName, input.phone, input.line1, input.line2,
      input.city, input.state, input.postcode, input.country === "Malaysia" ? "MY" : input.country,
      input.isDefault ? 1 : 0, input.isDefault ? 1 : 0));
  await db.batch(statements);
  const addresses = await loadAddresses(db, session.user.id);
  return ok({ address: addresses.find((address) => address.id === id), addresses }, 201);
}

async function ownedAddress(db: D1Database, userId: string, id: string) {
  const row = await db.prepare(`SELECT id, label, recipient_name AS recipientName, phone_e164 AS phone,
    line1, line2, city, state, postcode, country_code AS country,
    is_default_shipping AS isDefault FROM customer_addresses WHERE id = ? AND user_id = ?`)
    .bind(id, userId).first<Omit<AddressInput, "isDefault"> & { id: string; isDefault: number }>();
  if (!row) throw new ApiError(404, "ADDRESS_NOT_FOUND", "The address could not be found.");
  return { ...row, isDefault: Boolean(row.isDefault) };
}

export async function handleUpdateAddress(request: Request, db: D1Database, id: string): Promise<Response> {
  const session = await requireCustomer(request, db);
  await verifyCsrf(request, session);
  const current = await ownedAddress(db, session.user.id, id);
  const input = addressInput(await readJson<Record<string, unknown>>(request), current);
  const statements: D1PreparedStatement[] = [];
  if (input.isDefault) {
    statements.push(db.prepare("UPDATE customer_addresses SET is_default_shipping = 0, updated_at = unixepoch() WHERE user_id = ?")
      .bind(session.user.id));
  }
  statements.push(db.prepare(`UPDATE customer_addresses SET label = ?, recipient_name = ?, phone_e164 = ?,
    line1 = ?, line2 = ?, city = ?, state = ?, postcode = ?, country_code = ?,
    is_default_shipping = ?, is_default_billing = ?, updated_at = unixepoch()
    WHERE id = ? AND user_id = ?`)
    .bind(input.label, input.recipientName, input.phone, input.line1, input.line2, input.city, input.state,
      input.postcode, input.country === "Malaysia" ? "MY" : input.country, input.isDefault ? 1 : 0,
      input.isDefault ? 1 : 0, id, session.user.id));
  await db.batch(statements);
  const addresses = await loadAddresses(db, session.user.id);
  return ok({ address: addresses.find((address) => address.id === id), addresses });
}

export async function handleDeleteAddress(request: Request, db: D1Database, id: string): Promise<Response> {
  const session = await requireCustomer(request, db);
  await verifyCsrf(request, session);
  await ownedAddress(db, session.user.id, id);
  await db.prepare("DELETE FROM customer_addresses WHERE id = ? AND user_id = ?").bind(id, session.user.id).run();
  return ok({ deleted: true, addresses: await loadAddresses(db, session.user.id) });
}

export async function handleAccountOrders(request: Request, db: D1Database): Promise<Response> {
  const session = await requireCustomer(request, db);
  const orders = await allRows<{
    id: string; orderNumber: string; createdAt: number; customerName: string; customerEmail: string;
    status: string; paymentStatus: string; paymentMethod: string; totalMinor: number; subtotalMinor: number;
    shippingMinor: number; discountMinor: number;
  }>(db.prepare(`SELECT id, order_number AS orderNumber, placed_at AS createdAt,
    customer_name AS customerName, customer_email AS customerEmail, status,
    payment_status AS paymentStatus, payment_method AS paymentMethod,
    total_minor AS totalMinor, subtotal_minor AS subtotalMinor,
    shipping_minor AS shippingMinor, discount_minor AS discountMinor
    FROM orders WHERE user_id = ? ORDER BY placed_at DESC LIMIT 100`).bind(session.user.id));
  const lines = orders.length ? await allRows<{
    id: string; orderId: string; productId: string; name: string; quantity: number; unitPriceMinor: number; image: string | null;
  }>(db.prepare(`SELECT oi.id, oi.order_id AS orderId, oi.product_id AS productId,
    oi.name_snapshot AS name, oi.quantity, oi.unit_price_minor AS unitPriceMinor,
    (SELECT image_url FROM product_media WHERE product_id = oi.product_id AND usage = 'PACKSHOT' ORDER BY sort_order LIMIT 1) AS image
    FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ? ORDER BY oi.order_id`).bind(session.user.id)) : [];
  return ok({ orders: orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: isoTime(order.createdAt),
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    status: order.status.toLowerCase(),
    paymentStatus: order.paymentStatus.toLowerCase(),
    paymentMethod: order.paymentMethod,
    total: order.totalMinor / 100,
    subtotal: order.subtotalMinor / 100,
    shipping: order.shippingMinor / 100,
    discount: order.discountMinor / 100,
    lines: lines.filter((line) => line.orderId === order.id).map((line) => ({
      id: line.id,
      productId: line.productId,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPriceMinor / 100,
      image: line.image ?? undefined,
    })),
  })) });
}
