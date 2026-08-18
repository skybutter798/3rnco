import { requireAdmin, requireOwner } from "./auth";
import { hashPassword, isAcceptableCustomerPassword, normalizeEmail, normalizePhone, normalizeUsername, randomId } from "./crypto";
import { allRows } from "./database";
import {
  ApiError,
  booleanField,
  integerField,
  ok,
  optionalString,
  readJson,
  requiredString,
} from "./http";
import { loadBundles, loadProducts, storefrontPayload } from "./storefront";

type AdminSession = Awaited<ReturnType<typeof requireAdmin>>;

const staffPermissions = ["dashboard", "orders", "customers", "content", "promos", "referrals", "enquiries"] as const;

function normalizedStaffPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ApiError(422, "VALIDATION_ERROR", "Choose staff permissions.", { permissions: "Choose at least one permission." });
  const permissions = [...new Set(value.map(String))];
  if (permissions.some((permission) => !staffPermissions.includes(permission as typeof staffPermissions[number]))) {
    throw new ApiError(422, "VALIDATION_ERROR", "Choose only supported staff permissions.", { permissions: "One or more permissions are not supported." });
  }
  return permissions;
}

async function loadStaff(db: D1Database) {
  const rows = await allRows<{ id: string; username: string; email: string | null; displayName: string; status: string; permissionsJson: string; mustChangePassword: number; lastLoginAt: number | null; createdAt: number }>(db.prepare(`SELECT u.id, u.username, u.email, sp.display_name AS displayName, u.status,
    sp.permissions_json AS permissionsJson, u.must_change_password AS mustChangePassword,
    u.last_login_at AS lastLoginAt, u.created_at AS createdAt
    FROM users u JOIN staff_profiles sp ON sp.user_id = u.id ORDER BY u.created_at DESC`));
  return rows.map((row) => ({ id: row.id, username: row.username, email: row.email, fullName: row.displayName, status: row.status.toLowerCase(), permissions: JSON.parse(row.permissionsJson) as string[], mustChangePassword: Boolean(row.mustChangePassword), lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt * 1000).toISOString() : null, createdAt: new Date(row.createdAt * 1000).toISOString() }));
}

export async function handleAdminStaff(request: Request, db: D1Database, id?: string): Promise<Response> {
  const session = await requireOwner(request, db, { mutation: request.method !== "GET" });
  if (request.method === "GET") return ok({ staff: await loadStaff(db) });
  const body = await readJson<Record<string, unknown>>(request);
  if (request.method === "POST") {
    const username = normalizeUsername(requiredString(body.username, "username", { min: 3, max: 64 }));
    if (!/^[a-z0-9._-]{3,64}$/u.test(username)) throw new ApiError(422, "VALIDATION_ERROR", "Use a valid staff username.", { username: "Use lowercase letters, numbers, dots, dashes or underscores." });
    const fullName = requiredString(body.fullName, "fullName", { min: 2, max: 160 });
    const password = requiredString(body.password, "password", { min: 8, max: 128 });
    if (!isAcceptableCustomerPassword(password)) throw new ApiError(422, "VALIDATION_ERROR", "Use at least 8 characters.", { password: "Use 8 to 128 characters." });
    const email = optionalString(body.email, "email", 254);
    const normalizedEmail = email ? normalizeEmail(email) : null;
    const permissions = normalizedStaffPermissions(body.permissions);
    const userId = randomId("staff");
    try {
      await db.batch([
        db.prepare(`INSERT INTO users (id, username, username_normalized, email, email_normalized, password_hash, role, status, must_change_password)
          VALUES (?, ?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE', 1)`).bind(userId, username, username, normalizedEmail, normalizedEmail, await hashPassword(password)),
        db.prepare("INSERT INTO staff_profiles (user_id, display_name, permissions_json, created_by) VALUES (?, ?, ?, ?)").bind(userId, fullName, JSON.stringify(permissions), session.user.id),
        auditStatement(db, session, "CREATE", "STAFF", userId, { username, fullName, permissions }),
      ]);
    } catch {
      throw new ApiError(409, "STAFF_LOGIN_IN_USE", "That staff username or email is already in use.");
    }
    return ok({ staff: (await loadStaff(db)).find((member) => member.id === userId) }, 201);
  }
  if (!id) throw new ApiError(404, "STAFF_NOT_FOUND", "The staff account could not be found.");
  const current = await db.prepare("SELECT u.id, u.email, u.status, sp.display_name AS displayName, sp.permissions_json AS permissionsJson FROM users u JOIN staff_profiles sp ON sp.user_id = u.id WHERE u.id = ?").bind(id).first<{ id: string; email: string | null; status: string; displayName: string; permissionsJson: string }>();
  if (!current) throw new ApiError(404, "STAFF_NOT_FOUND", "The staff account could not be found.");
  const fullName = optionalString(body.fullName, "fullName", 160) ?? current.displayName;
  const emailValue = body.email === null || body.email === "" ? null : (optionalString(body.email, "email", 254) ?? current.email);
  const email = emailValue ? normalizeEmail(emailValue) : null;
  const status = (optionalString(body.status, "status", 20) ?? current.status).toUpperCase();
  if (!["ACTIVE", "DISABLED"].includes(status)) throw new ApiError(422, "VALIDATION_ERROR", "Choose an active or disabled status.");
  const permissions = body.permissions === undefined ? JSON.parse(current.permissionsJson) as string[] : normalizedStaffPermissions(body.permissions);
  const password = optionalString(body.password, "password", 128);
  if (password && !isAcceptableCustomerPassword(password)) throw new ApiError(422, "VALIDATION_ERROR", "Use at least 8 characters.", { password: "Use 8 to 128 characters." });
  const statements = [
    db.prepare("UPDATE users SET email = ?, email_normalized = ?, status = ?, updated_at = unixepoch() WHERE id = ?").bind(email, email, status, id),
    db.prepare("UPDATE staff_profiles SET display_name = ?, permissions_json = ?, updated_at = unixepoch() WHERE user_id = ?").bind(fullName, JSON.stringify(permissions), id),
    auditStatement(db, session, "UPDATE", "STAFF", id, { fullName, email, status, permissions }),
  ];
  if (password) statements.push(db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = unixepoch() WHERE id = ?").bind(await hashPassword(password), id));
  if (password || status === "DISABLED") statements.push(db.prepare("UPDATE user_sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL").bind(id));
  await db.batch(statements);
  return ok({ staff: (await loadStaff(db)).find((member) => member.id === id) });
}

function moneyMinor(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10_000_000
  ) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Please review the highlighted fields.",
      { [field]: "Enter a valid non-negative amount." },
    );
  }
  return Math.round(value * 100);
}

function unixTime(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string")
    throw new ApiError(422, "VALIDATION_ERROR", "Enter a valid date.", {
      [field]: "Enter a valid date.",
    });
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new ApiError(422, "VALIDATION_ERROR", "Enter a valid date.", {
      [field]: "Enter a valid date.",
    });
  return Math.floor(milliseconds / 1000);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 100);
}

function safeHttpsUrl(
  value: unknown,
  field: string,
  allowedHosts?: string[],
): string {
  const raw = requiredString(value, field, { min: 8, max: 1000 });
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiError(422, "VALIDATION_ERROR", "Enter a valid HTTPS URL.", {
      [field]: "Enter a valid HTTPS URL.",
    });
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ApiError(422, "VALIDATION_ERROR", "Enter a valid HTTPS URL.", {
      [field]: "HTTPS is required.",
    });
  }
  if (
    allowedHosts &&
    !allowedHosts.some(
      (host) =>
        parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Enter the expected social profile URL.",
      { [field]: "Unexpected website host." },
    );
  }
  return parsed.toString();
}

function safeImageUrl(value: unknown, field: string): string {
  const raw = requiredString(value, field, { min: 1, max: 1000 });
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\"))
    return raw;
  return safeHttpsUrl(raw, field);
}

function auditStatement(
  db: D1Database,
  session: AdminSession,
  action: string,
  entityType: string,
  entityId: string | null,
  after: unknown,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO admin_audit_logs
    (id, actor_user_id, action, entity_type, entity_id, after_json)
    VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      randomId("audit"),
      session.user.id,
      action,
      entityType,
      entityId,
      JSON.stringify(after),
    );
}

