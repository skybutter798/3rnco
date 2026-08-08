import { requireAdmin } from "./auth";
import { randomId } from "./crypto";
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
  const session = await requireAdmin(request, db, { mutation: true });
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
  await db.batch([
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
  ]);
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
    PENDING_PAYMENT: ["PAYMENT_CONFIRMED", "CANCELLED"],
    PAYMENT_CONFIRMED: ["PROCESSING"],
    PROCESSING: ["PACKING"],
    PACKING: ["SHIPPED"],
    SHIPPED: ["DELIVERED"],
  };
  if (!transitions[current.status]?.includes(status)) {
    throw new ApiError(
      409,
      "INVALID_ORDER_TRANSITION",
      `An order cannot move from ${current.status.toLowerCase()} to ${status.toLowerCase()}.`,
    );
  }
  const paymentStatus =
    status === "PAYMENT_CONFIRMED" ? "PAID" : current.paymentStatus;
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
  await db.batch([
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
  ]);
  const saved = (await loadAdminOrders(db)).find((order) => order.id === id);
  return ok({ order: saved });
}

export async function handleAdminCustomers(
  request: Request,
  db: D1Database,
): Promise<Response> {
  await requireAdmin(request, db);
  const customers = await allRows<{
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    birthDate: string | null;
    marketingConsent: number;
    createdAt: number;
    orderCount: number;
    totalSpentMinor: number;
    lastOrderAt: number | null;
  }>(
    db.prepare(`SELECT u.id, u.email, p.full_name AS fullName, p.phone_e164 AS phone,
    p.birth_date AS birthDate, p.marketing_consent AS marketingConsent, u.created_at AS createdAt,
    COUNT(o.id) AS orderCount,
    COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.total_minor ELSE 0 END), 0) AS totalSpentMinor,
    MAX(o.placed_at) AS lastOrderAt
    FROM users u JOIN customer_profiles p ON p.user_id = u.id
    LEFT JOIN orders o ON o.user_id = u.id
    WHERE u.role = 'CUSTOMER' AND u.deleted_at IS NULL
    GROUP BY u.id ORDER BY u.created_at DESC`),
  );
  return ok({
    customers: customers.map((customer) => ({
      id: customer.id,
      email: customer.email,
      role: "customer",
      fullName: customer.fullName,
      phone: customer.phone ?? "",
      birthDate: customer.birthDate ?? "",
      marketingConsent: Boolean(customer.marketingConsent),
      addresses: [],
      createdAt: new Date(customer.createdAt * 1000).toISOString(),
      orderCount: Number(customer.orderCount),
      totalSpent: Number(customer.totalSpentMinor) / 100,
      lastOrderAt: customer.lastOrderAt
        ? new Date(customer.lastOrderAt * 1000).toISOString()
        : undefined,
    })),
  });
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
