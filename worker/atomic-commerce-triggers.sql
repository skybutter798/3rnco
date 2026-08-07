DROP TRIGGER IF EXISTS `trg_inventory_levels_validate_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_inventory_levels_validate_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_order_items_reserve_inventory`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_orders_validate_transition`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_orders_commit_paid_inventory`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_orders_release_cancelled_inventory`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_promotion_redemptions_limits`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_inventory_stock_updates_apply`;
--> statement-breakpoint
CREATE TRIGGER `trg_inventory_levels_validate_insert`
BEFORE INSERT ON `inventory_levels`
WHEN NEW.`on_hand` < 0 OR NEW.`reserved` < 0 OR NEW.`reserved` > NEW.`on_hand`
BEGIN
	SELECT RAISE(ABORT, 'INVALID_INVENTORY_BALANCE');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_inventory_levels_validate_update`
BEFORE UPDATE OF `on_hand`, `reserved` ON `inventory_levels`
WHEN NEW.`on_hand` < 0 OR NEW.`reserved` < 0 OR NEW.`reserved` > NEW.`on_hand`
BEGIN
	SELECT RAISE(ABORT, 'INVALID_INVENTORY_BALANCE');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_inventory_stock_updates_apply`
BEFORE INSERT ON `inventory_stock_updates`
BEGIN
	SELECT CASE WHEN COALESCE((
		SELECT `on_hand` FROM `inventory_levels`
		WHERE `variant_id` = NEW.`variant_id` AND `location_id` = 'location-main'
	), -1) - COALESCE((
		SELECT `reserved` FROM `inventory_levels`
		WHERE `variant_id` = NEW.`variant_id` AND `location_id` = 'location-main'
	), 0) != NEW.`expected_available`
	THEN RAISE(ABORT, 'INVENTORY_CHANGED') END;
	UPDATE `inventory_levels`
	SET `on_hand` = NEW.`new_available` + `reserved`, `updated_at` = unixepoch()
	WHERE `variant_id` = NEW.`variant_id` AND `location_id` = 'location-main';
	INSERT INTO `inventory_movements`
		(`id`, `variant_id`, `location_id`, `movement_type`, `quantity_delta`, `reason`, `reference_type`, `reference_id`, `actor_user_id`)
	SELECT 'inventory_' || lower(hex(randomblob(16))), NEW.`variant_id`, 'location-main',
		'ADJUSTMENT', NEW.`new_available` - NEW.`expected_available`, 'Admin stock correction',
		'PRODUCT', NEW.`variant_id`, NEW.`actor_user_id`
	WHERE NEW.`new_available` != NEW.`expected_available`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_order_items_reserve_inventory`
BEFORE INSERT ON `order_items`
WHEN NEW.`product_variant_id` IS NOT NULL
  AND (SELECT `track_inventory` FROM `product_variants` WHERE `id` = NEW.`product_variant_id`) = 1
BEGIN
	SELECT CASE
		WHEN COALESCE((
			SELECT `on_hand` - `reserved`
			FROM `inventory_levels`
			WHERE `variant_id` = NEW.`product_variant_id`
			  AND `location_id` = 'location-main'
		), 0) < NEW.`quantity`
		THEN RAISE(ABORT, 'INSUFFICIENT_STOCK')
	END;
	UPDATE `inventory_levels`
	SET `reserved` = `reserved` + NEW.`quantity`, `updated_at` = unixepoch()
	WHERE `variant_id` = NEW.`product_variant_id`
	  AND `location_id` = 'location-main';