export async function handleAdminDashboard(
  request: Request,
  db: D1Database,
): Promise<Response> {
  await requireAdmin(request, db);
  const [totals, recentOrders] = await Promise.all([
    db
      .prepare(
        `SELECT
      COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_minor ELSE 0 END), 0) AS revenueMinor,
      SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) AS paidOrders,
      COUNT(DISTINCT CASE WHEN payment_status = 'PAID' THEN user_id END) AS purchasingCustomers
      FROM orders`,
      )
      .first<{
        revenueMinor: number;
        paidOrders: number;
        purchasingCustomers: number;
      }>(),
    loadAdminOrders(db, 5),
  ]);
  const [units, customerCount, openEnquiries] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(oi.quantity), 0) AS count FROM order_items oi
      JOIN orders o ON o.id = oi.order_id WHERE o.payment_status = 'PAID'`,
      )
      .first<{ count: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL",
      )
      .first<{ count: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM enquiry_threads WHERE status IN ('NEW', 'OPEN')",
      )
      .first<{ count: number }>(),
  ]);
  const revenue = Number(totals?.revenueMinor ?? 0) / 100;
  const paidOrders = Number(totals?.paidOrders ?? 0);
  return ok({
    dashboard: {
      revenue,
      paidOrders,
      averageOrderValue: paidOrders ? revenue / paidOrders : 0,
      unitsSold: Number(units?.count ?? 0),
      customerCount: Number(customerCount?.count ?? 0),
      openEnquiries: Number(openEnquiries?.count ?? 0),
      recentOrders,
    },
  });
}

export async function handleAdminSettings(
  request: Request,
  db: D1Database,
): Promise<Response> {
  if (request.method === "GET") {
    await requireAdmin(request, db, { allowMustChange: true });
    return ok({ settings: (await storefrontPayload(db)).settings });
  }
  const session = await requireOwner(request, db, { mutation: true });
  const body = await readJson<Record<string, unknown>>(request);
  const storeName = requiredString(body.storeName, "storeName", {
    min: 2,
    max: 120,
  });
  const supportEmail = requiredString(body.supportEmail, "supportEmail", {
    min: 5,
    max: 254,
  }).toLowerCase();
  const whatsappDisplay = requiredString(
    body.whatsappDisplay,
    "whatsappDisplay",
    { min: 7, max: 40 },
  );
  const whatsappNumber = requiredString(body.whatsappNumber, "whatsappNumber", {
    min: 8,
    max: 20,
  }).replace(/\D/gu, "");
  const instagramHandle =
    optionalString(body.instagramHandle, "instagramHandle", 100) ?? "";
  const instagramUrl = safeHttpsUrl(body.instagramUrl, "instagramUrl", [
    "instagram.com",
  ]);
  const facebookUrl = safeHttpsUrl(body.facebookUrl, "facebookUrl", [
    "facebook.com",
  ]);
  const announcement =
    optionalString(body.announcement, "announcement", 240) ?? "";
  const currency = requiredString(body.currency, "currency", {
    min: 3,
    max: 3,
  }).toUpperCase();
  const country = requiredString(body.country, "country", { min: 2, max: 80 });
  const shippingFeeMinor = moneyMinor(body.shippingFee, "shippingFee");
  const thresholdMinor = moneyMinor(
    body.shippingThreshold,
    "shippingThreshold",
  );
  const paymentMethodsValue = body.paymentMethods;
  if (paymentMethodsValue !== undefined && (!Array.isArray(paymentMethodsValue) || paymentMethodsValue.length > 12)) throw new ApiError(422, "VALIDATION_ERROR", "Configure up to 12 payment methods.", { paymentMethods: "Payment methods must be a list." });
  const paymentMethodStatements = (Array.isArray(paymentMethodsValue) ? paymentMethodsValue : []).map((value, index) => {
    if (!value || typeof value !== "object") throw new ApiError(422, "VALIDATION_ERROR", "Complete each payment method.");
    const method = value as Record<string, unknown>;
    const type = requiredString(method.type, `paymentMethods.${index}.type`, { min: 3, max: 30 });
    if (!["duitnow_qr", "tng_qr", "bank_transfer"].includes(type)) throw new ApiError(422, "VALIDATION_ERROR", "Choose a supported payment method.");
    const id = requiredString(method.id, `paymentMethods.${index}.id`, { min: 2, max: 64 });
    const name = requiredString(method.name, `paymentMethods.${index}.name`, { min: 2, max: 120 });
    const enabled = booleanField(method.active, false) ? 1 : 0;
    const instructions = optionalString(method.instructions, `paymentMethods.${index}.instructions`, 1000);
    const qrImage = optionalString(method.qrImage, `paymentMethods.${index}.qrImage`, 1000);
    const bankName = optionalString(method.bankName, `paymentMethods.${index}.bankName`, 120);
    const accountName = optionalString(method.accountName, `paymentMethods.${index}.accountName`, 160);
    const accountNumber = optionalString(method.accountNumber, `paymentMethods.${index}.accountNumber`, 100);
    if (qrImage) safeImageUrl(qrImage, `paymentMethods.${index}.qrImage`);
    if (enabled && ["duitnow_qr", "tng_qr"].includes(type) && !qrImage) throw new ApiError(422, "VALIDATION_ERROR", "Upload a QR image before enabling this method.", { [`paymentMethods.${index}.qrImage`]: "QR image required." });
    if (enabled && type === "bank_transfer" && (!bankName || !accountName || !accountNumber)) throw new ApiError(422, "VALIDATION_ERROR", "Complete the bank details before enabling bank transfer.");
    return db.prepare(`INSERT INTO payment_methods (id, method_type, display_name, enabled, instructions, qr_image_url, bank_name, account_name, account_number, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET method_type = excluded.method_type, display_name = excluded.display_name,
      enabled = excluded.enabled, instructions = excluded.instructions, qr_image_url = excluded.qr_image_url,
      bank_name = excluded.bank_name, account_name = excluded.account_name, account_number = excluded.account_number,
      sort_order = excluded.sort_order, updated_at = unixepoch()`)
      .bind(id, type, name, enabled, instructions, qrImage, bankName, accountName, accountNumber, Number(method.sortOrder ?? index));
  });
  const settingsStatements = [
    db
      .prepare(
        `UPDATE store_settings SET brand_name = ?, support_email = ?, whatsapp_e164 = ?,
      whatsapp_display = ?, announcement = ?, currency = ?, country = ?, shipping_fee_minor = ?,
      free_shipping_threshold_minor = ?, version = version + 1, updated_by = ?, updated_at = unixepoch()
      WHERE id = 'default'`,
      )
      .bind(
        storeName,
        supportEmail,
        `+${whatsappNumber}`,
        whatsappDisplay,
        announcement,
        currency,
        country,
        shippingFeeMinor,
        thresholdMinor,
        session.user.id,
      ),
    db
      .prepare(
        `INSERT INTO social_links (id, platform, handle, url, enabled, sort_order)
      VALUES ('social-instagram', 'instagram', ?, ?, 1, 1)
      ON CONFLICT(platform) DO UPDATE SET handle = excluded.handle, url = excluded.url,
      enabled = 1, updated_at = unixepoch()`,
      )
      .bind(instagramHandle, instagramUrl),
    db
      .prepare(
        `INSERT INTO social_links (id, platform, handle, url, enabled, sort_order)
      VALUES ('social-facebook', 'facebook', 'officially3randco', ?, 1, 2)
      ON CONFLICT(platform) DO UPDATE SET url = excluded.url, enabled = 1, updated_at = unixepoch()`,
      )
      .bind(facebookUrl),
    auditStatement(db, session, "UPDATE", "STORE_SETTINGS", "default", body),
    ...paymentMethodStatements,
  ];
  await db.batch(settingsStatements);
  return ok({ settings: (await storefrontPayload(db)).settings });
}

type ProductInput = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  priceMinor: number;
  badge: string;
  description: string;
  detail: string;
  ingredients: string;
  ritual: string;
  volume: string;
  image: string;
  editorial: string;
  editorialPosition: string;
  texture: string;
  benefits: string[];
  storyImages: Array<{
    image: string;
    alt: string;
    eyebrow: string;
    title: string;
    copy: string;
    position: string;
  }>;
  stock: number;
  expectedStock: number | null;
  active: boolean;
  sortOrder: number;
};

function parseProduct(
  body: Record<string, unknown>,
  routeId?: string,
): ProductInput {
  const name = requiredString(body.name, "name", { min: 2, max: 160 });
  const id =
    routeId ??
    slugify(
      requiredString(body.id ?? body.slug ?? name, "id", { min: 2, max: 100 }),
    );
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Use lowercase letters, numbers and hyphens for the product ID.",
      { id: "Invalid product ID." },
    );
  }
  const benefits = Array.isArray(body.benefits)
    ? body.benefits
        .map((benefit, index) =>
          requiredString(benefit, `benefits.${index}`, { min: 1, max: 200 }),
        )
        .slice(0, 20)
    : [];
  const storyImages = Array.isArray(body.storyImages)
    ? body.storyImages.slice(0, 12).map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "Story images must be valid.",
          );
        const story = value as Record<string, unknown>;
        return {
          image: safeImageUrl(story.image, `storyImages.${index}.image`),
          alt: optionalString(story.alt, `storyImages.${index}.alt`, 300) ?? "",
          eyebrow:
            optionalString(
              story.eyebrow,
              `storyImages.${index}.eyebrow`,
              120,
            ) ?? "",
          title:
            optionalString(story.title, `storyImages.${index}.title`, 200) ??
            "",
          copy:
            optionalString(story.copy, `storyImages.${index}.copy`, 1000) ?? "",
          position:
            optionalString(
              story.position,
              `storyImages.${index}.position`,
              80,
            ) ?? "center",
        };
      })
    : [];
  return {
    id,
    slug: slugify(optionalString(body.slug, "slug", 100) ?? id),
    name,
    shortName: requiredString(body.shortName, "shortName", { min: 1, max: 80 }),
    priceMinor: moneyMinor(body.price, "price"),
    badge: optionalString(body.badge, "badge", 120) ?? "",
    description: requiredString(body.description, "description", {
      min: 2,
      max: 1000,
    }),
    detail: requiredString(body.detail, "detail", { min: 2, max: 4000 }),
    ingredients: optionalString(body.ingredients, "ingredients", 4000) ?? "",
    ritual: optionalString(body.ritual, "ritual", 2000) ?? "",
    volume: optionalString(body.volume, "volume", 200) ?? "",
    image: safeImageUrl(body.image, "image"),
    editorial: safeImageUrl(body.editorial ?? body.image, "editorial"),
    editorialPosition:
      optionalString(body.editorialPosition, "editorialPosition", 80) ??
      "center",
    texture: optionalString(body.texture, "texture", 1000) ?? "",
    benefits,
    storyImages,
    stock: integerField(body.stock, "stock", { min: 0, max: 1_000_000 }),
    expectedStock:
      body.expectedStock === undefined || body.expectedStock === null
        ? null
        : integerField(body.expectedStock, "expectedStock", {
            min: 0,
            max: 1_000_000,
          }),
    active: booleanField(body.active, true),
    sortOrder: Number.isSafeInteger(body.sortOrder)
      ? Number(body.sortOrder)
      : 0,
  };
}

function productContentStatements(
  db: D1Database,
  product: ProductInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db
      .prepare("DELETE FROM product_benefits WHERE product_id = ?")
      .bind(product.id),
    db
      .prepare("DELETE FROM product_media WHERE product_id = ?")
      .bind(product.id),
    db
      .prepare(
        `INSERT INTO product_media
      (id, product_id, usage, image_url, alt_text, position, sort_order)
      VALUES (?, ?, 'PACKSHOT', ?, ?, 'center', 0)`,
      )
      .bind(randomId("product_media"), product.id, product.image, product.name),
    db
      .prepare(
        `INSERT INTO product_media
      (id, product_id, usage, image_url, alt_text, position, sort_order)
      VALUES (?, ?, 'EDITORIAL', ?, ?, ?, 0)`,
      )
      .bind(
        randomId("product_media"),
        product.id,
        product.editorial,
        `${product.name} editorial`,
        product.editorialPosition,
      ),
  ];
  product.benefits.forEach((benefit, index) =>
    statements.push(
      db
        .prepare(
          "INSERT INTO product_benefits (id, product_id, benefit, sort_order) VALUES (?, ?, ?, ?)",
        )
        .bind(randomId("benefit"), product.id, benefit, index + 1),
    ),
  );
  product.storyImages.forEach((story, index) =>
    statements.push(
      db
        .prepare(
          `INSERT INTO product_media
      (id, product_id, usage, image_url, alt_text, eyebrow, title, copy, position, sort_order)
      VALUES (?, ?, 'STORY', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          randomId("product_media"),
          product.id,
          story.image,
          story.alt,
          story.eyebrow,
          story.title,
          story.copy,
          story.position,
          index + 1,
        ),
    ),
  );
  return statements;
}

