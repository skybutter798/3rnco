CREATE TABLE IF NOT EXISTS referral_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    discount_basis_points INTEGER NOT NULL DEFAULT 0,
    discount_scope TEXT NOT NULL DEFAULT 'first_purchase',
    commission_basis_points INTEGER NOT NULL DEFAULT 0,
    attribution_days INTEGER NOT NULL DEFAULT 30,
    starts_at TEXT,
    ends_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (discount_basis_points BETWEEN 0 AND 10000),
    CHECK (commission_basis_points BETWEEN 0 AND 10000),
    CHECK (discount_scope IN ('none', 'first_purchase', 'every_purchase'))
);
CREATE INDEX IF NOT EXISTS idx_referral_links_referrer_active ON referral_links(referrer_user_id, is_active);

CREATE TABLE IF NOT EXISTS customer_referrals (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    referral_link_id INTEGER NOT NULL REFERENCES referral_links(id) ON DELETE RESTRICT,
    referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    attribution_source TEXT NOT NULL DEFAULT 'order',
    attributed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_referrals_link ON customer_referrals(referral_link_id, attributed_at);
CREATE INDEX IF NOT EXISTS idx_customer_referrals_referrer ON customer_referrals(referrer_user_id, attributed_at);

CREATE TABLE IF NOT EXISTS referral_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    referral_link_id INTEGER NOT NULL REFERENCES referral_links(id) ON DELETE CASCADE,
    visitor_hash TEXT,
    converted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referral_visits_link_date ON referral_visits(referral_link_id, occurred_at);

ALTER TABLE orders ADD COLUMN referral_link_id INTEGER REFERENCES referral_links(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN referrer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN referral_code TEXT;
ALTER TABLE orders ADD COLUMN referral_discount_cents INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_referral_created ON orders(referral_link_id, created_at);

CREATE TABLE IF NOT EXISTS referral_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    referral_link_id INTEGER NOT NULL REFERENCES referral_links(id) ON DELETE RESTRICT,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    referred_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    basis_cents INTEGER NOT NULL,
    rate_basis_points INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    approved_at TEXT,
    paid_at TEXT,
    voided_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (status IN ('pending', 'approved', 'paid', 'void'))
);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer_status ON referral_commissions(referrer_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_link_created ON referral_commissions(referral_link_id, created_at);

