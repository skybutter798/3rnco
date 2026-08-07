CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(128) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    role VARCHAR(20) NOT NULL,
    username VARCHAR(64) NULL,
    email VARCHAR(191) NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    display_name VARCHAR(150) NULL,
    phone VARCHAR(40) NULL,
    date_of_birth DATE NULL,
    marketing_consent TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
    email_verified_at DATETIME NULL,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_users_public_id (public_id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role_status (role, status),
    KEY idx_users_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_addresses (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    label VARCHAR(80) NOT NULL,
    recipient_name VARCHAR(200) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    line1 VARCHAR(255) NOT NULL,
    line2 VARCHAR(255) NULL,
    city VARCHAR(120) NOT NULL,
    state VARCHAR(120) NOT NULL,
    postcode VARCHAR(20) NOT NULL,
    country_code CHAR(2) NOT NULL DEFAULT 'MY',
    is_default_shipping TINYINT(1) NOT NULL DEFAULT 0,
    is_default_billing TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_user_addresses_public_id (public_id),
    KEY idx_user_addresses_user_id (user_id),
    CONSTRAINT fk_user_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    csrf_hash CHAR(64) NOT NULL,
    ip_hash CHAR(64) NOT NULL,
    user_agent_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    KEY idx_auth_sessions_user (user_id, revoked_at),
    KEY idx_auth_sessions_expiry (expires_at),
    CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_hash CHAR(64) NOT NULL PRIMARY KEY,
    hits INT UNSIGNED NOT NULL,
    window_started_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
    value_json LONGTEXT NOT NULL,
    is_public TINYINT(1) NOT NULL DEFAULT 1,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    sku VARCHAR(80) NULL,
    name VARCHAR(180) NOT NULL,
    short_name VARCHAR(100) NOT NULL,
    price_cents INT UNSIGNED NOT NULL,
    stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    badge VARCHAR(120) NULL,
    description TEXT NOT NULL,
    detail TEXT NULL,
    ingredients TEXT NULL,
    ritual TEXT NULL,
    volume VARCHAR(160) NULL,
    image_url VARCHAR(500) NOT NULL,
    editorial_url VARCHAR(500) NULL,
    editorial_position VARCHAR(80) NULL,
    texture TEXT NULL,
    benefits_json LONGTEXT NOT NULL,
    story_images_json LONGTEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_products_sku (sku),
    KEY idx_products_status_sort (status, sort_order)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS slides (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    image_url VARCHAR(500) NOT NULL,
    eyebrow VARCHAR(180) NULL,
    title VARCHAR(220) NOT NULL,
    emphasis VARCHAR(220) NULL,
    copy_text TEXT NULL,
    caption VARCHAR(255) NULL,
    tone VARCHAR(20) NOT NULL DEFAULT 'light',
    position_value VARCHAR(80) NOT NULL DEFAULT 'center',
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY idx_slides_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gallery_items (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    image_url VARCHAR(500) NOT NULL,
    alt_text VARCHAR(500) NOT NULL,
    caption VARCHAR(255) NULL,
    href VARCHAR(500) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY idx_gallery_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bundles (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    title VARCHAR(255) NULL,
    description TEXT NULL,
    pricing_mode VARCHAR(20) NOT NULL DEFAULT 'sum',
    fixed_price_cents INT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY idx_bundles_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bundle_steps (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    bundle_id VARCHAR(64) NOT NULL,
    name VARCHAR(180) NOT NULL,
    prompt_text VARCHAR(255) NULL,
    min_select INT UNSIGNED NOT NULL DEFAULT 1,
    max_select INT UNSIGNED NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    KEY idx_bundle_steps_bundle_sort (bundle_id, sort_order),
    CONSTRAINT fk_bundle_steps_bundle FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bundle_step_products (
    step_id VARCHAR(64) NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    price_adjustment_cents INT NOT NULL DEFAULT 0,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (step_id, product_id),
    KEY idx_bundle_step_products_product (product_id),
    CONSTRAINT fk_bundle_step_products_step FOREIGN KEY (step_id) REFERENCES bundle_steps(id) ON DELETE CASCADE,
    CONSTRAINT fk_bundle_step_products_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    code VARCHAR(64) NOT NULL,
    description VARCHAR(255) NOT NULL,
    discount_type VARCHAR(30) NOT NULL,
    value_int INT UNSIGNED NOT NULL DEFAULT 0,
    minimum_subtotal_cents INT UNSIGNED NOT NULL DEFAULT 0,
    max_discount_cents INT UNSIGNED NULL,
    starts_at DATETIME NULL,
    ends_at DATETIME NULL,
    usage_limit INT UNSIGNED NULL,
    per_customer_limit INT UNSIGNED NULL,
    use_count INT UNSIGNED NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_promos_public_id (public_id),
    UNIQUE KEY uq_promos_code (code),
    KEY idx_promos_active_dates (is_active, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    order_number VARCHAR(40) NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending_payment',
    payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    payment_method VARCHAR(40) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'MYR',
    subtotal_cents INT UNSIGNED NOT NULL,
    discount_cents INT UNSIGNED NOT NULL DEFAULT 0,
    shipping_cents INT UNSIGNED NOT NULL DEFAULT 0,
    total_cents INT UNSIGNED NOT NULL,
    promo_id BIGINT UNSIGNED NULL,
    promo_code VARCHAR(64) NULL,
    contact_json LONGTEXT NOT NULL,
    shipping_address_json LONGTEXT NOT NULL,
    bundle_metadata_json LONGTEXT NULL,
    idempotency_hash CHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    inventory_reserved_until DATETIME NULL,
    tracking_number VARCHAR(120) NULL,
    internal_note TEXT NULL,
    inventory_restored_at DATETIME NULL,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_orders_public_id (public_id),
    UNIQUE KEY uq_orders_order_number (order_number),
    UNIQUE KEY uq_orders_customer_idempotency (customer_id, idempotency_hash),
    KEY idx_orders_customer_created (customer_id, created_at),
    KEY idx_orders_status_created (status, created_at),
    KEY idx_orders_reservation_expiry (status, inventory_reserved_until),
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_orders_promo FOREIGN KEY (promo_id) REFERENCES promos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    product_name VARCHAR(180) NOT NULL,
    sku VARCHAR(80) NULL,
    unit_price_cents INT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    line_total_cents INT UNSIGNED NOT NULL,
    bundle_id VARCHAR(64) NULL,
    bundle_step_id VARCHAR(64) NULL,
    bundle_group_id VARCHAR(64) NULL,
    bundle_metadata_json LONGTEXT NULL,
    created_at DATETIME NOT NULL,
    KEY idx_order_items_order (order_id),
    KEY idx_order_items_product (product_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promo_redemptions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    promo_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    discount_cents INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uq_promo_redemptions_order (order_id),
    KEY idx_promo_redemptions_promo_user (promo_id, user_id),
    CONSTRAINT fk_promo_redemptions_promo FOREIGN KEY (promo_id) REFERENCES promos(id) ON DELETE RESTRICT,
    CONSTRAINT fk_promo_redemptions_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_promo_redemptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_movements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    quantity_delta INT NOT NULL,
    reason VARCHAR(80) NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL,
    KEY idx_inventory_movements_product_created (product_id, created_at),
    KEY idx_inventory_movements_order (order_id),
    CONSTRAINT fk_inventory_movements_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_movements_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_movements_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enquiries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(191) NOT NULL,
    phone VARCHAR(40) NULL,
    channel VARCHAR(30) NOT NULL DEFAULT 'website',
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'new',
    admin_notes TEXT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_enquiries_public_id (public_id),
    KEY idx_enquiries_status_created (status, created_at),
    KEY idx_enquiries_user (user_id),
    CONSTRAINT fk_enquiries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enquiry_replies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    enquiry_id BIGINT UNSIGNED NOT NULL,
    author_user_id BIGINT UNSIGNED NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uq_enquiry_replies_public_id (public_id),
    KEY idx_enquiry_replies_enquiry_created (enquiry_id, created_at),
    CONSTRAINT fk_enquiry_replies_enquiry FOREIGN KEY (enquiry_id) REFERENCES enquiries(id) ON DELETE CASCADE,
    CONSTRAINT fk_enquiry_replies_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    email VARCHAR(191) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'subscribed',
    source VARCHAR(80) NOT NULL DEFAULT 'storefront',
    subscribed_at DATETIME NOT NULL,
    unsubscribed_at DATETIME NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_newsletter_public_id (public_id),
    UNIQUE KEY uq_newsletter_email (email)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uploads (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    public_url VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    width_px INT UNSIGNED NOT NULL,
    height_px INT UNSIGNED NOT NULL,
    sha256 CHAR(64) NOT NULL,
    uploaded_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uq_uploads_public_id (public_id),
    UNIQUE KEY uq_uploads_stored_name (stored_name),
    KEY idx_uploads_created (created_at),
    CONSTRAINT fk_uploads_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_user_id BIGINT UNSIGNED NULL,
    action_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id VARCHAR(100) NULL,
    before_json LONGTEXT NULL,
    after_json LONGTEXT NULL,
    ip_hash CHAR(64) NOT NULL,
    user_agent_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    KEY idx_audit_logs_actor_created (actor_user_id, created_at),
    KEY idx_audit_logs_entity_created (entity_type, entity_id, created_at),
    CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