export async function handleAdminProducts(
  request: Request,
  db: D1Database,
  id?: string,
): Promise<Response> {
  if (request.method === "GET" && !id) {
    await requireAdmin(request, db);
    return ok({ products: await loadProducts(db, true) });
  }
  const session = await requireAdmin(request, db, { mutation: true });
  if (request.method === "DELETE" && id) {
    const existing = await db
      .prepare("SELECT id FROM products WHERE id = ?")
      .bind(id)
      .first<{ id: string }>();
    if (!existing)
      throw new ApiError(
        404,
        "PRODUCT_NOT_FOUND",
        "The product could not be found.",
      );
    await db.batch([
      db
        .prepare(
          "UPDATE products SET status = 'ARCHIVED', updated_at = unixepoch() WHERE id = ?",
        )
        .bind(id),
      db
        .prepare(
          "UPDATE product_variants SET status = 'ARCHIVED', updated_at = unixepoch() WHERE product_id = ?",
        )
        .bind(id),
      db
        .prepare(
          `UPDATE bundle_step_options SET enabled = 0
        WHERE product_variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)`,
        )
        .bind(id),
      auditStatement(db, session, "ARCHIVE", "PRODUCT", id, {
        status: "ARCHIVED",
      }),
    ]);
    return ok({ deleted: true });
  }

  const product = parseProduct(
    await readJson<Record<string, unknown>>(request),
    id,
  );
  const existing = await db
    .prepare(
      `SELECT p.id, v.id AS variantId FROM products p
    JOIN product_variants v ON v.product_id = p.id
    WHERE p.id = ? LIMIT 1`,
    )
    .bind(product.id)
    .first<{ id: string; variantId: string }>();

  if (request.method === "POST" && existing)
    throw new ApiError(
      409,
      "PRODUCT_EXISTS",
      "That product ID already exists.",
    );
  if (request.method === "PATCH" && !existing)
    throw new ApiError(
      404,
      "PRODUCT_NOT_FOUND",
      "The product could not be found.",
    );
  if (existing && product.expectedStock === null) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Refresh the product before saving stock.",
      { expectedStock: "Current stock is required." },
    );
  }
  const variantId = existing?.variantId ?? `variant-${product.id}`;
  const status = product.active ? "ACTIVE" : "ARCHIVED";
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(
      db
        .prepare(
          `UPDATE products SET slug = ?, name = ?, short_name = ?, badge = ?, description = ?,
        detail = ?, ingredients = ?, ritual = ?, volume = ?, texture = ?, status = ?, sort_order = ?,
        version = version + 1, updated_at = unixepoch() WHERE id = ?`,
        )
        .bind(
          product.slug,
          product.name,
          product.shortName,
          product.badge,
          product.description,
          product.detail,
          product.ingredients,
          product.ritual,
          product.volume,
          product.texture,
          status,
          product.sortOrder,
          product.id,
        ),
      db
        .prepare(
          `UPDATE product_variants SET price_minor = ?, status = ?, updated_at = unixepoch()
        WHERE id = ?`,
        )
        .bind(product.priceMinor, status, variantId),
      db
        .prepare(
          `INSERT INTO inventory_stock_updates
        (id, variant_id, expected_available, new_available, actor_user_id)
        VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          randomId("stock_update"),
          variantId,
          product.expectedStock,
          product.stock,
          session.user.id,
        ),
    );
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO products
        (id, slug, name, short_name, badge, description, detail, ingredients, ritual, volume,
         texture, status, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          product.id,
          product.slug,
          product.name,
          product.shortName,
          product.badge,
          product.description,
          product.detail,
          product.ingredients,
          product.ritual,
          product.volume,
          product.texture,
          status,
          product.sortOrder,
        ),
      db
        .prepare(
          `INSERT INTO product_variants
        (id, product_id, sku, title, price_minor, currency, track_inventory, status)
        VALUES (?, ?, ?, 'Default', ?, 'MYR', 1, ?)`,
        )
        .bind(
          variantId,
          product.id,
          `3R-${product.id.toUpperCase().replaceAll("-", "_")}`,
          product.priceMinor,
          status,
        ),
      db
        .prepare(
          `INSERT INTO inventory_levels
        (variant_id, location_id, on_hand, reserved, reorder_threshold)
        VALUES (?, 'location-main', ?, 0, 0)`,
        )
        .bind(variantId, product.stock),
      db
        .prepare(
          `INSERT INTO inventory_movements
        (id, variant_id, location_id, movement_type, quantity_delta, reason, reference_type, reference_id, actor_user_id)
        VALUES (?, ?, 'location-main', 'INITIAL', ?, 'Initial admin stock', 'PRODUCT', ?, ?)`,
        )
        .bind(
          randomId("inventory"),
          variantId,
          product.stock,
          product.id,
          session.user.id,
        ),
    );
  }
  statements.push(...productContentStatements(db, product));
  statements.push(
    auditStatement(
      db,
      session,
      existing ? "UPDATE" : "CREATE",
      "PRODUCT",
      product.id,
      product,
    ),
  );
  await db.batch(statements);
  const saved = (await loadProducts(db, true)).find(
    (item) => item.id === product.id,
  );
  return ok({ product: saved }, existing ? 200 : 201);
}

async function loadAdminSlides(db: D1Database) {
  const rows = await allRows<{
    id: string;
    image: string;
    eyebrow: string;
    title: string;
    emphasis: string;
    copy: string;
    caption: string;
    tone: "dark" | "light";
    position: string;
    active: number;
    sortOrder: number;
  }>(
    db.prepare(`SELECT id, image_url AS image, eyebrow, title, emphasis, copy, caption,
    tone, position, enabled AS active, sort_order AS sortOrder FROM slides ORDER BY sort_order`),
  );
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
}

function parseSlide(body: Record<string, unknown>) {
  const tone = requiredString(body.tone ?? "light", "tone", { min: 4, max: 5 });
  if (!new Set(["dark", "light"]).has(tone))
    throw new ApiError(422, "VALIDATION_ERROR", "Tone must be dark or light.");
  return {
    image: safeImageUrl(body.image, "image"),
    eyebrow: optionalString(body.eyebrow, "eyebrow", 160) ?? "",
    title: requiredString(body.title, "title", { min: 1, max: 200 }),
    emphasis: requiredString(body.emphasis, "emphasis", { min: 1, max: 200 }),
    copy: requiredString(body.copy, "copy", { min: 1, max: 1000 }),
    caption: optionalString(body.caption, "caption", 300) ?? "",
    tone,
    position: optionalString(body.position, "position", 80) ?? "center",
    active: booleanField(body.active, true),
    sortOrder: Number.isSafeInteger(body.sortOrder)
      ? Number(body.sortOrder)
      : 0,
  };
}

export async function handleAdminSlides(
  request: Request,
  db: D1Database,
  id?: string,
): Promise<Response> {
  if (request.method === "GET" && !id) {
    await requireAdmin(request, db);
    return ok({ slides: await loadAdminSlides(db) });
  }
  const session = await requireAdmin(request, db, { mutation: true });
  if (request.method === "DELETE" && id) {
    const result = await db
      .prepare("DELETE FROM slides WHERE id = ?")
      .bind(id)
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        404,
        "SLIDE_NOT_FOUND",
        "The slider could not be found.",
      );
    await auditStatement(db, session, "DELETE", "SLIDE", id, null).run();
    return ok({ deleted: true });
  }
  const slide = parseSlide(await readJson<Record<string, unknown>>(request));
  const slideId = id ?? randomId("slide");
  if (id) {
    const result = await db
      .prepare(
        `UPDATE slides SET image_url = ?, eyebrow = ?, title = ?, emphasis = ?,
      copy = ?, caption = ?, tone = ?, position = ?, enabled = ?, sort_order = ?,
      version = version + 1, updated_at = unixepoch() WHERE id = ?`,
      )
      .bind(
        slide.image,
        slide.eyebrow,
        slide.title,
        slide.emphasis,
        slide.copy,
        slide.caption,
        slide.tone,
        slide.position,
        slide.active ? 1 : 0,
        slide.sortOrder,
        id,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        404,
        "SLIDE_NOT_FOUND",
        "The slider could not be found.",
      );
  } else {
    await db
      .prepare(
        `INSERT INTO slides
      (id, slider_id, image_url, eyebrow, title, emphasis, copy, caption, tone, position, enabled, sort_order)
      VALUES (?, 'slider-moringa', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        slideId,
        slide.image,
        slide.eyebrow,
        slide.title,
        slide.emphasis,
        slide.copy,
        slide.caption,
        slide.tone,
        slide.position,
        slide.active ? 1 : 0,
        slide.sortOrder,
      )
      .run();
  }
  await auditStatement(
    db,
    session,
    id ? "UPDATE" : "CREATE",
    "SLIDE",
    slideId,
    slide,
  ).run();
  const saved = (await loadAdminSlides(db)).find((item) => item.id === slideId);
  return ok({ slide: saved }, id ? 200 : 201);
}

