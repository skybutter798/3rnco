import { allRows } from "./database";
import { ApiError, ok } from "./http";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  badge: string;
  description: string;
  detail: string;
  ingredients: string;
  ritual: string;
  volume: string;
  texture: string;
  status: string;
  sortOrder: number;
  priceMinor: number;
  currency: string;
  stock: number;
  image: string | null;
  editorial: string | null;
  editorialPosition: string | null;
};

export async function loadProducts(db: D1Database, includeInactive = false) {
  const products = await allRows<ProductRow>(db.prepare(`SELECT
      p.id, p.slug, p.name, p.short_name AS shortName, p.badge, p.description,
      p.detail, p.ingredients, p.ritual, p.volume, p.texture, p.status,
      p.sort_order AS sortOrder, v.price_minor AS priceMinor, v.currency,
      COALESCE(i.on_hand - i.reserved, 0) AS stock,
      (SELECT pm.image_url FROM product_media pm WHERE pm.product_id = p.id AND pm.usage = 'PACKSHOT' ORDER BY pm.sort_order LIMIT 1) AS image,
      (SELECT pm.image_url FROM product_media pm WHERE pm.product_id = p.id AND pm.usage = 'EDITORIAL' ORDER BY pm.sort_order LIMIT 1) AS editorial,
      (SELECT pm.position FROM product_media pm WHERE pm.product_id = p.id AND pm.usage = 'EDITORIAL' ORDER BY pm.sort_order LIMIT 1) AS editorialPosition
    FROM products p
    JOIN product_variants v ON v.id = (
      SELECT candidate.id FROM product_variants candidate
      WHERE candidate.product_id = p.id ${includeInactive ? "" : "AND candidate.status = 'ACTIVE'"}
      ORDER BY CASE WHEN candidate.status = 'ACTIVE' THEN 0 ELSE 1 END, candidate.created_at
      LIMIT 1
    )
    LEFT JOIN inventory_levels i ON i.variant_id = v.id AND i.location_id = 'location-main'
    ${includeInactive ? "" : "WHERE p.status = 'ACTIVE'"}
    ORDER BY p.sort_order, p.name`));

  const [benefits, storyImages] = await Promise.all([
    allRows<{ id: string; productId: string; benefit: string; sortOrder: number }>(db.prepare(`SELECT
      id, product_id AS productId, benefit, sort_order AS sortOrder
      FROM product_benefits ORDER BY product_id, sort_order`)),
    allRows<{ id: string; productId: string; image: string; alt: string; eyebrow: string | null; title: string | null; copy: string | null; position: string; sortOrder: number }>(db.prepare(`SELECT
      id, product_id AS productId, image_url AS image, alt_text AS alt,
      eyebrow, title, copy, position, sort_order AS sortOrder
      FROM product_media WHERE usage = 'STORY' ORDER BY product_id, sort_order`)),
  ]);

  return products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    shortName: product.shortName,
    price: product.priceMinor / 100,
    currency: product.currency,
    badge: product.badge,
    description: product.description,
    detail: product.detail,
    ingredients: product.ingredients,
    ritual: product.ritual,
    volume: product.volume,
    image: product.image ?? "",
    editorial: product.editorial ?? product.image ?? "",
    editorialPosition: product.editorialPosition ?? "center",
    texture: product.texture,
    benefits: benefits.filter((benefit) => benefit.productId === product.id).map((benefit) => benefit.benefit),
    storyImages: storyImages.filter((story) => story.productId === product.id).map((story) => ({
      id: story.id,
      image: story.image,
      alt: story.alt,
      eyebrow: story.eyebrow ?? "",
      title: story.title ?? "",
      copy: story.copy ?? "",
      position: story.position,
      sortOrder: story.sortOrder,
    })),
    stock: Math.max(0, product.stock),
    active: product.status === "ACTIVE",
    sortOrder: product.sortOrder,
  }));
}