END;
--> statement-breakpoint
CREATE TRIGGER `trg_orders_validate_transition`
BEFORE UPDATE OF `status`, `payment_status` ON `orders`
WHEN OLD.`status` != NEW.`status` OR OLD.`payment_status` != NEW.`payment_status`
BEGIN
	SELECT CASE WHEN NOT (
		(OLD.`status` = 'PENDING_PAYMENT' AND OLD.`payment_status` = 'PENDING'
			AND NEW.`status` = 'PAYMENT_CONFIRMED' AND NEW.`payment_status` = 'PAID')
		OR (OLD.`status` = 'PENDING_PAYMENT' AND OLD.`payment_status` = 'PENDING'
			AND NEW.`status` = 'CANCELLED' AND NEW.`payment_status` = 'PENDING')
		OR (OLD.`status` = 'PAYMENT_CONFIRMED' AND OLD.`payment_status` = 'PAID'
			AND NEW.`status` = 'PROCESSING' AND NEW.`payment_status` = 'PAID')
		OR (OLD.`status` = 'PROCESSING' AND OLD.`payment_status` = 'PAID'
			AND NEW.`status` = 'PACKING' AND NEW.`payment_status` = 'PAID')
		OR (OLD.`status` = 'PACKING' AND OLD.`payment_status` = 'PAID'
			AND NEW.`status` = 'SHIPPED' AND NEW.`payment_status` = 'PAID')
		OR (OLD.`status` = 'SHIPPED' AND OLD.`payment_status` = 'PAID'
			AND NEW.`status` = 'DELIVERED' AND NEW.`payment_status` = 'PAID')
	) THEN RAISE(ABORT, 'INVALID_ORDER_TRANSITION') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_orders_commit_paid_inventory`
AFTER UPDATE OF `payment_status` ON `orders`
WHEN OLD.`payment_status` = 'PENDING' AND NEW.`payment_status` = 'PAID'
BEGIN
	SELECT CASE WHEN EXISTS (
		SELECT 1
		FROM `order_items` oi
		JOIN `product_variants` v ON v.`id` = oi.`product_variant_id`
		LEFT JOIN `inventory_levels` il
			ON il.`variant_id` = oi.`product_variant_id` AND il.`location_id` = 'location-main'
		WHERE oi.`order_id` = NEW.`id` AND v.`track_inventory` = 1
		GROUP BY oi.`product_variant_id`
		HAVING COALESCE(MAX(il.`reserved`), 0) < SUM(oi.`quantity`)
			OR COALESCE(MAX(il.`on_hand`), 0) < SUM(oi.`quantity`)
	) THEN RAISE(ABORT, 'INSUFFICIENT_RESERVED_STOCK') END;
	UPDATE `inventory_levels`
	SET `on_hand` = `on_hand` - COALESCE((
			SELECT SUM(oi.`quantity`) FROM `order_items` oi
			WHERE oi.`order_id` = NEW.`id` AND oi.`product_variant_id` = `inventory_levels`.`variant_id`
		), 0),
		`reserved` = `reserved` - COALESCE((
			SELECT SUM(oi.`quantity`) FROM `order_items` oi
			WHERE oi.`order_id` = NEW.`id` AND oi.`product_variant_id` = `inventory_levels`.`variant_id`
		), 0),
		`updated_at` = unixepoch()
	WHERE `location_id` = 'location-main'
	  AND `variant_id` IN (SELECT `product_variant_id` FROM `order_items` WHERE `order_id` = NEW.`id`);
	INSERT INTO `inventory_movements`
		(`id`, `variant_id`, `location_id`, `movement_type`, `quantity_delta`, `reason`, `reference_type`, `reference_id`)
	SELECT 'inventory_' || lower(hex(randomblob(16))), oi.`product_variant_id`, 'location-main',
		'RESERVATION_RELEASE', SUM(oi.`quantity`), 'Reservation committed to sale', 'ORDER', NEW.`id`
	FROM `order_items` oi
	WHERE oi.`order_id` = NEW.`id` AND oi.`product_variant_id` IS NOT NULL
	GROUP BY oi.`product_variant_id`;
	INSERT INTO `inventory_movements`
		(`id`, `variant_id`, `location_id`, `movement_type`, `quantity_delta`, `reason`, `reference_type`, `reference_id`)
	SELECT 'inventory_' || lower(hex(randomblob(16))), oi.`product_variant_id`, 'location-main',
		'SALE', -SUM(oi.`quantity`), 'Manual payment confirmed', 'ORDER', NEW.`id`
	FROM `order_items` oi
	WHERE oi.`order_id` = NEW.`id` AND oi.`product_variant_id` IS NOT NULL
	GROUP BY oi.`product_variant_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_orders_release_cancelled_inventory`
AFTER UPDATE OF `status` ON `orders`
WHEN OLD.`status` = 'PENDING_PAYMENT' AND NEW.`status` = 'CANCELLED' AND OLD.`payment_status` = 'PENDING'
BEGIN
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `order_items` oi
		JOIN `product_variants` v ON v.`id` = oi.`product_variant_id`
		LEFT JOIN `inventory_levels` il
			ON il.`variant_id` = oi.`product_variant_id` AND il.`location_id` = 'location-main'
		WHERE oi.`order_id` = NEW.`id` AND v.`track_inventory` = 1
		GROUP BY oi.`product_variant_id`
		HAVING COALESCE(MAX(il.`reserved`), 0) < SUM(oi.`quantity`)
	) THEN RAISE(ABORT, 'INSUFFICIENT_RESERVED_STOCK') END;
	UPDATE `inventory_levels`
	SET `reserved` = `reserved` - COALESCE((
		SELECT SUM(oi.`quantity`) FROM `order_items` oi
		WHERE oi.`order_id` = NEW.`id` AND oi.`product_variant_id` = `inventory_levels`.`variant_id`
	), 0), `updated_at` = unixepoch()
	WHERE `location_id` = 'location-main'
	  AND `variant_id` IN (SELECT `product_variant_id` FROM `order_items` WHERE `order_id` = NEW.`id`);
	INSERT INTO `inventory_movements`
		(`id`, `variant_id`, `location_id`, `movement_type`, `quantity_delta`, `reason`, `reference_type`, `reference_id`)
	SELECT 'inventory_' || lower(hex(randomblob(16))), oi.`product_variant_id`, 'location-main',
		'RESERVATION_RELEASE', SUM(oi.`quantity`), 'Pending order cancelled', 'ORDER', NEW.`id`
	FROM `order_items` oi
	WHERE oi.`order_id` = NEW.`id` AND oi.`product_variant_id` IS NOT NULL
	GROUP BY oi.`product_variant_id`;
	DELETE FROM `promotion_redemptions` WHERE `order_id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_promotion_redemptions_limits`
BEFORE INSERT ON `promotion_redemptions`
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `promotions`
		WHERE `id` = NEW.`promotion_id` AND `status` = 'ACTIVE'
		  AND (`starts_at` IS NULL OR `starts_at` <= unixepoch())
		  AND (`ends_at` IS NULL OR `ends_at` > unixepoch())
	) THEN RAISE(ABORT, 'PROMO_NOT_AVAILABLE') END;
	SELECT CASE WHEN (
		SELECT `usage_limit` IS NOT NULL AND
			(SELECT COUNT(*) FROM `promotion_redemptions` WHERE `promotion_id` = NEW.`promotion_id`) >= `usage_limit`
		FROM `promotions` WHERE `id` = NEW.`promotion_id`
	) THEN RAISE(ABORT, 'PROMO_LIMIT_REACHED') END;
	SELECT CASE WHEN NEW.`user_id` IS NOT NULL AND (
		SELECT `per_customer_limit` IS NOT NULL AND
			(SELECT COUNT(*) FROM `promotion_redemptions`
			 WHERE `promotion_id` = NEW.`promotion_id` AND `user_id` = NEW.`user_id`) >= `per_customer_limit`
		FROM `promotions` WHERE `id` = NEW.`promotion_id`
	) THEN RAISE(ABORT, 'PROMO_CUSTOMER_LIMIT_REACHED') END;
END;