export async function handleAdminBundles(
  request: Request,
  db: D1Database,
  id?: string,
): Promise<Response> {
  if (request.method === "GET" && !id) {
    await requireAdmin(request, db);
    return ok({ bundles: await loadBundles(db, true) });
  }
  const session = await requireAdmin(request, db, { mutation: true });
  const bundleId = id ?? randomId("bundle");
  const body = await readJson<Record<string, unknown>>(request);
  const name = requiredString(body.name, "name", { min: 2, max: 160 });
  const title = optionalString(body.title, "title", 240) ?? name;
  const description = requiredString(body.description, "description", {
    min: 2,
    max: 1000,
  });
  const active = booleanField(body.active, true);
  const discountType =
    optionalString(body.discountType, "discountType", 20) ?? "none";
  if (!["none", "fixed", "percentage"].includes(discountType)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Choose a valid set saving type.",
      { discountType: "Choose none, fixed or percentage." },
    );
  }
  const discountValue = Number(body.discountValue ?? 0);
  if (
    !Number.isFinite(discountValue) ||
    discountValue < 0 ||
    (discountType === "percentage" && discountValue > 100)
  ) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Enter a valid set saving value.",
      {
        discountValue:
          discountType === "percentage"
            ? "Enter 0–100%."
            : "Enter a non-negative amount.",
      },
    );
  }
  const pricingMode =
    discountType === "fixed"
      ? "FIXED_DISCOUNT"
      : discountType === "percentage"
        ? "PERCENT_DISCOUNT"
        : "SUM_ITEMS";
  const priceValueMinor =
    discountType === "none" ? null : Math.round(discountValue * 100);
  if (
    !Array.isArray(body.steps) ||
    !body.steps.length ||
    body.steps.length > 10
  ) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Configure at least one bundle step.",
      { steps: "Required." },
    );
  }
  const steps = body.steps.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Bundle steps must be valid.",
      );
    const step = value as Record<string, unknown>;
    if (!Array.isArray(step.productIds) || !step.productIds.length) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Choose at least one product for each step.",
        { [`steps.${index}.productIds`]: "Required." },
      );
    }
    return {
      id:
        optionalString(step.id, `steps.${index}.id`, 100) ??
        randomId("bundle_step"),
      label: requiredString(step.label, `steps.${index}.label`, {
        min: 1,
        max: 160,
      }),
      description:
        optionalString(step.description, `steps.${index}.description`, 500) ??
        "",
      productIds: [
        ...new Set(
          step.productIds.map((productId, productIndex) =>
            requiredString(
              productId,
              `steps.${index}.productIds.${productIndex}`,
              { min: 1, max: 100 },
            ),
          ),
        ),
      ],
      minSelections: Number.isSafeInteger(step.minSelections)
        ? Number(step.minSelections)
        : 1,
      maxSelections: Number.isSafeInteger(step.maxSelections)
        ? Number(step.maxSelections)
        : 1,
      sortOrder: Number.isSafeInteger(step.sortOrder)
        ? Number(step.sortOrder)
        : index + 1,
    };
  });
  const allProductIds = [...new Set(steps.flatMap((step) => step.productIds))];
  const variants = new Map<string, string>();
  for (const productId of allProductIds) {
    const variant = await db
      .prepare(
        `SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE p.id = ? AND p.status = 'ACTIVE' AND v.status = 'ACTIVE' LIMIT 1`,
      )
      .bind(productId)
      .first<{ id: string }>();
    if (!variant)
      throw new ApiError(
        422,
        "PRODUCT_UNAVAILABLE",
        `${productId} is not an active product.`,
      );
    variants.set(productId, variant.id);
  }
  const existing = await db
    .prepare("SELECT id FROM bundles WHERE id = ?")
    .bind(bundleId)
    .first<{ id: string }>();
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(
      db
        .prepare(
          `UPDATE bundles SET name = ?, title = ?, description = ?, pricing_mode = ?, price_value_minor = ?, status = ?,
      version = version + 1, updated_at = unixepoch() WHERE id = ?`,
        )
        .bind(
          name,
          title,
          description,
          pricingMode,
          priceValueMinor,
          active ? "ACTIVE" : "ARCHIVED",
          bundleId,
        ),
    );
    statements.push(
      db
        .prepare(
          "DELETE FROM bundle_step_options WHERE step_id IN (SELECT id FROM bundle_steps WHERE bundle_id = ?)",
        )
        .bind(bundleId),
    );
    statements.push(
      db.prepare("DELETE FROM bundle_steps WHERE bundle_id = ?").bind(bundleId),
    );
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO bundles
      (id, slug, name, title, cta_label, description, selection_mode, pricing_mode, price_value_minor, status, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, 'MIX_MATCH', ?, ?, ?, 0)`,
        )
        .bind(
          bundleId,
          slugify(optionalString(body.slug, "slug", 100) ?? bundleId),
          name,
          title,
          name,
          description,
          pricingMode,
          priceValueMinor,
          active ? "ACTIVE" : "ARCHIVED",
        ),
    );
  }
  steps.forEach((step, index) => {
    const stepId = `${bundleId}-step-${index + 1}`;
    statements.push(
      db
        .prepare(
          `INSERT INTO bundle_steps
      (id, bundle_id, step_number, name, prompt, min_selections, max_selections, required, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .bind(
          stepId,
          bundleId,
          index + 1,
          step.label,
          step.description,
          Math.max(1, step.minSelections),
          Math.max(1, step.maxSelections),
          step.sortOrder,
        ),
    );
    step.productIds.forEach((productId, optionIndex) =>
      statements.push(
        db
          .prepare(
            `INSERT INTO bundle_step_options
        (id, step_id, product_variant_id, enabled, is_default, price_adjustment_minor, sort_order)
        VALUES (?, ?, ?, 1, ?, 0, ?)`,
          )
          .bind(
            randomId("bundle_option"),
            stepId,
            variants.get(productId),
            optionIndex === 0 ? 1 : 0,
            optionIndex + 1,
          ),
      ),
    );
  });
  statements.push(
    auditStatement(
      db,
      session,
      existing ? "UPDATE" : "CREATE",
      "BUNDLE",
      bundleId,
      body,
    ),
  );
  await db.batch(statements);
  const saved = (await loadBundles(db, true)).find(
    (bundle) => bundle.id === bundleId,
  );
  return ok({ bundle: saved }, existing ? 200 : 201);
}

