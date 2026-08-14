CREATE TABLE IF NOT EXISTS `referral_links` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`referrer_user_id` text NOT NULL,
	`discount_basis_points` integer DEFAULT 0 NOT NULL,
	`discount_scope` text DEFAULT 'FIRST_PURCHASE' NOT NULL,
	`commission_basis_points` integer DEFAULT 0 NOT NULL,
	`attribution_days` integer DEFAULT 30 NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`referrer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_referral_links_discount" CHECK("referral_links"."discount_basis_points" between 0 and 10000),
	CONSTRAINT "ck_referral_links_commission" CHECK("referral_links"."commission_basis_points" between 0 and 10000),
	CONSTRAINT "ck_referral_links_scope" CHECK("referral_links"."discount_scope" in ('NONE', 'FIRST_PURCHASE', 'EVERY_PURCHASE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_referral_links_code` ON `referral_links` (`code`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_referral_links_referrer` ON `referral_links` (`referrer_user_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `customer_referrals` (
	`user_id` text PRIMARY KEY NOT NULL,
	`referral_link_id` text NOT NULL,
	`referrer_user_id` text NOT NULL,
	`attribution_source` text DEFAULT 'ORDER' NOT NULL,
	`attributed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`referral_link_id`) REFERENCES `referral_links`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`referrer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_customer_referrals_link` ON `customer_referrals` (`referral_link_id`,`attributed_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_customer_referrals_referrer` ON `customer_referrals` (`referrer_user_id`,`attributed_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`referral_link_id` text NOT NULL,
	`visitor_hash` text,
	`converted_user_id` text,
	`occurred_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`referral_link_id`) REFERENCES `referral_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`converted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_referral_visits_link_date` ON `referral_visits` (`referral_link_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_commissions` (
	`id` text PRIMARY KEY NOT NULL,
	`referral_link_id` text NOT NULL,
	`order_id` text NOT NULL,
	`referrer_user_id` text NOT NULL,
	`referred_user_id` text NOT NULL,
	`basis_minor` integer NOT NULL,
	`rate_basis_points` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`approved_at` integer,
	`paid_at` integer,
	`voided_at` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`referral_link_id`) REFERENCES `referral_links`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`referrer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`referred_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_referral_commissions_status" CHECK("referral_commissions"."status" in ('PENDING', 'APPROVED', 'PAID', 'VOID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_referral_commissions_order` ON `referral_commissions` (`order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_referral_commissions_referrer_status` ON `referral_commissions` (`referrer_user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_referral_commissions_link_created` ON `referral_commissions` (`referral_link_id`,`created_at`);
