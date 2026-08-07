CREATE TABLE IF NOT EXISTS `inventory_stock_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`expected_available` integer NOT NULL,
	`new_available` integer NOT NULL,
	`actor_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_inventory_stock_updates_variant`
	ON `inventory_stock_updates` (`variant_id`, `created_at`);