async function loadAdminPromos(db: D1Database) {
  const rows = await allRows<{
    id: string;
    code: string;
    description: string;
    discountType: string;
    valueMinor: number;
    percentBasisPoints: number;
    minimumSpendMinor: number;
    maximumDiscountMinor: number | null;
    usageLimit: number | null;
    perCustomerLimit: number | null;
    active: string;
    startsAt: number | null;
    endsAt: number | null;
    usageCount: number;
  }>(
    db.prepare(`SELECT p.id, p.code, p.name AS description, p.discount_type AS discountType,
    p.value_minor AS valueMinor, p.percent_basis_points AS percentBasisPoints,
    p.min_subtotal_minor AS minimumSpendMinor, p.max_discount_minor AS maximumDiscountMinor,
    p.usage_limit AS usageLimit, p.per_customer_limit AS perCustomerLimit,
    p.status AS active, p.starts_at AS startsAt, p.ends_at AS endsAt,
    (SELECT COUNT(*) FROM promotion_redemptions r WHERE r.promotion_id = p.id) AS usageCount
    FROM promotions p ORDER BY p.created_at DESC`),
  );
  return rows.map((promo) => ({
    id: promo.id,
    code: promo.code,
    description: promo.description,
    type: promo.discountType.toLowerCase(),
    value:
      promo.discountType === "PERCENTAGE"
        ? promo.percentBasisPoints / 100
        : promo.valueMinor / 100,
    minimumSpend: promo.minimumSpendMinor / 100,
    maximumDiscount:
      promo.maximumDiscountMinor === null
        ? undefined
        : promo.maximumDiscountMinor / 100,
    usageLimit: promo.usageLimit ?? undefined,
    perCustomerLimit: promo.perCustomerLimit ?? undefined,
    active: promo.active === "ACTIVE",
    startsAt: promo.startsAt
      ? new Date(promo.startsAt * 1000).toISOString()
      : undefined,
    endsAt: promo.endsAt
      ? new Date(promo.endsAt * 1000).toISOString()
      : undefined,
    usageCount: Number(promo.usageCount),
  }));
}

