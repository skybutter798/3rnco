import { hashPassword } from "./crypto";

type ProductSeed = {
  id: string;
  name: string;
  shortName: string;
  priceMinor: number;
  sku: string;
  badge: string;
  description: string;
  detail: string;
  ingredients: string;
  ritual: string;
  volume: string;
  image: string;
  editorial: string;
  editorialPosition?: string;
  texture: string;
  benefits: string[];
  storyImages: Array<{
    image: string;
    alt: string;
    eyebrow: string;
    title: string;
    copy: string;
    position?: string;
  }>;
};

export const productionProductSeeds: ProductSeed[] = [
  {
    id: "body-cream",
    name: "Body Cream",
    shortName: "Cream",
    priceMinor: 6900,
    sku: "3R-BC-STD",
    badge: "Texture 02",
    description: "A velvety moringa body cream for skin that needs lasting comfort.",
    detail: "A rich yet easy-to-spread cream designed as the final layer of your daily ritual. Moringa extract and plant oils leave skin feeling soft, supple and cared for, while kaffir lime adds a fresh botanical note.",
    ingredients: "Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.",
    ritual: "Massage a small amount into clean, slightly damp skin, focusing on elbows, knees and areas that need extra comfort.",
    volume: "Extra hydration · Jar",
    image: "/images/products/body-cream.webp",
    editorial: "/images/product-stories/body-cream-poster-v2.png",
    editorialPosition: "50% 50%",
    texture: "Velvety and cushion-rich, with a smooth finish and fresh botanical scent.",
    benefits: ["Helps soften dry-feeling skin", "Comforting moisture for daily care", "Moringa and plant-oil blend"],
    storyImages: [
      { image: "/images/generated-v3/body-cream-texture-v4.webp", alt: "Ivory cream texture with fresh moringa and kaffir lime peel", eyebrow: "Texture study", title: "A richer layer of care.", copy: "Velvety cream wraps skin in comforting moisture, with moringa extract and plant oils at the centre." },
      { image: "/images/generated-v3/body-cream-ritual-v3.webp", alt: "A hand slowly smoothing body cream over a forearm", eyebrow: "The application", title: "Smooth. Press. Restore.", copy: "Warm a small amount between the palms, then massage it over clean, slightly damp skin in slow, upward movements." },
    ],
  },
  {
    id: "champion-soap",
    name: "Champion Soap Bar",
    shortName: "Soap",
    priceMinor: 5700,
    sku: "3R-CS-BAR",
    badge: "Cleansing companion",
    description: "A grounding scrub bar that begins the everyday ritual with water.",
    detail: "A handmade cleansing bar with a tactile mineral finish. Begin with warm water, work gently between the hands, and rinse thoroughly.",
    ingredients: "Aqua, sodium hydroxide, extra virgin olive oil, moringa powder, black seed powder, coconut powder, ginger, lime and vanilla essential oils.",
    ritual: "Work between wet hands, glide over skin and rinse thoroughly.",
    volume: "Handmade scrub bar",
    image: "/images/products/champion-soap.webp",
    editorial: "/images/product-stories/champion-soap-poster-v2.png",
    editorialPosition: "50% 50%",
    texture: "A firm handmade bar with a gently tactile scrub character.",
    benefits: ["Fresh-feeling cleanse", "Tactile body polish", "Easy everyday ritual"],
    storyImages: [
      { image: "/images/generated-v3/soap-lather-v3.webp", alt: "Irregular translucent handmade soap bar covered in fresh lather", eyebrow: "The true soap character", title: "Handmade, tactile, alive.", copy: "The irregular translucent bar and active lather follow the supplied soap reference, rebuilt as a fresh editorial scene." },
      { image: "/images/generated-v3/soap-oil-study-v3.webp", alt: "Translucent soap beside golden botanical oil and fresh moringa", eyebrow: "Cleansing study", title: "Water first. Pressure light.", copy: "Build a soft lather between wet hands, glide over the body and rinse well before the next layer." },
    ],
  },
  {
    id: "tree-body-oil",
    name: "Tree Body Oil",
    shortName: "Body Oil",
    priceMinor: 13800,
    sku: "3R-TBO-FULL",
    badge: "Texture 01",
    description: "The signature botanical oil, made for a slow and sensorial finish.",
    detail: "Our signature body ritual blends familiar botanical oils into a sensorial finishing layer. Apply sparingly and massage with intention.",
    ingredients: "Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.",
    ritual: "Apply a small amount to slightly damp skin and massage gently.",
    volume: "Full size · Pump bottle",
    image: "/images/products/tree-body-oil.webp",
    editorial: "/images/product-stories/tree-body-oil-poster-v2.png",
    editorialPosition: "50% 50%",
    texture: "Silken, fluid and luminous with a warm botanical aroma.",
    benefits: ["Massage-friendly glide", "Soft-looking finish", "Signature moringa ritual"],
    storyImages: [
      { image: "/images/generated-v3/body-oil-texture-v3.webp", alt: "Luminous golden botanical oil with a fresh moringa branch", eyebrow: "Oil study", title: "A luminous finishing layer.", copy: "A little goes a long way: the fluid texture offers enough slip for a slow, considered massage." },
      { image: "/images/generated-v3/body-oil-ritual-v3.webp", alt: "A hand massaging body oil over a forearm", eyebrow: "The application", title: "Begin on damp skin.", copy: "Apply sparingly after bathing so the oil can move easily while the skin still holds a trace of water." },
    ],
  },
  {
    id: "tree-body-oil-travel",
    name: "Tree Body Oil Travel",
    shortName: "Travel Oil",
    priceMinor: 4900,
    sku: "3R-TBO-10ML",
    badge: "Keep it close",
    description: "A compact companion for care beyond home.",
    detail: "The signature ritual in a 10ml roll-on for your daily bag, weekend ritual or first introduction to 3R&Co.",
    ingredients: "Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.",
    ritual: "Keep close and use whenever your day needs a softer reset.",
    volume: "10ml · Roll-on",
    image: "/images/product-stories/tree-body-oil-travel-single-v2.png",
    editorial: "/images/product-stories/tree-body-oil-travel-single-v2.png",
    editorialPosition: "50% 50%",
    texture: "The same silken oil ritual in a controlled, compact format.",
    benefits: ["Single 10ml bottle", "Bag-ready format", "Targeted roll-on ritual"],
    storyImages: [
      { image: "/images/generated-v3/travel-pouch-v3.webp", alt: "One small amber roll-on oil bottle beside a linen travel pouch", eyebrow: "One small oil", title: "Moringa travels, too.", copy: "The small format keeps the collection's central botanical story close without adding a second product." },
      { image: "/images/generated-v3/travel-hand-v3.webp", alt: "A hand holding one small amber travel oil above an everyday bag", eyebrow: "Keep it close", title: "A pause that fits the day.", copy: "Roll a small amount onto the skin whenever you want to return to the familiar 3R&Co ritual." },
    ],
  },
];

