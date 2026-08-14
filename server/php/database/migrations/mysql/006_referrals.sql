CREATE TABLE IF NOT EXISTS referral_links (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    referrer_user_id BIGINT UNSIGNED NOT NULL,
    discount_basis_points INT UNSIGNED NOT NULL DEFAULT 0,
    discount_scope VARCHAR(30) NOT NULL DEFAULT 'first_purchase',
    commission_basis_points INT UNSIGNED NOT NULL DEFAULT 0,
    attribution_days INT UNSIGNED NOT NULL DEFAULT 30,
    starts_at DATETIME NULL,
    ends_at DATETIME NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_referral_links_public_id (public_id),
    UNIQUE KEY uq_referral_links_code (code),
    KEY idx_referral_links_referrer_active (referrer_user_id, is_active),
    CONSTRAINT fk_referral_links_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_referrals (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    referral_link_id BIGINT UNSIGNED NOT NULL,
    referrer_user_id BIGINT UNSIGNED NOT NULL,
    attribution_source VARCHAR(30) NOT NULL DEFAULT 'order',
    attributed_at DATETIME NOT NULL,
    KEY idx_customer_referrals_link (referral_link_id, attributed_at),
    KEY idx_customer_referrals_referrer (referrer_user_id, attributed_at),
    CONSTRAINT fk_customer_referrals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_customer_referrals_link FOREIGN KEY (referral_link_id) REFERENCES referral_links(id) ON DELETE RESTRICT,
    CONSTRAINT fk_customer_referrals_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_visits (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    referral_link_id BIGINT UNSIGNED NOT NULL,
    visitor_hash CHAR(64) NULL,
    converted_user_id BIGINT UNSIGNED NULL,
    occurred_at DATETIME NOT NULL,
    UNIQUE KEY uq_referral_visits_public_id (public_id),
    KEY idx_referral_visits_link_date (referral_link_id, occurred_at),
    CONSTRAINT fk_referral_visits_link FOREIGN KEY (referral_link_id) REFERENCES referral_links(id) ON DELETE CASCADE,
    CONSTRAINT fk_referral_visits_user FOREIGN KEY (converted_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE orders ADD COLUMN referral_link_id BIGINT UNSIGNED NULL;
ALTER TABLE orders ADD COLUMN referrer_user_id BIGINT UNSIGNED NULL;
ALTER TABLE orders ADD COLUMN referral_code VARCHAR(64) NULL;
ALTER TABLE orders ADD COLUMN referral_discount_cents INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE orders ADD KEY idx_orders_referral_created (referral_link_id, created_at);
ALTER TABLE orders ADD CONSTRAINT fk_orders_referral_link FOREIGN KEY (referral_link_id) REFERENCES referral_links(id) ON DELETE SET NULL;
ALTER TABLE orders ADD CONSTRAINT fk_orders_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS referral_commissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    referral_link_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    referrer_user_id BIGINT UNSIGNED NOT NULL,
    referred_user_id BIGINT UNSIGNED NOT NULL,
    basis_cents INT UNSIGNED NOT NULL,
    rate_basis_points INT UNSIGNED NOT NULL,
    amount_cents INT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    approved_at DATETIME NULL,
    paid_at DATETIME NULL,
    voided_at DATETIME NULL,
    note TEXT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_referral_commissions_public_id (public_id),
    UNIQUE KEY uq_referral_commissions_order (order_id),
    KEY idx_referral_commissions_referrer_status (referrer_user_id, status, created_at),
    KEY idx_referral_commissions_link_created (referral_link_id, created_at),
    CONSTRAINT fk_referral_commissions_link FOREIGN KEY (referral_link_id) REFERENCES referral_links(id) ON DELETE RESTRICT,
    CONSTRAINT fk_referral_commissions_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_referral_commissions_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_referral_commissions_referred FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