export async function handleAdminPromos(
  request: Request,
  db: D1Database,
  id?: string,
): Promise<Response> {
  if (request.method === "GET" && !id) {
    await requireAdmin(request, db);
    return ok({ promos: await loadAdminPromos(db) });
  }
  const session = await requireAdmin(request, db, { mutation: true });
  if (request.method === "DELETE" && id) {
    const result = await db
      .prepare(
        "UPDATE promotions SET status = 'INACTIVE', updated_at = unixepoch() WHERE id = ?",
      )
      .bind(id)
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        404,
        "PROMO_NOT_FOUND",
        "The promo code could not be found.",
      );
    await auditStatement(db, session, "DISABLE", "PROMOTION", id, null).run();
    return ok({ deleted: true });
  }
  const body = await readJson<Record<string, unknown>>(request);
  const code = requiredString(body.code, "code", {
    min: 2,
    max: 50,
  }).toUpperCase();
  if (!/^[A-Z0-9_-]+$/u.test(code))
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Use letters, numbers, underscores or hyphens for the code.",
    );
  const description = requiredString(body.description, "description", {
    min: 2,
    max: 300,
  });
  const type = requiredString(body.type, "type", {
    min: 4,
    max: 20,
  }).toUpperCase();
  if (!new Set(["PERCENTAGE", "FIXED", "FREE_SHIPPING"]).has(type))
    throw new ApiError(422, "VALIDATION_ERROR", "Choose a valid offer type.");
  const valueMinor =
    type === "FIXED" ? moneyMinor(body.value ?? 0, "value") : 0;
  const percentBasisPoints =
    type === "PERCENTAGE" ? Math.round(Number(body.value ?? 0) * 100) : 0;
  if (
    type === "PERCENTAGE" &&
    (!Number.isFinite(percentBasisPoints) ||
      percentBasisPoints < 1 ||
      percentBasisPoints > 10_000)
  ) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Percentage must be between 0.01 and 100.",
      { value: "Enter 0.01 to 100." },
    );
  }
  const minimumSpendMinor = moneyMinor(
    Number(body.minimumSpend ?? 0),
    "minimumSpend",
  );
  const maximumDiscountMinor =
    Number(body.maximumDiscount ?? 0) > 0
      ? moneyMinor(body.maximumDiscount, "maximumDiscount")
      : null;
  const startsAt = unixTime(body.startsAt, "startsAt");
  const endsAt = unixTime(body.endsAt, "endsAt");
  if (startsAt && endsAt && endsAt <= startsAt)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "The end date must be after the start date.",
    );
  const usageLimit =
    body.usageLimit === undefined ||
    body.usageLimit === null ||
    body.usageLimit === ""
      ? null
      : integerField(body.usageLimit, "usageLimit", {
          min: 1,
          max: 10_000_000,
        });
  const perCustomerLimit =
    body.perCustomerLimit === undefined ||
    body.perCustomerLimit === null ||
    body.perCustomerLimit === ""
      ? null
      : integerField(body.perCustomerLimit, "perCustomerLimit", {
          min: 1,
          max: 10_000,
        });
  const active = booleanField(body.active, true);
  const promoId = id ?? randomId("promo");
  if (id) {
    const result = await db
      .prepare(
        `UPDATE promotions SET code = ?, name = ?, discount_type = ?,
      value_minor = ?, percent_basis_points = ?, min_subtotal_minor = ?, max_discount_minor = ?,
      usage_limit = ?, per_customer_limit = ?, starts_at = ?, ends_at = ?, status = ?, updated_at = unixepoch() WHERE id = ?`,
      )
      .bind(
        code,
        description,
        type,
        valueMinor,
        percentBasisPoints,
        minimumSpendMinor,
        maximumDiscountMinor,
        usageLimit,
        perCustomerLimit,
        startsAt,
        endsAt,
        active ? "ACTIVE" : "INACTIVE",
        id,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        404,
        "PROMO_NOT_FOUND",
        "The promo code could not be found.",
      );
  } else {
    await db
      .prepare(
        `INSERT INTO promotions
      (id, code, name, discount_type, value_minor, percent_basis_points,
       min_subtotal_minor, max_discount_minor, usage_limit, per_customer_limit, status, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        promoId,
        code,
        description,
        type,
        valueMinor,
        percentBasisPoints,
        minimumSpendMinor,
        maximumDiscountMinor,
        usageLimit,
        perCustomerLimit,
        active ? "ACTIVE" : "INACTIVE",
        startsAt,
        endsAt,
      )
      .run();
  }
  await auditStatement(
    db,
    session,
    id ? "UPDATE" : "CREATE",
    "PROMOTION",
    promoId,
    body,
  ).run();
  const saved = (await loadAdminPromos(db)).find(
    (promo) => promo.id === promoId,
  );
  return ok({ promo: saved }, id ? 200 : 201);
}

async function loadAdminOrders(db: D1Database, limit = 200) {
  const orders = await allRows<{
    id: string;
    orderNumber: string;
    createdAt: number;
    customerName: string;
    customerEmail: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string;
    totalMinor: number;
    subtotalMinor: number;
    shippingMinor: number;
    discountMinor: number;
  }>(
    db
      .prepare(
        `SELECT id, order_number AS orderNumber, placed_at AS createdAt,
    customer_name AS customerName, customer_email AS customerEmail, status,
    payment_status AS paymentStatus, payment_method AS paymentMethod, total_minor AS totalMinor,
    subtotal_minor AS subtotalMinor, shipping_minor AS shippingMinor, discount_minor AS discountMinor
    FROM orders ORDER BY placed_at DESC LIMIT ?`,
      )
      .bind(limit),
  );
  const lines = await allRows<{
    id: string;
    orderId: string;
    productId: string;
    name: string;
    quantity: number;
    unitPriceMinor: number;
    bundleId: string | null;
    bundleInstanceId: string | null;
    bundleName: string | null;
    bundleStepName: string | null;
  }>(
    db.prepare(`SELECT id, order_id AS orderId, product_id AS productId, name_snapshot AS name,
    quantity, unit_price_minor AS unitPriceMinor, bundle_id AS bundleId,
    bundle_instance_id AS bundleInstanceId, bundle_name_snapshot AS bundleName,
    bundle_step_name_snapshot AS bundleStepName FROM order_items ORDER BY order_id, id`),
  );
  const receipts = await allRows<{
    id: string; orderId: string; status: string; paymentMethodId: string; paymentMethodName: string;
    customerReference: string | null; customerNote: string | null; originalName: string; mimeType: string;
    sizeBytes: number; reviewNote: string | null; createdAt: number; reviewedAt: number | null;
  }>(db.prepare(`SELECT r.id, r.order_id AS orderId, r.status, r.payment_method_id AS paymentMethodId,
    m.display_name AS paymentMethodName, r.customer_reference AS customerReference, r.customer_note AS customerNote,
    r.original_name AS originalName, r.mime_type AS mimeType, r.size_bytes AS sizeBytes,
    r.review_note AS reviewNote, r.created_at AS createdAt, r.reviewed_at AS reviewedAt
    FROM payment_receipts r JOIN payment_methods m ON m.id = r.payment_method_id ORDER BY r.created_at DESC`));
  return orders.map((order) => ({
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
    paymentReceipt: (() => {
      const receipt = receipts.find((candidate) => candidate.orderId === order.id);
      return receipt ? { ...receipt, status: receipt.status.toLowerCase(), createdAt: new Date(receipt.createdAt * 1000).toISOString(), reviewedAt: receipt.reviewedAt ? new Date(receipt.reviewedAt * 1000).toISOString() : null } : null;
    })(),
    lines: lines
      .filter((line) => line.orderId === order.id)
      .map((line) => ({
        id: line.id,
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPriceMinor / 100,
        bundleId: line.bundleId ?? undefined,
        bundleInstanceId: line.bundleInstanceId ?? undefined,
        bundleName: line.bundleName ?? undefined,
        bundleStepName: line.bundleStepName ?? undefined,
      })),
  }));
}

export async function handleAdminOrders(
  request: Request,
  db: D1Database,
  id?: string,
): Promise<Response> {
  if (request.method === "GET" && !id) {
    await requireAdmin(request, db);
    return ok({ orders: await loadAdminOrders(db) });
  }
  if (!id)
    throw new ApiError(404, "ORDER_NOT_FOUND", "The order could not be found.");
  const session = await requireAdmin(request, db, { mutation: true });
  const body = await readJson<Record<string, unknown>>(request);
  const status = requiredString(body.status, "status", {
    min: 3,
    max: 40,
  }).toUpperCase();
  const allowed = new Set([
    "PENDING_PAYMENT",
    "PAYMENT_CONFIRMED",
    "PROCESSING",
    "PACKING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ]);
  if (!allowed.has(status))
    throw new ApiError(
      422,
      "INVALID_ORDER_STATUS",
      "Choose a valid order status.",
    );
  const current = await db
    .prepare(
      "SELECT status, payment_status AS paymentStatus FROM orders WHERE id = ?",
    )
    .bind(id)
    .first<{ status: string; paymentStatus: string }>();
  if (!current)
    throw new ApiError(404, "ORDER_NOT_FOUND", "The order could not be found.");
  if (current.status === status) {
    const unchanged = (await loadAdminOrders(db)).find(
      (order) => order.id === id,
    );
    return ok({ order: unchanged });
  }
  const transitions: Record<string, string[]> = {
    PENDING_PAYMENT: ["PAYMENT_CONFIRMED", "PROCESSING", "PACKING", "SHIPPED", "DELIVERED", "CANCELLED"],
    PAYMENT_CONFIRMED: ["PROCESSING", "PACKING", "SHIPPED", "DELIVERED", "CANCELLED"],
    PROCESSING: ["PAYMENT_CONFIRMED", "PACKING", "SHIPPED", "DELIVERED", "CANCELLED"],
    PACKING: ["PAYMENT_CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"],
    SHIPPED: ["PAYMENT_CONFIRMED", "PROCESSING", "PACKING", "DELIVERED", "CANCELLED"],
    DELIVERED: ["PAYMENT_CONFIRMED", "PROCESSING", "PACKING", "SHIPPED", "CANCELLED"],
    CANCELLED: ["PAYMENT_CONFIRMED"],
  };
  if (!transitions[current.status]?.includes(status)) {
    throw new ApiError(
      409,
      "INVALID_ORDER_TRANSITION",
      `An order cannot move from ${current.status.toLowerCase()} to ${status.toLowerCase()}.`,
    );
  }
  const paymentStatus = ["PAYMENT_CONFIRMED", "PROCESSING", "PACKING", "SHIPPED", "DELIVERED"].includes(status)
    ? "PAID"
    : current.paymentStatus;
  const transition = await db
    .prepare(
      `UPDATE orders SET status = ?, payment_status = ?, updated_at = unixepoch()
    WHERE id = ? AND status = ? AND payment_status = ?`,
    )
    .bind(status, paymentStatus, id, current.status, current.paymentStatus)
    .run();
  if (transition.meta.changes !== 1) {
    throw new ApiError(
      409,
      "ORDER_TRANSITION_CONFLICT",
      "The order changed in another session. Refresh and try again.",
    );
  }
  const statusStatements = [
    db
      .prepare(
        `INSERT INTO order_status_history
      (id, order_id, previous_status, new_status, note, actor_user_id)
      VALUES (?, ?, ?, ?, 'Admin status update', ?)`,
      )
      .bind(
        randomId("order_status"),
        id,
        current.status,
        status,
        session.user.id,
      ),
    auditStatement(db, session, "STATUS_UPDATE", "ORDER", id, {
      status,
      paymentStatus,
    }),
  ];
  if (status === "PAYMENT_CONFIRMED") {
    statusStatements.push(db.prepare(`UPDATE referral_commissions SET status = 'APPROVED', approved_at = unixepoch(), updated_at = unixepoch()
      WHERE order_id = ? AND status = 'PENDING'`).bind(id));
  } else if (status === "CANCELLED") {
    statusStatements.push(db.prepare(`UPDATE referral_commissions SET status = 'VOID', voided_at = unixepoch(), note = 'Order cancelled', updated_at = unixepoch()
      WHERE order_id = ? AND status IN ('PENDING','APPROVED')`).bind(id));
  }
  await db.batch(statusStatements);
  const saved = (await loadAdminOrders(db)).find((order) => order.id === id);
  return ok({ order: saved });
}

type AdminCustomerRow = {
  id: string; email: string; status: string; mustChangePassword: number; emailVerifiedAt: number | null;
  lastLoginAt: number | null; fullName: string; phone: string | null; birthDate: string | null;
  marketingConsent: number; createdAt: number; orderCount: number; totalSpentMinor: number; lastOrderAt: number | null;
};

async function adminCustomerList(db: D1Database) {
  const customers = await allRows<AdminCustomerRow>(db.prepare(`SELECT u.id, u.email, u.status,
    u.must_change_password AS mustChangePassword, u.email_verified_at AS emailVerifiedAt,
    u.last_login_at AS lastLoginAt, p.full_name AS fullName, p.phone_e164 AS phone,
    p.birth_date AS birthDate, p.marketing_consent AS marketingConsent, u.created_at AS createdAt,
    COUNT(o.id) AS orderCount,
    COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.total_minor ELSE 0 END), 0) AS totalSpentMinor,
    MAX(o.placed_at) AS lastOrderAt FROM users u JOIN customer_profiles p ON p.user_id = u.id
    LEFT JOIN orders o ON o.user_id = u.id WHERE u.role = 'CUSTOMER' AND u.deleted_at IS NULL
    GROUP BY u.id ORDER BY u.created_at DESC`));
  return customers.map((customer) => ({
    id: customer.id, email: customer.email, role: "customer", status: customer.status.toLowerCase(),
    fullName: customer.fullName, phone: customer.phone ?? "", birthDate: customer.birthDate ?? "",
    marketingConsent: Boolean(customer.marketingConsent), addresses: [], mustChangePassword: Boolean(customer.mustChangePassword),
    emailVerified: customer.emailVerifiedAt !== null,
    emailVerifiedAt: customer.emailVerifiedAt ? new Date(customer.emailVerifiedAt * 1000).toISOString() : undefined,
    lastLoginAt: customer.lastLoginAt ? new Date(customer.lastLoginAt * 1000).toISOString() : undefined,
    createdAt: new Date(customer.createdAt * 1000).toISOString(), orderCount: Number(customer.orderCount),
    totalSpent: Number(customer.totalSpentMinor) / 100,
    lastOrderAt: customer.lastOrderAt ? new Date(customer.lastOrderAt * 1000).toISOString() : undefined,
  }));
}

async function adminCustomerDetail(db: D1Database, id: string) {
  const customer = (await adminCustomerList(db)).find((item) => item.id === id);
  if (!customer) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "The customer could not be found.");
  const [addresses, orders, referralLinks, referredBy] = await Promise.all([
    allRows<{ id: string; label: string; recipientName: string; phone: string; line1: string; line2: string | null; city: string; state: string; postcode: string; country: string; isDefault: number }>(db.prepare(`SELECT id, label, recipient_name AS recipientName, phone_e164 AS phone, line1, line2, city, state, postcode,
      country_code AS country, is_default_shipping AS isDefault FROM customer_addresses WHERE user_id = ? ORDER BY is_default_shipping DESC, created_at`).bind(id)),
    allRows<{ id: string; orderNumber: string; createdAt: number; status: string; paymentStatus: string; totalMinor: number }>(db.prepare(`SELECT id, order_number AS orderNumber, placed_at AS createdAt, status, payment_status AS paymentStatus, total_minor AS totalMinor
      FROM orders WHERE user_id = ? ORDER BY placed_at DESC LIMIT 100`).bind(id)),
    allRows<{ id: string; code: string; name: string; status: string; commissionBasisPoints: number; discountBasisPoints: number; discountScope: string }>(db.prepare(`SELECT id, code, name, status, commission_basis_points AS commissionBasisPoints,
      discount_basis_points AS discountBasisPoints, discount_scope AS discountScope FROM referral_links WHERE referrer_user_id = ? ORDER BY created_at DESC`).bind(id)),
    db.prepare(`SELECT rl.code, rl.name, cr.attributed_at AS attributedAt FROM customer_referrals cr
      JOIN referral_links rl ON rl.id = cr.referral_link_id WHERE cr.user_id = ?`).bind(id)
      .first<{ code: string; name: string; attributedAt: number }>(),
  ]);
  return {
    ...customer,
    addresses: addresses.map((address) => ({ ...address, line2: address.line2 ?? "", country: address.country === "MY" ? "Malaysia" : address.country, isDefault: Boolean(address.isDefault) })),
    orders: orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber, createdAt: new Date(order.createdAt * 1000).toISOString(),
      status: order.status.toLowerCase(), paymentStatus: order.paymentStatus.toLowerCase(), total: Number(order.totalMinor) / 100 })),
    referralLinks: referralLinks.map((link) => ({ id: link.id, code: link.code, name: link.name, active: link.status === "ACTIVE",
      commissionPercent: Number(link.commissionBasisPoints) / 100, discountPercent: Number(link.discountBasisPoints) / 100,
      discountScope: link.discountScope.toLowerCase() })),
    referredBy: referredBy ? { code: referredBy.code, name: referredBy.name, attributedAt: new Date(referredBy.attributedAt * 1000).toISOString() } : null,
  };
}

type AdminAddress = { label: string; recipientName: string; phone: string; line1: string; line2: string | null; city: string; state: string; postcode: string; country: string; isDefault: boolean };

function adminAddresses(value: unknown): AdminAddress[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError(422, "VALIDATION_ERROR", "Addresses must be a list.", { addresses: "Addresses must be a list." });
  const addresses = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(422, "VALIDATION_ERROR", "Complete every address.", { addresses: "Complete every address." });
    const body = item as Record<string, unknown>;
    const postcode = requiredString(body.postcode, `addresses.${index}.postcode`, { min: 4, max: 10 });
    const country = requiredString(body.country ?? "Malaysia", `addresses.${index}.country`, { min: 2, max: 80 });
    if (country === "Malaysia" && !/^\d{5}$/u.test(postcode)) throw new ApiError(422, "VALIDATION_ERROR", "Enter a five-digit Malaysian postcode.", { [`addresses.${index}.postcode`]: "Enter five digits." });
    return { label: requiredString(body.label, `addresses.${index}.label`, { min: 1, max: 40 }),
      recipientName: requiredString(body.recipientName, `addresses.${index}.recipientName`, { min: 2, max: 120 }),
      phone: normalizePhone(requiredString(body.phone, `addresses.${index}.phone`, { min: 7, max: 30 })),
      line1: requiredString(body.line1, `addresses.${index}.line1`, { min: 3, max: 180 }),
      line2: optionalString(body.line2, `addresses.${index}.line2`, 180), city: requiredString(body.city, `addresses.${index}.city`, { min: 2, max: 100 }),
      state: requiredString(body.state, `addresses.${index}.state`, { min: 2, max: 100 }), postcode, country,
      isDefault: booleanField(body.isDefault, false) };
  });
  let defaultFound = false;
  return addresses.map((address, index) => ({ ...address, isDefault: address.isDefault && !defaultFound
    ? (defaultFound = true) : (!defaultFound && index === 0 && !addresses.some((item) => item.isDefault) ? (defaultFound = true) : false) }));
}

function addressStatements(db: D1Database, userId: string, addresses: AdminAddress[]): D1PreparedStatement[] {
  return [db.prepare("DELETE FROM customer_addresses WHERE user_id = ?").bind(userId), ...addresses.map((address) => db.prepare(`INSERT INTO customer_addresses
    (id, user_id, label, recipient_name, phone_e164, line1, line2, city, state, postcode, country_code, is_default_shipping, is_default_billing)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(randomId("address"), userId, address.label, address.recipientName, address.phone, address.line1, address.line2,
      address.city, address.state, address.postcode, address.country === "Malaysia" ? "MY" : address.country,
      address.isDefault ? 1 : 0, address.isDefault ? 1 : 0))];
}