export const productionSlideSeeds = [
  { id: "slide-moringa-heart", image: "/images/moringa-slider/moringa-product-ritual.webp", eyebrow: "Main ingredient · Moringa leaves", title: "From moringa,", emphasis: "care takes root.", copy: "Fresh moringa leaves are the botanical centre of our Body Oil and Body Cream ritual.", caption: "Body Oil · Body Cream · Since 2019", tone: "dark", position: "center" },
  { id: "slide-leaf-study", image: "/images/generated-v3/slider-botanical-leaf-v3.webp", eyebrow: "Our beginning · Since 2019", title: "Care began", emphasis: "at home.", copy: "Since 2019, 3R&Co has grown from family care into an everyday body ritual rooted in moringa.", caption: "Family care · Since 2019", tone: "light", position: "center" },
  { id: "slide-rooted-moringa", image: "/images/moringa-slider/moringa-ingredient-table.webp", eyebrow: "The complete ritual", title: "Rooted in", emphasis: "moringa.", copy: "One botanical story, expressed through a fluid Body Oil and a rich Body Cream texture.", caption: "Two textures · One botanical heart", tone: "light", position: "center" },
] as const;

export const productionGallerySeeds = [
  ["gallery-brand-ritual", "/images/instagram/brand-ritual.jpg", "3R&Co Body Cream, Body Oil and cleansing bar with green fruit and botanicals", "Care began at home.", "https://www.instagram.com/3rnco/p/DbdV8N1iT0h/"],
  ["gallery-body-oil", "/images/instagram/body-oil.jpg", "Full-size and travel Tree Body Oil bottles among fresh green fruit", "Two sizes. One familiar ritual.", "https://www.instagram.com/3rnco/p/Dbdbei4CVva/"],
  ["gallery-family-care", "/images/instagram/family-care.jpg", "A woman applying body oil during a quiet family-care moment", "Care, held close.", "https://www.instagram.com/3rnco/p/Dbrmj6hCee8/"],
  ["gallery-oil-texture", "/images/instagram/oil-texture.jpg", "A 3R&Co Tree Body Oil pump bottle being used", "A little warmth, returned to skin.", "https://www.instagram.com/3rnco/p/Dbdbei4CVva/"],
  ["gallery-story-products", "/images/instagram/story-products.jpg", "3R&Co products with the words Made for one, now shared with the right ones", "Made for one. Shared with the right ones.", "https://www.instagram.com/3rnco/p/DbesZwppgDA/"],
  ["gallery-care-home", "/images/instagram/care-began-home.jpg", "3R&Co body ritual products with the words Began at home", "Two textures. One complete ritual.", "https://www.instagram.com/3rnco/p/DbdV8N1iT0h/"],
  ["gallery-body-cream", "/images/instagram/body-cream.jpg", "Golden botanical oil in a shallow bowl with a wooden spoon", "Botanical oil, slowly gathered.", "https://www.instagram.com/3rnco/p/Dbdbei4CVva/"],
  ["gallery-heritage", "/images/instagram-more/heritage-reel.jpg", "3R&Co small travel oil in a warm home interior", "The small ritual, kept close.", "https://www.instagram.com/3rnco/reel/C-Uvs3RSHZE/"],
  ["gallery-care", "/images/instagram-more/care-reel.jpg", "3R&Co body-care texture being massaged into skin", "Feel the wonder in every layer.", "https://www.instagram.com/3rnco/reel/Cd-P866p5CK/"],
  ["gallery-ritual", "/images/instagram-more/ritual-reel.jpg", "3R&Co Body Cream and Tree Body Oil together", "Two textures, one decision.", "https://www.instagram.com/3rnco/reel/DEPZlQiSBJ3/"],
  ["gallery-moringa", "/images/instagram-more/moringa-reel.jpg", "3R&Co green botanical product packaging", "Hello to a botanical favourite.", "https://www.instagram.com/3rnco/reel/CsXeNU5s0LG/"],
] as const;

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += 75) {
    await db.batch(statements.slice(offset, offset + 75));
  }
}

