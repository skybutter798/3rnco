CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`before_json` text,
	`after_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_admin_audit_created` ON `admin_audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_auth_tokens_token_hash` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_tokens_user_type` ON `auth_tokens` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `bundle_step_options` (
	`id` text PRIMARY KEY NOT NULL,
	`step_id` text NOT NULL,
	`product_variant_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`price_adjustment_minor` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`step_id`) REFERENCES `bundle_steps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bundle_step_options_variant` ON `bundle_step_options` (`step_id`,`product_variant_id`);--> statement-breakpoint
CREATE INDEX `idx_bundle_step_options_step` ON `bundle_step_options` (`step_id`,`enabled`,`sort_order`);--> statement-breakpoint
CREATE TABLE `bundle_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`bundle_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`min_selections` integer DEFAULT 1 NOT NULL,
	`max_selections` integer DEFAULT 1 NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bundle_steps_number` ON `bundle_steps` (`bundle_id`,`step_number`);--> statement-breakpoint
CREATE INDEX `idx_bundle_steps_bundle` ON `bundle_steps` (`bundle_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`cta_label` text NOT NULL,
	`description` text NOT NULL,
	`selection_mode` text DEFAULT 'MIX_MATCH' NOT NULL,
	`pricing_mode` text DEFAULT 'SUM_ITEMS' NOT NULL,
	`price_value_minor` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bundles_slug` ON `bundles` (`slug`);--> statement-breakpoint
CREATE TABLE `cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`product_variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`bundle_id` text,
	`bundle_instance_id` text,
	`bundle_step_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bundle_step_id`) REFERENCES `bundle_steps`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_cart_items_quantity" CHECK("cart_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_cart_items_cart` ON `cart_items` (`cart_id`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`anonymous_token_hash` text,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`promotion_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_carts_user` ON `carts` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `customer_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text DEFAULT 'Home' NOT NULL,
	`recipient_name` text NOT NULL,
	`phone_e164` text NOT NULL,
	`line1` text NOT NULL,
	`line2` text,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`postcode` text NOT NULL,
	`country_code` text DEFAULT 'MY' NOT NULL,
	`is_default_shipping` integer DEFAULT false NOT NULL,
	`is_default_billing` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_customer_addresses_user` ON `customer_addresses` (`user_id`);--> statement-breakpoint
CREATE TABLE `customer_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`phone_e164` text,
	`birth_date` text,
	`preferred_language` text DEFAULT 'en' NOT NULL,
	`avatar_media_id` text,
	`marketing_consent` integer DEFAULT false NOT NULL,
	`marketing_consent_source` text,
	`marketing_consent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`avatar_media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_customer_profiles_phone` ON `customer_profiles` (`phone_e164`);--> statement-breakpoint
CREATE TABLE `enquiry_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_user_id` text,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `enquiry_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_enquiry_messages_thread` ON `enquiry_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `enquiry_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`channel` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text,
	`customer_phone` text,
	`subject` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`assigned_user_id` text,
	`last_message_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_enquiry_threads_status` ON `enquiry_threads` (`status`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `gallery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`image_url` text NOT NULL,
	`media_id` text,
	`alt_text` text NOT NULL,
	`caption` text NOT NULL,
	`href` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_gallery_public` ON `gallery_items` (`enabled`,`sort_order`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer,
	`response_json` text,
	`resource_type` text,
	`resource_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_expiry` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `inventory_levels` (
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`reorder_threshold` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`variant_id`, `location_id`),
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_inventory_nonnegative" CHECK("inventory_levels"."on_hand" >= 0 and "inventory_levels"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE `inventory_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`movement_type` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`reason` text NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`actor_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_movements_variant` ON `inventory_movements` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_provider` text NOT NULL,
	`storage_key` text NOT NULL,
	`public_url` text NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer,
	`height` integer,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text,
	`alt_text` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_media_storage_key` ON `media_assets` (`storage_provider`,`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_media_created_at` ON `media_assets` (`created_at`);--> statement-breakpoint
CREATE TABLE `newsletter_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`status` text DEFAULT 'SUBSCRIBED' NOT NULL,
	`consent_at` integer DEFAULT (unixepoch()) NOT NULL,
	`unsubscribed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_newsletter_email` ON `newsletter_subscribers` (`email_normalized`);--> statement-breakpoint
CREATE TABLE `order_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`address_type` text NOT NULL,
	`recipient_name` text NOT NULL,
	`phone_e164` text NOT NULL,
	`line1` text NOT NULL,
	`line2` text,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`postcode` text NOT NULL,
	`country_code` text DEFAULT 'MY' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_addresses_type` ON `order_addresses` (`order_id`,`address_type`);--> statement-breakpoint
CREATE TABLE `order_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`adjustment_type` text NOT NULL,
	`label` text NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_order_adjustments_order` ON `order_adjustments` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`product_variant_id` text,
	`sku_snapshot` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`quantity` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	`bundle_id` text,
	`bundle_instance_id` text,
	`bundle_name_snapshot` text,
	`bundle_step_name_snapshot` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`note` text,
	`actor_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_order_status_history_order` ON `order_status_history` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`user_id` text,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text NOT NULL,
	`status` text DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	`payment_status` text DEFAULT 'PENDING' NOT NULL,
	`fulfilment_status` text DEFAULT 'UNFULFILLED' NOT NULL,
	`payment_method` text NOT NULL,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`shipping_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`promotion_id` text,
	`placed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_orders_order_number` ON `orders` (`order_number`);--> statement-breakpoint
CREATE INDEX `idx_orders_user_placed` ON `orders` (`user_id`,`placed_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_status_placed` ON `orders` (`status`,`placed_at`);--> statement-breakpoint
CREATE TABLE `page_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`section_key` text NOT NULL,
	`section_type` text NOT NULL,
	`eyebrow` text,
	`heading` text,
	`body` text,
	`cta_label` text,
	`cta_url` text,
	`media_id` text,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_page_sections_key` ON `page_sections` (`page_id`,`section_key`);--> statement-breakpoint
CREATE INDEX `idx_page_sections_public` ON `page_sections` (`page_id`,`visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'PUBLISHED' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pages_slug` ON `pages` (`slug`);--> statement-breakpoint
CREATE TABLE `payment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_reference` text,
	`amount_minor` integer NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_payment_attempts_order` ON `payment_attempts` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `product_benefits` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`benefit` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_product_benefits_product` ON `product_benefits` (`product_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `product_media` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`media_id` text,
	`usage` text NOT NULL,
	`image_url` text NOT NULL,
	`alt_text` text NOT NULL,
	`eyebrow` text,
	`title` text,
	`copy` text,
	`position` text DEFAULT 'center' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_product_media_product_usage` ON `product_media` (`product_id`,`usage`,`sort_order`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`title` text DEFAULT 'Default' NOT NULL,
	`price_minor` integer NOT NULL,
	`compare_at_minor` integer,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`track_inventory` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_product_variants_price" CHECK("product_variants"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_product_variants_sku` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_product_variants_product` ON `product_variants` (`product_id`,`status`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`badge` text NOT NULL,
	`description` text NOT NULL,
	`detail` text NOT NULL,
	`ingredients` text NOT NULL,
	`ritual` text NOT NULL,
	`volume` text NOT NULL,
	`texture` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_products_slug` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_products_public` ON `products` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `promotion_products` (
	`promotion_id` text NOT NULL,
	`product_id` text NOT NULL,
	PRIMARY KEY(`promotion_id`, `product_id`),
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `promotion_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`promotion_id` text NOT NULL,
	`user_id` text,
	`order_id` text NOT NULL,
	`discount_minor` integer NOT NULL,
	`redeemed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_promotion_redemptions_order` ON `promotion_redemptions` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_promotion_redemptions_user` ON `promotion_redemptions` (`promotion_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`discount_type` text NOT NULL,
	`value_minor` integer DEFAULT 0 NOT NULL,
	`percent_basis_points` integer DEFAULT 0 NOT NULL,
	`min_subtotal_minor` integer DEFAULT 0 NOT NULL,
	`max_discount_minor` integer,
	`usage_limit` integer,
	`per_customer_limit` integer,
	`starts_at` integer,
	`ends_at` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_promotions_code` ON `promotions` (`code`);--> statement-breakpoint
CREATE TABLE `section_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`block_type` text NOT NULL,
	`eyebrow` text,
	`heading` text,
	`body` text,
	`cta_label` text,
	`cta_url` text,
	`media_id` text,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `page_sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_section_blocks_section` ON `section_blocks` (`section_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `sliders` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sliders_slug` ON `sliders` (`slug`);--> statement-breakpoint
CREATE TABLE `slides` (
	`id` text PRIMARY KEY NOT NULL,
	`slider_id` text NOT NULL,
	`image_url` text NOT NULL,
	`media_id` text,
	`eyebrow` text NOT NULL,
	`title` text NOT NULL,
	`emphasis` text NOT NULL,
	`copy` text NOT NULL,
	`caption` text NOT NULL,
	`tone` text DEFAULT 'light' NOT NULL,
	`position` text DEFAULT 'center' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`slider_id`) REFERENCES `sliders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_slides_slider_public` ON `slides` (`slider_id`,`enabled`,`sort_order`);--> statement-breakpoint
CREATE TABLE `social_links` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`handle` text,
	`url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_social_links_platform` ON `social_links` (`platform`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_name` text NOT NULL,
	`tagline` text NOT NULL,
	`support_email` text NOT NULL,
	`whatsapp_e164` text NOT NULL,
	`whatsapp_display` text NOT NULL,
	`announcement` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`country` text DEFAULT 'Malaysia' NOT NULL,
	`shipping_fee_minor` integer DEFAULT 0 NOT NULL,
	`free_shipping_threshold_minor` integer DEFAULT 0 NOT NULL,
	`seo_title` text NOT NULL,
	`seo_description` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token_hash` text NOT NULL,
	`user_agent_hash` text,
	`ip_prefix_hash` text,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_sessions_token_hash` ON `user_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_user_sessions_user_active` ON `user_sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `idx_user_sessions_expiry` ON `user_sessions` (`absolute_expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text,
	`username_normalized` text,
	`email` text,
	`email_normalized` text,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`email_verified_at` integer,
	`password_changed_at` integer,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "ck_users_role" CHECK("users"."role" in ('ADMIN', 'CUSTOMER')),
	CONSTRAINT "ck_users_status" CHECK("users"."status" in ('ACTIVE', 'DISABLED', 'LOCKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_username_normalized` ON `users` (`username_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_email_normalized` ON `users` (`email_normalized`);--> statement-breakpoint
CREATE INDEX `idx_users_role_status` ON `users` (`role`,`status`);
--> statement-breakpoint