export async function handleAdminCustomers(request: Request, db: D1Database, id?: string): Promise<Response> {
  const session = await requireAdmin(request, db, { mutation: request.method !== "GET" });
  if (request.method === "GET") return ok(id ? { customer: await adminCustomerDetail(db, id) } : { customers: await adminCustomerList(db) });
  if (request.method === "DELETE") {
    if (!id) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "The customer could not be found.");
    const current = await adminCustomerDetail(db, id);
    await db.batch([db.prepare("UPDATE users SET status = 'DISABLED', updated_at = unixepoch() WHERE id = ?").bind(id),
      db.prepare("UPDATE user_sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL").bind(id),
      auditStatement(db, session, "DISABLE", "CUSTOMER", id, current)]);
    return ok({ deleted: true, customer: await adminCustomerDetail(db, id) });
  }
  const body = await readJson<Record<string, unknown>>(request);
  const current = id ? await db.prepare(`SELECT u.id, u.email, u.status, u.must_change_password AS mustChangePassword,
    p.full_name AS fullName, p.phone_e164 AS phone, p.birth_date AS birthDate, p.marketing_consent AS marketingConsent
    FROM users u JOIN customer_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'CUSTOMER' AND u.deleted_at IS NULL`).bind(id)
    .first<{ id: string; email: string; status: string; mustChangePassword: number; fullName: string; phone: string | null; birthDate: string | null; marketingConsent: number }>() : null;
  if (id && !current) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "The customer could not be found.");
  const fullName = body.fullName === undefined && current ? current.fullName : requiredString(body.fullName, "fullName", { min: 2, max: 120 });
  const email = normalizeEmail(body.email === undefined && current ? current.email : requiredString(body.email, "email", { min: 3, max: 254 }));
  if (!/^\S+@\S+\.\S+$/u.test(email)) throw new ApiError(422, "VALIDATION_ERROR", "Enter a valid email address.", { email: "Enter a valid email address." });
  const phone = body.phone === undefined && current ? current.phone : normalizePhone(requiredString(body.phone, "phone", { min: 7, max: 30 }));
  const birthDate = body.birthDate === undefined && current ? current.birthDate : optionalString(body.birthDate, "birthDate", 10);
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/u.test(birthDate)) throw new ApiError(422, "VALIDATION_ERROR", "Use YYYY-MM-DD for the birth date.", { birthDate: "Use YYYY-MM-DD." });
  const status = String(body.status ?? current?.status ?? "ACTIVE").toUpperCase();
  if (!["ACTIVE", "DISABLED"].includes(status)) throw new ApiError(422, "VALIDATION_ERROR", "Choose active or disabled status.");
  const marketingConsent = booleanField(body.marketingConsent, Boolean(current?.marketingConsent));
  const temporaryPassword = optionalString(body.temporaryPassword ?? body.password, "temporaryPassword", 128);
  if (!current && !temporaryPassword) throw new ApiError(422, "VALIDATION_ERROR", "Set a temporary password.", { temporaryPassword: "Set at least 8 characters." });
  if (temporaryPassword && !isAcceptableCustomerPassword(temporaryPassword)) throw new ApiError(422, "VALIDATION_ERROR", "Use at least 8 characters.", { temporaryPassword: "Use 8 to 128 characters." });
  const userId = id ?? randomId("user");
  const addresses = body.addresses === undefined && current ? null : adminAddresses(body.addresses);
  const statements: D1PreparedStatement[] = [];
  if (current) {
    const emailChanged = email !== current.email;
    statements.push(db.prepare("UPDATE users SET email = ?, email_normalized = ?, status = ?, email_verified_at = CASE WHEN ? = 1 THEN NULL ELSE email_verified_at END, updated_at = unixepoch() WHERE id = ?").bind(email, email, status, emailChanged ? 1 : 0, userId),
      db.prepare(`UPDATE customer_profiles SET full_name = ?, phone_e164 = ?, birth_date = ?, marketing_consent = ?,
        marketing_consent_source = CASE WHEN ? = 1 THEN 'admin' ELSE NULL END, marketing_consent_at = CASE WHEN ? = 1 THEN COALESCE(marketing_consent_at, unixepoch()) ELSE NULL END,
        updated_at = unixepoch() WHERE user_id = ?`).bind(fullName, phone, birthDate, marketingConsent ? 1 : 0, marketingConsent ? 1 : 0, marketingConsent ? 1 : 0, userId));
    if (temporaryPassword) statements.push(db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").bind(await hashPassword(temporaryPassword), userId));
    if (emailChanged) statements.push(db.prepare("UPDATE user_sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL").bind(userId));
  } else {
    statements.push(db.prepare(`INSERT INTO users (id, email, email_normalized, password_hash, role, status, must_change_password)
      VALUES (?, ?, ?, ?, 'CUSTOMER', ?, 1)`).bind(userId, email, email, await hashPassword(temporaryPassword!), status),
      db.prepare(`INSERT INTO customer_profiles (user_id, full_name, phone_e164, birth_date, marketing_consent, marketing_consent_source, marketing_consent_at)
      VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN unixepoch() ELSE NULL END)`).bind(userId, fullName, phone, birthDate, marketingConsent ? 1 : 0, marketingConsent ? "admin" : null, marketingConsent ? 1 : 0));
  }
  if (addresses !== null) statements.push(...addressStatements(db, userId, addresses));
  if (temporaryPassword || status === "DISABLED") statements.push(db.prepare("UPDATE user_sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL").bind(userId));
  statements.push(auditStatement(db, session, current ? "UPDATE" : "CREATE", "CUSTOMER", userId, { fullName, email, phone, birthDate, status, marketingConsent, addresses: addresses?.length }));
  try { await db.batch(statements); } catch { throw new ApiError(409, "EMAIL_IN_USE", "An account already uses this email address.", { email: "Use a unique email." }); }
  return ok({ customer: await adminCustomerDetail(db, userId) }, current ? 200 : 201);
}