export async function seedProductionDatabase(db: D1Database): Promise<void> {
  const existingSeed = await db.prepare("SELECT value FROM app_state WHERE key = 'production_content_seed'").first<{ value: string }>();
  if (existingSeed?.value === "1") return;

  const adminExists = await db.prepare("SELECT id FROM users WHERE username_normalized = 'admin' LIMIT 1").first<{ id: string }>();
  if (!adminExists) {
    const passwordHash = await hashPassword("88888888");
    await db.prepare(`
      INSERT OR IGNORE INTO users
        (id, username, username_normalized, password_hash, role, status, must_change_password)
      VALUES ('user-admin', 'admin', 'admin', ?, 'ADMIN', 'ACTIVE', 1)
    `).bind(passwordHash).run();
  }

  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO store_settings
      (id, brand_name, tagline, support_email, whatsapp_e164, whatsapp_display, announcement, currency, country,
       shipping_fee_minor, free_shipping_threshold_minor, seo_title, seo_description)
      VALUES ('default', '3R&Co Malaysia', 'Relieve. Restore. Rejuvenate.', 'support@3rnco.com.my',
       '+60177816398', '+60 17-781 6398', 'Moringa-led body care · Made in Malaysia', 'MYR', 'Malaysia', 1200, 18000,
       '3R&Co. — Relieve. Restore. Rejuvenate',
       'Moringa-led body care made in Malaysia: botanical body oil, body cream and considered daily rituals.')`),
    db.prepare("INSERT OR IGNORE INTO social_links (id, platform, handle, url, enabled, sort_order) VALUES ('social-instagram', 'instagram', '@3rnco', 'https://www.instagram.com/3rnco', 1, 1)"),
    db.prepare("INSERT OR IGNORE INTO social_links (id, platform, handle, url, enabled, sort_order) VALUES ('social-facebook', 'facebook', 'officially3randco', 'https://www.facebook.com/officially3randco/', 1, 2)"),
    db.prepare("INSERT OR IGNORE INTO pages (id, slug, title, status) VALUES ('page-home', 'home', '3R&Co Home', 'PUBLISHED')"),
    db.prepare("INSERT OR IGNORE INTO sliders (id, slug, name, enabled) VALUES ('slider-moringa', 'moringa-campaign', 'Moringa campaign', 1)"),
    db.prepare("INSERT OR IGNORE INTO inventory_locations (id, name, active) VALUES ('location-main', 'Main stock', 1)"),
    db.prepare(`INSERT OR IGNORE INTO bundles
      (id, slug, name, title, cta_label, description, selection_mode, pricing_mode, status, sort_order)
      VALUES ('two-step-set', 'two-step-set', 'Build the two-step set', 'Choose two textures. Make it yours.', 'Build the two-step set',
      'Begin with a cleansing step, then choose the finishing layer that suits your ritual.',
      'MIX_MATCH', 'SUM_ITEMS', 'ACTIVE', 1)`),
    db.prepare(`INSERT OR IGNORE INTO bundle_steps
      (id, bundle_id, step_number, name, prompt, min_selections, max_selections, required, sort_order)
      VALUES ('two-step-cleanse', 'two-step-set', 1, 'Step one · Cleanse', 'Choose the first movement.', 1, 1, 1, 1)`),
    db.prepare(`INSERT OR IGNORE INTO bundle_steps
      (id, bundle_id, step_number, name, prompt, min_selections, max_selections, required, sort_order)
      VALUES ('two-step-finish', 'two-step-set', 2, 'Step two · Layer', 'Choose a cream or oil finish.', 1, 1, 1, 2)`),
  ];

  const sectionSeeds = [
    ["section-hero", "hero", "hero", "A ritual, rooted in care.", "Moringa-led body care, made in Malaysia for slower everyday moments.", 1],
    ["section-story", "story", "editorial", "Care began at home.", "3R&Co grew from a familiar instinct: to care for the people closest to us with ingredients and rituals that feel grounded.", 2],
    ["section-collection", "collection", "products", "Four ways to return to care.", "Explore cleansing, hydration and botanical oil textures for home and travel.", 3],
    ["section-ritual", "ritual", "editorial", "A ritual in considered layers.", "Begin with water, follow with texture, and finish slowly.", 4],
    ["section-gifting", "gifting", "editorial", "A considered gift.", "Build a ritual for birthdays, thank-yous, or simply because care is worth sharing.", 5],
    ["section-social", "social", "gallery", "Follow the ritual.", "Botanical studies, familiar textures and care held close.", 6],
    ["section-newsletter", "newsletter", "form", "Notes from the studio.", "Occasional product rituals and stories, sent with care.", 7],
  ] as const;
  for (const [id, key, type, heading, body, sortOrder] of sectionSeeds) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO page_sections
      (id, page_id, section_key, section_type, heading, body, visible, sort_order)
      VALUES (?, 'page-home', ?, ?, ?, ?, 1, ?)`)
      .bind(id, key, type, heading, body, sortOrder));
  }

  productionProductSeeds.forEach((product, productIndex) => {
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO products
        (id, slug, name, short_name, badge, description, detail, ingredients, ritual, volume, texture, status, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`)
        .bind(product.id, product.id, product.name, product.shortName, product.badge, product.description, product.detail, product.ingredients, product.ritual, product.volume, product.texture, productIndex + 1),
      db.prepare(`INSERT OR IGNORE INTO product_variants
        (id, product_id, sku, title, price_minor, currency, track_inventory, status)
        VALUES (?, ?, ?, 'Default', ?, 'MYR', 1, 'ACTIVE')`)
        .bind(`variant-${product.id}`, product.id, product.sku, product.priceMinor),
      db.prepare(`INSERT OR IGNORE INTO inventory_levels
        (variant_id, location_id, on_hand, reserved, reorder_threshold)
        VALUES (?, 'location-main', 0, 0, 0)`)
        .bind(`variant-${product.id}`),
      db.prepare(`INSERT OR IGNORE INTO product_media
        (id, product_id, usage, image_url, alt_text, position, sort_order)
        VALUES (?, ?, 'PACKSHOT', ?, ?, 'center', 0)`)
        .bind(`media-${product.id}-packshot`, product.id, product.image, product.name),
      db.prepare(`INSERT OR IGNORE INTO product_media
        (id, product_id, usage, image_url, alt_text, position, sort_order)
        VALUES (?, ?, 'EDITORIAL', ?, ?, ?, 0)`)
        .bind(`media-${product.id}-editorial`, product.id, product.editorial, `${product.name} editorial`, product.editorialPosition ?? "center"),
    );
    product.benefits.forEach((benefit, index) => {
      statements.push(db.prepare("INSERT OR IGNORE INTO product_benefits (id, product_id, benefit, sort_order) VALUES (?, ?, ?, ?)")
        .bind(`benefit-${product.id}-${index + 1}`, product.id, benefit, index + 1));
    });
    product.storyImages.forEach((story, index) => {
      statements.push(db.prepare(`INSERT OR IGNORE INTO product_media
        (id, product_id, usage, image_url, alt_text, eyebrow, title, copy, position, sort_order)
        VALUES (?, ?, 'STORY', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(`media-${product.id}-story-${index + 1}`, product.id, story.image, story.alt, story.eyebrow, story.title, story.copy, story.position ?? "center", index + 1));
    });
  });

  productionSlideSeeds.forEach((slide, index) => {
    statements.push(db.prepare(`INSERT OR IGNORE INTO slides
      (id, slider_id, image_url, eyebrow, title, emphasis, copy, caption, tone, position, enabled, sort_order)
      VALUES (?, 'slider-moringa', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(slide.id, slide.image, slide.eyebrow, slide.title, slide.emphasis, slide.copy, slide.caption, slide.tone, slide.position, index + 1));
  });

  productionGallerySeeds.forEach(([id, image, alt, caption, href], index) => {
    statements.push(db.prepare(`INSERT OR IGNORE INTO gallery_items
      (id, image_url, alt_text, caption, href, enabled, sort_order)
      VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .bind(id, image, alt, caption, href, index + 1));
  });

  statements.push(
    db.prepare(`INSERT OR IGNORE INTO bundle_step_options
      (id, step_id, product_variant_id, enabled, is_default, price_adjustment_minor, sort_order)
      VALUES ('option-two-step-soap', 'two-step-cleanse', 'variant-champion-soap', 1, 1, 0, 1)`),
    db.prepare(`INSERT OR IGNORE INTO bundle_step_options
      (id, step_id, product_variant_id, enabled, is_default, price_adjustment_minor, sort_order)
      VALUES ('option-two-step-oil', 'two-step-finish', 'variant-tree-body-oil', 1, 1, 0, 1)`),
    db.prepare(`INSERT OR IGNORE INTO bundle_step_options
      (id, step_id, product_variant_id, enabled, is_default, price_adjustment_minor, sort_order)
      VALUES ('option-two-step-cream', 'two-step-finish', 'variant-body-cream', 1, 0, 0, 2)`),
    db.prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES ('schema_version', '3', unixepoch())"),
    db.prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES ('production_content_seed', '1', unixepoch())"),
  );

  await runBatches(db, statements);
  await db.prepare("PRAGMA optimize").run();
}
