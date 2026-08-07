CREATE TABLE `auth_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_rate_limits_expiry` ON `auth_rate_limits` (`blocked_until`,`updated_at`);