async function loadAdminEnquiries(db: D1Database) {
  const threads = await allRows<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    channel: string;
    subject: string;
    status: string;
    createdAt: number;
  }>(
    db.prepare(`SELECT id, customer_name AS name, customer_email AS email, customer_phone AS phone,
    channel, subject, status, created_at AS createdAt FROM enquiry_threads ORDER BY last_message_at DESC`),
  );
  const messages = await allRows<{
    id: string;
    threadId: string;
    senderType: string;
    message: string;
    createdAt: number;
    author: string | null;
  }>(
    db.prepare(`SELECT m.id, m.thread_id AS threadId, m.sender_type AS senderType,
    m.body AS message, m.created_at AS createdAt, u.username AS author
    FROM enquiry_messages m LEFT JOIN users u ON u.id = m.sender_user_id
    ORDER BY m.created_at`),
  );
  return threads.map((thread) => {
    const threadMessages = messages.filter(
      (message) => message.threadId === thread.id,
    );
    const firstCustomer = threadMessages.find(
      (message) => message.senderType === "CUSTOMER",
    );
    return {
      id: thread.id,
      name: thread.name,
      email: thread.email ?? undefined,
      phone: thread.phone ?? undefined,
      channel: thread.channel.toLowerCase(),
      subject: thread.subject,
      message: firstCustomer?.message ?? "",
      status: thread.status.toLowerCase(),
      createdAt: new Date(thread.createdAt * 1000).toISOString(),
      replies: threadMessages
        .filter((message) => message.senderType === "ADMIN")
        .map((message) => ({
          id: message.id,
          message: message.message,
          createdAt: new Date(message.createdAt * 1000).toISOString(),
          author: message.author ?? "3R&Co",
        })),
    };
  });
}

export async function handleAdminEnquiries(
  request: Request,
  db: D1Database,
  id?: string,
  reply = false,
): Promise<Response> {
  if (request.method === "GET" && !id) {
    await requireAdmin(request, db);
    return ok({ enquiries: await loadAdminEnquiries(db) });
  }
  if (!id)
    throw new ApiError(
      404,
      "ENQUIRY_NOT_FOUND",
      "The enquiry could not be found.",
    );
  const session = await requireAdmin(request, db, { mutation: true });
  const existing = await db
    .prepare("SELECT id FROM enquiry_threads WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!existing)
    throw new ApiError(
      404,
      "ENQUIRY_NOT_FOUND",
      "The enquiry could not be found.",
    );
  const body = await readJson<Record<string, unknown>>(request);
  if (reply) {
    const message = requiredString(body.message, "message", {
      min: 1,
      max: 4000,
    });
    await db.batch([
      db
        .prepare(
          `INSERT INTO enquiry_messages
        (id, thread_id, sender_type, sender_user_id, body)
        VALUES (?, ?, 'ADMIN', ?, ?)`,
        )
        .bind(randomId("message"), id, session.user.id, message),
      db
        .prepare(
          "UPDATE enquiry_threads SET status = 'REPLIED', last_message_at = unixepoch(), updated_at = unixepoch() WHERE id = ?",
        )
        .bind(id),
      auditStatement(db, session, "REPLY", "ENQUIRY", id, { message }),
    ]);
  } else {
    const status = requiredString(body.status, "status", {
      min: 3,
      max: 20,
    }).toUpperCase();
    if (!new Set(["NEW", "OPEN", "REPLIED", "CLOSED"]).has(status))
      throw new ApiError(
        422,
        "INVALID_ENQUIRY_STATUS",
        "Choose a valid enquiry status.",
      );
    await db.batch([
      db
        .prepare(
          "UPDATE enquiry_threads SET status = ?, updated_at = unixepoch() WHERE id = ?",
        )
        .bind(status, id),
      auditStatement(db, session, "STATUS_UPDATE", "ENQUIRY", id, { status }),
    ]);
  }
  const enquiry = (await loadAdminEnquiries(db)).find((item) => item.id === id);
  return ok({ enquiry });
}