export async function loadBundles(db: D1Database, includeInactive = false) {
  const bundles = await allRows<{
    id: string; slug: string; name: string; title: string; description: string; status: string; sortOrder: number;
  }>(db.prepare(`SELECT id, slug, name, title, description, status, sort_order AS sortOrder
    FROM bundles ${includeInactive ? "" : "WHERE status = 'ACTIVE'"} ORDER BY sort_order, name`));
  const steps = await allRows<{
    id: string; bundleId: string; label: string; description: string; minSelections: number; maxSelections: number; sortOrder: number;
  }>(db.prepare(`SELECT id, bundle_id AS bundleId, name AS label, prompt AS description,
    min_selections AS minSelections, max_selections AS maxSelections, sort_order AS sortOrder
    FROM bundle_steps ORDER BY bundle_id, sort_order`));
  const options = await allRows<{
    id: string; stepId: string; productId: string; enabled: number; isDefault: number; sortOrder: number;
  }>(db.prepare(`SELECT o.id, o.step_id AS stepId, p.id AS productId,
    o.enabled, o.is_default AS isDefault, o.sort_order AS sortOrder
    FROM bundle_step_options o
    JOIN product_variants v ON v.id = o.product_variant_id
    JOIN products p ON p.id = v.product_id
    ORDER BY o.step_id, o.sort_order`));

  return bundles.map((bundle) => ({
    id: bundle.id,
    slug: bundle.slug,
    name: bundle.name,
    title: bundle.title,
    description: bundle.description,
    active: bundle.status === "ACTIVE",
    sortOrder: bundle.sortOrder,
    steps: steps.filter((step) => step.bundleId === bundle.id).map((step) => ({
      id: step.id,
      label: step.label,
      description: step.description,
      productIds: options.filter((option) => option.stepId === step.id && option.enabled).map((option) => option.productId),
      defaultProductId: options.find((option) => option.stepId === step.id && option.enabled && option.isDefault)?.productId ?? null,
      minSelections: step.minSelections,
      maxSelections: step.maxSelections,
      sortOrder: step.sortOrder,
    })),
  }));
}

export async function storefrontPayload(db: D1Database) {
  const [settingsRow, socials, products, slides, gallery, bundles, sections] = await Promise.all([
    db.prepare(`SELECT brand_name AS storeName, support_email AS supportEmail,
      whatsapp_e164 AS whatsappE164, whatsapp_display AS whatsappDisplay,
      announcement, currency, country, shipping_fee_minor AS shippingFeeMinor,
      free_shipping_threshold_minor AS shippingThresholdMinor
      FROM store_settings WHERE id = 'default'`).first<{
        storeName: string; supportEmail: string; whatsappE164: string; whatsappDisplay: string;
        announcement: string; currency: string; country: string; shippingFeeMinor: number; shippingThresholdMinor: number;
      }>(),
    allRows<{ platform: string; handle: string | null; url: string }>(db.prepare("SELECT platform, handle, url FROM social_links WHERE enabled = 1 ORDER BY sort_order")),
    loadProducts(db),
    allRows<{ id: string; image: string; eyebrow: string; title: string; emphasis: string; copy: string; caption: string; tone: "dark" | "light"; position: string; active: number; sortOrder: number }>(db.prepare(`SELECT
      id, image_url AS image, eyebrow, title, emphasis, copy, caption, tone,
      position, enabled AS active, sort_order AS sortOrder
      FROM slides WHERE enabled = 1 ORDER BY sort_order`)),
    allRows<{ id: string; image: string; alt: string; caption: string; href: string; active: number; sortOrder: number }>(db.prepare(`SELECT
      id, image_url AS image, alt_text AS alt, caption, href, enabled AS active,
      sort_order AS sortOrder FROM gallery_items WHERE enabled = 1 ORDER BY sort_order`)),
    loadBundles(db),
    allRows<{ id: string; key: string; type: string; eyebrow: string | null; heading: string | null; body: string | null; ctaLabel: string | null; ctaUrl: string | null; sortOrder: number }>(db.prepare(`SELECT
      id, section_key AS key, section_type AS type, eyebrow, heading, body,
      cta_label AS ctaLabel, cta_url AS ctaUrl, sort_order AS sortOrder
      FROM page_sections WHERE page_id = 'page-home' AND visible = 1 ORDER BY sort_order`)),
  ]);
  if (!settingsRow) throw new ApiError(503, "SETTINGS_UNAVAILABLE", "Store settings are not available yet.");
  const instagram = socials.find((link) => link.platform === "instagram");
  const facebook = socials.find((link) => link.platform === "facebook");
  return {
    settings: {
      storeName: settingsRow.storeName,
      supportEmail: settingsRow.supportEmail,
      whatsappDisplay: settingsRow.whatsappDisplay,
      whatsappNumber: settingsRow.whatsappE164.replace(/^\+/u, ""),
      instagramHandle: instagram?.handle ?? "",
      instagramUrl: instagram?.url ?? "",
      facebookUrl: facebook?.url ?? "",
      announcement: settingsRow.announcement,
      shippingThreshold: settingsRow.shippingThresholdMinor / 100,
      shippingFee: settingsRow.shippingFeeMinor / 100,
      currency: settingsRow.currency,
      country: settingsRow.country,
    },
    products,
    slides: slides.map((slide) => ({ ...slide, active: Boolean(slide.active) })),
    gallery: gallery.map((item) => ({ ...item, active: Boolean(item.active) })),
    bundles,
    sections,
  };
}

export async function handleStorefront(db: D1Database): Promise<Response> {
  const payload = await storefrontPayload(db);
  const response = ok(payload);
  response.headers.set("cache-control", "public, max-age=60, stale-while-revalidate=300");
  return response;
}
