<?php

declare(strict_types=1);

namespace Rnco;

use DateTimeImmutable;
use DateTimeZone;
use PDOException;
use RuntimeException;

final class RateLimiter
{
    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
    ) {
    }

    public function consume(
        string $bucket,
        string $subject,
        int $limit,
        int $windowSeconds,
        string $errorCode = 'RATE_LIMITED',
        string $message = 'Too many requests. Please wait and try again.',
    ): void
    {
        $hash = Security::keyedHash($bucket . '|' . $subject, $this->config);
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $nowString = $now->format('Y-m-d H:i:s');
        $cutoff = $now->modify('-' . $windowSeconds . ' seconds')->format('Y-m-d H:i:s');

        $this->database->transaction(function () use ($hash, $limit, $windowSeconds, $now, $nowString, $cutoff, $errorCode, $message): void {
            if ($this->database->isMysql()) {
                $this->database->execute(
                    'INSERT INTO rate_limits (bucket_hash, hits, window_started_at, updated_at) VALUES (?, 1, ?, ?) ' .
                    'ON DUPLICATE KEY UPDATE hits = IF(window_started_at <= ?, 1, hits + 1), ' .
                    'window_started_at = IF(window_started_at <= ?, VALUES(window_started_at), window_started_at), updated_at = VALUES(updated_at)',
                    [$hash, $nowString, $nowString, $cutoff, $cutoff],
                );
            } else {
                $this->database->execute(
                    'INSERT INTO rate_limits (bucket_hash, hits, window_started_at, updated_at) VALUES (?, 1, ?, ?) ' .
                    'ON CONFLICT(bucket_hash) DO UPDATE SET hits = CASE WHEN rate_limits.window_started_at <= ? THEN 1 ELSE rate_limits.hits + 1 END, ' .
                    'window_started_at = CASE WHEN rate_limits.window_started_at <= ? THEN excluded.window_started_at ELSE rate_limits.window_started_at END, updated_at = excluded.updated_at',
                    [$hash, $nowString, $nowString, $cutoff, $cutoff],
                );
            }
            $row = $this->database->fetchOne('SELECT hits, window_started_at FROM rate_limits WHERE bucket_hash = ?', [$hash]);
            if ($row === null) {
                throw new RuntimeException('Rate-limit state was not persisted.');
            }
            if ((int) $row['hits'] > $limit) {
                $started = new DateTimeImmutable((string) $row['window_started_at'], new DateTimeZone('UTC'));
                $elapsed = max(0, $now->getTimestamp() - $started->getTimestamp());
                throw new ApiException(
                    $errorCode,
                    $message,
                    429,
                    ['retryAfter' => max(1, $windowSeconds - $elapsed)],
                );
            }
        });
    }

    public function clear(string $bucket, string $subject): void
    {
        $hash = Security::keyedHash($bucket . '|' . $subject, $this->config);
        $this->database->execute('DELETE FROM rate_limits WHERE bucket_hash = ?', [$hash]);
    }
}

final class MaintenanceService
{
    public function __construct(private readonly Database $database)
    {
    }

    /** @return array{sessions:int,rateLimits:int} */
    public function cleanup(int $revokedRetentionDays = 7, int $rateLimitRetentionDays = 2): array
    {
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $sessionCutoff = $now->modify('-' . max(1, $revokedRetentionDays) . ' days')->format('Y-m-d H:i:s');
        $rateCutoff = $now->modify('-' . max(1, $rateLimitRetentionDays) . ' days')->format('Y-m-d H:i:s');
        $deletedSessions = $this->database->execute(
            'DELETE FROM auth_sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)',
            [$now->format('Y-m-d H:i:s'), $sessionCutoff],
        );
        $deletedRateLimits = $this->database->execute('DELETE FROM rate_limits WHERE updated_at <= ?', [$rateCutoff]);

        return ['sessions' => $deletedSessions, 'rateLimits' => $deletedRateLimits];
    }
}

final class AuditLogger
{
    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
    ) {
    }

    /** @param array<string, mixed>|null $before @param array<string, mixed>|null $after */
    public function log(?AuthContext $context, Request $request, string $action, string $entityType, ?string $entityId, ?array $before = null, ?array $after = null): void
    {
        $this->database->execute(
            'INSERT INTO audit_logs (actor_user_id, action_name, entity_type, entity_id, before_json, after_json, ip_hash, user_agent_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $context?->userId(), $action, $entityType, $entityId,
                $before === null ? null : Security::jsonEncode($before),
                $after === null ? null : Security::jsonEncode($after),
                Security::keyedHash($request->remoteAddress, $this->config),
                Security::keyedHash($request->userAgent, $this->config),
                Security::now(),
            ],
        );
    }
}

final class StoreRepository
{
    public function __construct(private readonly Database $database)
    {
    }

    /** @return array<string, mixed> */
    public function storefront(): array
    {
        return [
            'settings' => $this->settings(true),
            'products' => array_map([$this, 'product'], $this->database->fetchAll("SELECT * FROM products WHERE status = 'active' ORDER BY sort_order, name")),
            'slides' => array_map([$this, 'slide'], $this->database->fetchAll('SELECT * FROM slides WHERE is_active = 1 ORDER BY sort_order, id')),
            'gallery' => array_map([$this, 'galleryItem'], $this->database->fetchAll('SELECT * FROM gallery_items WHERE is_active = 1 ORDER BY sort_order, id')),
            'bundles' => $this->bundles(true),
            'paymentMethods' => $this->paymentMethods(true),
        ];
    }

    /** @return list<array<string, mixed>> */
    public function paymentMethods(bool $activeOnly = false): array
    {
        $rows = $this->database->fetchAll('SELECT * FROM payment_methods' . ($activeOnly ? ' WHERE is_active = 1' : '') . ' ORDER BY sort_order, id');

        return array_map(static fn (array $row): array => [
            'id' => (string) $row['id'], 'type' => (string) $row['method_type'], 'name' => (string) $row['display_name'],
            'active' => (bool) $row['is_active'], 'instructions' => (string) ($row['instructions'] ?? ''),
            'qrImage' => $row['qr_image_url'] ?? null, 'bankName' => $row['bank_name'] ?? null,
            'accountName' => $row['account_name'] ?? null, 'accountNumber' => $row['account_number'] ?? null,
            'sortOrder' => (int) $row['sort_order'],
        ], $rows);
    }

    /** @return array<string, mixed> */
    public function settings(bool $publicOnly = false): array
    {
        $rows = $this->database->fetchAll('SELECT setting_key, value_json FROM settings' . ($publicOnly ? ' WHERE is_public = 1' : '') . ' ORDER BY setting_key');
        $settings = [];
        foreach ($rows as $row) {
            $settings[(string) $row['setting_key']] = Security::jsonDecode((string) $row['value_json']);
        }

        return $settings;
    }

    /** @return list<array<string, mixed>> */
    public function products(bool $activeOnly = false): array
    {
        $sql = 'SELECT * FROM products' . ($activeOnly ? " WHERE status = 'active'" : '') . ' ORDER BY sort_order, name';
        return array_map([$this, 'product'], $this->database->fetchAll($sql));
    }

    /** @return array<string, mixed>|null */
    public function findProduct(string $id): ?array
    {
        $row = $this->database->fetchOne('SELECT * FROM products WHERE id = ?', [$id]);

        return $row === null ? null : $this->product($row);
    }

    /** @return list<array<string, mixed>> */
    public function slides(bool $activeOnly = false): array
    {
        return array_map([$this, 'slide'], $this->database->fetchAll('SELECT * FROM slides' . ($activeOnly ? ' WHERE is_active = 1' : '') . ' ORDER BY sort_order, id'));
    }

    /** @return list<array<string, mixed>> */
    public function gallery(bool $activeOnly = false): array
    {
        return array_map([$this, 'galleryItem'], $this->database->fetchAll('SELECT * FROM gallery_items' . ($activeOnly ? ' WHERE is_active = 1' : '') . ' ORDER BY sort_order, id'));
    }

    /** @return list<array<string, mixed>> */
    public function bundles(bool $activeOnly = false): array
    {
        $rows = $this->database->fetchAll('SELECT * FROM bundles' . ($activeOnly ? ' WHERE is_active = 1' : '') . ' ORDER BY sort_order, id');

        return array_map(fn (array $row): array => $this->bundle($row), $rows);
    }

    /** @return array<string, mixed>|null */
    public function findBundle(string $id): ?array
    {
        $row = $this->database->fetchOne('SELECT * FROM bundles WHERE id = ?', [$id]);

        return $row === null ? null : $this->bundle($row);
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public function product(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'sku' => $row['sku'] ?? null,
            'name' => (string) $row['name'],
            'shortName' => (string) $row['short_name'],
            'price' => ((int) $row['price_cents']) / 100,
            'badge' => (string) ($row['badge'] ?? ''),
            'description' => (string) $row['description'],
            'detail' => (string) ($row['detail'] ?? ''),
            'ingredients' => (string) ($row['ingredients'] ?? ''),
            'ritual' => (string) ($row['ritual'] ?? ''),
            'volume' => (string) ($row['volume'] ?? ''),
            'image' => (string) $row['image_url'],
            'editorial' => (string) ($row['editorial_url'] ?? ''),
            'editorialPosition' => $row['editorial_position'] ?? null,
            'texture' => (string) ($row['texture'] ?? ''),
            'benefits' => Security::jsonDecode((string) $row['benefits_json'], []),
            'storyImages' => Security::jsonDecode((string) $row['story_images_json'], []),
            'stock' => (int) $row['stock_quantity'],
            'active' => $row['status'] === 'active',
            'sortOrder' => (int) $row['sort_order'],
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public function slide(array $row): array
    {
        return [
            'id' => (string) $row['id'], 'image' => (string) $row['image_url'], 'eyebrow' => (string) ($row['eyebrow'] ?? ''),
            'title' => (string) $row['title'], 'emphasis' => (string) ($row['emphasis'] ?? ''), 'copy' => (string) ($row['copy_text'] ?? ''),
            'caption' => (string) ($row['caption'] ?? ''), 'tone' => (string) $row['tone'], 'position' => (string) $row['position_value'],
            'active' => (bool) $row['is_active'], 'sortOrder' => (int) $row['sort_order'],
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public function galleryItem(array $row): array
    {
        return [
            'id' => (string) $row['id'], 'image' => (string) $row['image_url'], 'alt' => (string) $row['alt_text'],
            'caption' => (string) ($row['caption'] ?? ''), 'href' => (string) ($row['href'] ?? ''),
            'active' => (bool) $row['is_active'], 'sortOrder' => (int) $row['sort_order'],
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function bundle(array $row): array
    {
        $steps = $this->database->fetchAll('SELECT * FROM bundle_steps WHERE bundle_id = ? ORDER BY sort_order, id', [$row['id']]);
        $mappedSteps = [];
        foreach ($steps as $step) {
            $options = $this->database->fetchAll('SELECT product_id FROM bundle_step_products WHERE step_id = ? ORDER BY sort_order, product_id', [$step['id']]);
            $mappedSteps[] = [
                'id' => (string) $step['id'],
                'label' => (string) $step['name'],
                'description' => (string) ($step['prompt_text'] ?? ''),
                'productIds' => array_map(static fn (array $option): string => (string) $option['product_id'], $options),
                'minSelections' => (int) $step['min_select'],
                'maxSelections' => (int) $step['max_select'],
                'sortOrder' => (int) $step['sort_order'],
            ];
        }

        return [
            'id' => (string) $row['id'],
            'name' => (string) $row['name'],
            'title' => (string) ($row['title'] ?? ''),
            'description' => (string) ($row['description'] ?? ''),
            'active' => (bool) $row['is_active'],
            'discountType' => match ((string) ($row['pricing_mode'] ?? 'sum')) {
                'fixed_discount' => 'fixed',
                'percentage_discount' => 'percentage',
                default => 'none',
            },
            'discountValue' => $row['fixed_price_cents'] === null ? 0 : ((int) $row['fixed_price_cents']) / 100,
            'steps' => $mappedSteps,
        ];
    }
}

final class ReferralService
{
    public function __construct(private readonly Database $database)
    {
    }

    public function normalizeCode(mixed $value): ?string
    {
        if ($value === null || $value === '') return null;
        $code = strtolower(trim((string) $value));
        if (!preg_match('/^[a-z0-9_-]{2,50}$/', $code)) {
            throw new ApiException('REFERRAL_INVALID', 'That referral link is not valid.', 422);
        }
        return $code;
    }

    /** @return array<string,mixed> */
    public function resolve(string $code): array
    {
        $nameExpression = $this->database->isMysql()
            ? "COALESCE(NULLIF(u.display_name, ''), NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email)"
            : "COALESCE(NULLIF(u.display_name, ''), NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email)";
        $row = $this->database->fetchOne(
            "SELECT rl.*, {$nameExpression} AS referrer_name, u.email AS referrer_email " .
            'FROM referral_links rl JOIN users u ON u.id = rl.referrer_user_id WHERE rl.code = ?',
            [$this->normalizeCode($code)],
        );
        $now = Security::now();
        if ($row === null || !(bool) $row['is_active'] || ($row['starts_at'] !== null && $row['starts_at'] > $now) || ($row['ends_at'] !== null && $row['ends_at'] < $now)) {
            throw new ApiException('REFERRAL_NOT_AVAILABLE', 'That referral link is not currently available.', 404);
        }
        return $row;
    }

    /** @return array<string,mixed> */
    public function preview(string $code, Request $request, ?int $userId): array
    {
        $link = $this->resolve($code);
        $this->database->execute(
            'INSERT INTO referral_visits (public_id, referral_link_id, visitor_hash, converted_user_id, occurred_at) VALUES (?, ?, ?, ?, ?)',
            [Security::uuid(), $link['id'], hash('sha256', $request->remoteAddress . '|' . ($request->header('user-agent') ?? '')), $userId, Security::now()],
        );
        $discount = ((int) $link['discount_basis_points']) / 100;
        $eligible = $discount > 0 && $link['discount_scope'] !== 'none';
        if ($userId !== null) {
            if ((int) $link['referrer_user_id'] === $userId) $eligible = false;
            elseif ($eligible && $link['discount_scope'] === 'first_purchase') {
                $prior = $this->database->fetchOne("SELECT COUNT(*) AS aggregate FROM orders WHERE customer_id = ? AND status <> 'cancelled' AND deleted_at IS NULL", [$userId]);
                $eligible = (int) ($prior['aggregate'] ?? 0) === 0;
            }
        }
        return [
            'code' => (string) $link['code'], 'name' => (string) $link['name'], 'referrerName' => (string) $link['referrer_name'],
            'discountPercent' => $discount, 'discountScope' => (string) $link['discount_scope'],
            'attributionDays' => (int) $link['attribution_days'],
            'eligible' => $eligible,
            'message' => $discount > 0
                ? $discount . '% referral saving ' . ($link['discount_scope'] === 'first_purchase' ? 'on your first purchase.' : 'on every purchase.')
                : 'You are shopping through ' . $link['referrer_name'] . "'s referral link.",
        ];
    }

    /** @return array{link:?array<string,mixed>,discount_cents:int} */
    public function forOrder(int $userId, mixed $codeValue, int $subtotal, int $bundleDiscount): array
    {
        $link = $this->database->fetchOne(
            'SELECT rl.* FROM customer_referrals cr JOIN referral_links rl ON rl.id = cr.referral_link_id WHERE cr.user_id = ?',
            [$userId],
        );
        $code = $this->normalizeCode($codeValue);
        if ($link === null && $code !== null) {
            $link = $this->resolve($code);
            if ((int) $link['referrer_user_id'] === $userId) {
                throw new ApiException('SELF_REFERRAL_NOT_ALLOWED', 'You cannot use your own referral link.', 422);
            }
            $this->database->execute(
                'INSERT INTO customer_referrals (user_id, referral_link_id, referrer_user_id, attribution_source, attributed_at) VALUES (?, ?, ?, ?, ?)',
                [$userId, $link['id'], $link['referrer_user_id'], 'order', Security::now()],
            );
        }
        if ($link === null) return ['link' => null, 'discount_cents' => 0];
        $now = Security::now();
        $eligible = (bool) $link['is_active'] && ($link['starts_at'] === null || $link['starts_at'] <= $now)
            && ($link['ends_at'] === null || $link['ends_at'] >= $now) && $link['discount_scope'] !== 'none'
            && (int) $link['discount_basis_points'] > 0;
        if ($eligible && $link['discount_scope'] === 'first_purchase') {
            $prior = $this->database->fetchOne(
                "SELECT COUNT(*) AS aggregate FROM orders WHERE customer_id = ? AND status <> 'cancelled' AND deleted_at IS NULL",
                [$userId],
            );
            $eligible = (int) ($prior['aggregate'] ?? 0) === 0;
        }
        $eligibleSubtotal = max(0, $subtotal - $bundleDiscount);
        $discount = $eligible ? min($eligibleSubtotal, (int) round($eligibleSubtotal * ((int) $link['discount_basis_points']) / 10000, 0, PHP_ROUND_HALF_UP)) : 0;
        return ['link' => $link, 'discount_cents' => $discount];
    }

    /** @param array<string,mixed> $link */
    public function createCommission(array $link, int $orderId, int $userId, int $basis): void
    {
        $rate = (int) $link['commission_basis_points'];
        if ($rate <= 0) return;
        $now = Security::now();
        $amount = (int) round(max(0, $basis) * $rate / 10000, 0, PHP_ROUND_HALF_UP);
        $this->database->execute(
            'INSERT INTO referral_commissions (public_id, referral_link_id, order_id, referrer_user_id, referred_user_id, basis_cents, rate_basis_points, amount_cents, status, approved_at, paid_at, voided_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [Security::uuid(), $link['id'], $orderId, $link['referrer_user_id'], $userId, max(0, $basis), $rate, $amount, 'pending', null, null, null, null, $now, $now],
        );
    }

    public function transitionOrder(int $orderId, string $status): void
    {
        $now = Security::now();
        if (in_array($status, ['payment_confirmed', 'processing', 'packing', 'shipped', 'delivered'], true)) {
            $this->database->execute("UPDATE referral_commissions SET status = 'approved', approved_at = COALESCE(approved_at, ?), updated_at = ? WHERE order_id = ? AND status = 'pending'", [$now, $now, $orderId]);
        } elseif ($status === 'cancelled') {
            $this->database->execute("UPDATE referral_commissions SET status = 'void', voided_at = ?, note = COALESCE(note, 'Order cancelled'), updated_at = ? WHERE order_id = ? AND status IN ('pending','approved')", [$now, $now, $orderId]);
        }
    }

    /** @return list<array<string,mixed>> */
    public function links(): array
    {
        $nameExpression = $this->database->isMysql()
            ? "COALESCE(NULLIF(u.display_name, ''), NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email)"
            : "COALESCE(NULLIF(u.display_name, ''), TRIM(u.first_name || ' ' || u.last_name), u.email)";
        $rows = $this->database->fetchAll(
            "SELECT rl.*, u.public_id AS referrer_public_id, {$nameExpression} AS referrer_name, u.email AS referrer_email, " .
            '(SELECT COUNT(*) FROM referral_visits rv WHERE rv.referral_link_id = rl.id) AS visits, ' .
            '(SELECT COUNT(*) FROM customer_referrals cr WHERE cr.referral_link_id = rl.id) AS downlines, ' .
            "(SELECT COUNT(*) FROM orders o WHERE o.referral_link_id = rl.id AND o.payment_status = 'confirmed' AND o.deleted_at IS NULL) AS paid_orders, " .
            "(SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o WHERE o.referral_link_id = rl.id AND o.payment_status = 'confirmed' AND o.deleted_at IS NULL) AS paid_revenue_cents, " .
            "(SELECT COALESCE(SUM(rc.amount_cents), 0) FROM referral_commissions rc WHERE rc.referral_link_id = rl.id AND rc.status = 'pending') AS pending_cents, " .
            "(SELECT COALESCE(SUM(rc.amount_cents), 0) FROM referral_commissions rc WHERE rc.referral_link_id = rl.id AND rc.status = 'approved') AS approved_cents, " .
            "(SELECT COALESCE(SUM(rc.amount_cents), 0) FROM referral_commissions rc WHERE rc.referral_link_id = rl.id AND rc.status = 'paid') AS paid_cents " .
            'FROM referral_links rl JOIN users u ON u.id = rl.referrer_user_id ORDER BY rl.created_at DESC, rl.id DESC',
        );
        return array_map(fn (array $row): array => $this->mapLink($row), $rows);
    }

    /** @return array<string,mixed> */
    public function customerDashboard(int $userId): array
    {
        $user = $this->database->fetchOne('SELECT public_id FROM users WHERE id = ?', [$userId]);
        if ($user === null) throw new ApiException('ACCOUNT_NOT_FOUND', 'The account was not found.', 404);
        $links = array_values(array_filter(
            $this->links(),
            static fn (array $link): bool => $link['referrerUserId'] === (string) $user['public_id'],
        ));
        $rows = $this->database->fetchAll(
            'SELECT rc.*, rl.code, o.public_id AS order_public_id, o.order_number FROM referral_commissions rc ' .
            'JOIN referral_links rl ON rl.id = rc.referral_link_id JOIN orders o ON o.id = rc.order_id ' .
            'WHERE rc.referrer_user_id = ? ORDER BY rc.created_at DESC, rc.id DESC',
            [$userId],
        );
        $commissions = array_map(static fn (array $row): array => [
            'id' => (string) $row['public_id'], 'code' => (string) $row['code'],
            'orderId' => (string) $row['order_public_id'], 'orderNumber' => (string) $row['order_number'],
            'basis' => ((int) $row['basis_cents']) / 100, 'ratePercent' => ((int) $row['rate_basis_points']) / 100,
            'amount' => ((int) $row['amount_cents']) / 100, 'status' => (string) $row['status'],
            'note' => $row['note'], 'createdAt' => $row['created_at'],
            'approvedAt' => $row['approved_at'], 'paidAt' => $row['paid_at'],
        ], $rows);
        $sum = static fn (string $status): float => array_reduce(
            $commissions,
            static fn (float $total, array $item): float => $total + ($item['status'] === $status ? (float) $item['amount'] : 0.0),
            0.0,
        );
        $pending = $sum('pending');
        $approved = $sum('approved');
        $paid = $sum('paid');
        return ['links' => $links, 'commissions' => $commissions, 'totals' => [
            'pending' => $pending, 'approved' => $approved, 'paid' => $paid, 'earned' => $approved + $paid,
        ]];
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    public function save(?string $publicId, array $input): array
    {
        Validator::requireValid($input, [
            'code' => 'required|string|min:2|max:50', 'name' => 'required|string|min:2|max:160', 'referrerUserId' => 'required|string|max:64',
            'discountPercent' => 'required|numeric', 'discountScope' => 'required|string|in:none,first_purchase,every_purchase',
            'commissionPercent' => 'required|numeric', 'attributionDays' => 'required|numeric', 'startsAt' => 'sometimes|nullable|string|max:40',
            'endsAt' => 'sometimes|nullable|string|max:40', 'active' => 'sometimes|bool',
        ]);
        $code = $this->normalizeCode($input['code']);
        $discountBps = (int) round((float) $input['discountPercent'] * 100);
        $commissionBps = (int) round((float) $input['commissionPercent'] * 100);
        if ($discountBps < 0 || $discountBps > 10000 || $commissionBps < 0 || $commissionBps > 10000) {
            throw new ApiException('VALIDATION_FAILED', 'Discount and commission must be between 0 and 100%.', 422);
        }
        $referrer = $this->database->fetchOne("SELECT id FROM users WHERE public_id = ? AND role = 'customer' AND status = 'active'", [(string) $input['referrerUserId']]);
        if ($referrer === null) throw new ApiException('REFERRER_NOT_FOUND', 'Choose an active customer as the referral owner.', 422);
        $days = (int) $input['attributionDays'];
        if ($days < 1 || $days > 365) throw new ApiException('VALIDATION_FAILED', 'Attribution days must be between 1 and 365.', 422);
        $starts = $this->date($input['startsAt'] ?? null, 'startsAt');
        $ends = $this->date($input['endsAt'] ?? null, 'endsAt');
        if ($starts !== null && $ends !== null && $ends <= $starts) throw new ApiException('VALIDATION_FAILED', 'The end date must be after the start date.', 422);
        $now = Security::now();
        try {
            if ($publicId === null) {
                $publicId = Security::uuid();
                $this->database->execute(
                    'INSERT INTO referral_links (public_id, code, name, referrer_user_id, discount_basis_points, discount_scope, commission_basis_points, attribution_days, starts_at, ends_at, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$publicId, $code, trim((string) $input['name']), $referrer['id'], $discountBps, $input['discountScope'], $commissionBps, $days, $starts, $ends, !array_key_exists('active', $input) || !empty($input['active']) ? 1 : 0, $now, $now],
                );
            } else {
                $updated = $this->database->execute(
                    'UPDATE referral_links SET code = ?, name = ?, referrer_user_id = ?, discount_basis_points = ?, discount_scope = ?, commission_basis_points = ?, attribution_days = ?, starts_at = ?, ends_at = ?, is_active = ?, updated_at = ? WHERE public_id = ?',
                    [$code, trim((string) $input['name']), $referrer['id'], $discountBps, $input['discountScope'], $commissionBps, $days, $starts, $ends, !array_key_exists('active', $input) || !empty($input['active']) ? 1 : 0, $now, $publicId],
                );
                if ($updated === 0) throw new ApiException('REFERRAL_NOT_FOUND', 'The referral link was not found.', 404);
            }
        } catch (PDOException $exception) {
            throw new ApiException('REFERRAL_CODE_EXISTS', 'That referral code is already in use.', 409, ['code' => 'Choose a unique code.'], $exception);
        }
        foreach ($this->links() as $link) if ($link['id'] === $publicId) return $link;
        throw new ApiException('REFERRAL_NOT_FOUND', 'The referral link was not found.', 404);
    }

    public function disable(string $publicId): void
    {
        if ($this->database->execute('UPDATE referral_links SET is_active = 0, updated_at = ? WHERE public_id = ?', [Security::now(), $publicId]) === 0) {
            throw new ApiException('REFERRAL_NOT_FOUND', 'The referral link was not found.', 404);
        }
    }

    /** @return list<array<string,mixed>> */
    public function commissions(): array
    {
        $referrerName = $this->database->isMysql()
            ? "COALESCE(NULLIF(ru.display_name, ''), NULLIF(TRIM(CONCAT(ru.first_name, ' ', ru.last_name)), ''), ru.email)"
            : "COALESCE(NULLIF(ru.display_name, ''), TRIM(ru.first_name || ' ' || ru.last_name), ru.email)";
        $customerName = $this->database->isMysql()
            ? "COALESCE(NULLIF(cu.display_name, ''), NULLIF(TRIM(CONCAT(cu.first_name, ' ', cu.last_name)), ''), cu.email)"
            : "COALESCE(NULLIF(cu.display_name, ''), TRIM(cu.first_name || ' ' || cu.last_name), cu.email)";
        $rows = $this->database->fetchAll("SELECT rc.*, rl.code, o.public_id AS order_public_id, o.order_number, {$referrerName} AS referrer_name, {$customerName} AS customer_name FROM referral_commissions rc JOIN referral_links rl ON rl.id = rc.referral_link_id JOIN orders o ON o.id = rc.order_id JOIN users ru ON ru.id = rc.referrer_user_id JOIN users cu ON cu.id = rc.referred_user_id ORDER BY rc.created_at DESC, rc.id DESC");
        return array_map(static fn (array $row): array => [
            'id' => (string) $row['public_id'], 'code' => (string) $row['code'], 'orderId' => (string) $row['order_public_id'], 'orderNumber' => (string) $row['order_number'],
            'referrerName' => (string) $row['referrer_name'], 'customerName' => (string) $row['customer_name'], 'basis' => ((int) $row['basis_cents']) / 100,
            'ratePercent' => ((int) $row['rate_basis_points']) / 100, 'amount' => ((int) $row['amount_cents']) / 100, 'status' => (string) $row['status'],
            'note' => $row['note'], 'createdAt' => $row['created_at'], 'approvedAt' => $row['approved_at'], 'paidAt' => $row['paid_at'],
        ], $rows);
    }

    /** @return array<string,mixed> */
    public function updateCommission(string $publicId, string $status, ?string $note): array
    {
        if (!in_array($status, ['paid', 'void'], true)) throw new ApiException('VALIDATION_FAILED', 'Choose paid or void.', 422);
        $now = Security::now();
        $condition = $status === 'paid' ? "status = 'approved'" : "status IN ('pending','approved')";
        $updated = $this->database->execute(
            "UPDATE referral_commissions SET status = ?, note = ?, paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END, voided_at = CASE WHEN ? = 'void' THEN ? ELSE voided_at END, updated_at = ? WHERE public_id = ? AND {$condition}",
            [$status, $note, $status, $now, $status, $now, $now, $publicId],
        );
        if ($updated === 0) throw new ApiException('COMMISSION_STATUS_INVALID', 'That commission cannot move to the selected status.', 409);
        foreach ($this->commissions() as $commission) if ($commission['id'] === $publicId) return $commission;
        throw new ApiException('COMMISSION_NOT_FOUND', 'The commission was not found.', 404);
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function mapLink(array $row): array
    {
        return [
            'id' => (string) $row['public_id'], 'code' => (string) $row['code'], 'name' => (string) $row['name'],
            'referrerUserId' => (string) $row['referrer_public_id'], 'referrerName' => (string) $row['referrer_name'], 'referrerEmail' => (string) $row['referrer_email'],
            'discountPercent' => ((int) $row['discount_basis_points']) / 100, 'discountScope' => (string) $row['discount_scope'],
            'commissionPercent' => ((int) $row['commission_basis_points']) / 100, 'attributionDays' => (int) $row['attribution_days'],
            'active' => (bool) $row['is_active'], 'startsAt' => $row['starts_at'], 'endsAt' => $row['ends_at'],
            'visits' => (int) ($row['visits'] ?? 0), 'downlines' => (int) ($row['downlines'] ?? 0), 'paidOrders' => (int) ($row['paid_orders'] ?? 0),
            'paidRevenue' => ((int) ($row['paid_revenue_cents'] ?? 0)) / 100, 'pendingCommission' => ((int) ($row['pending_cents'] ?? 0)) / 100,
            'approvedCommission' => ((int) ($row['approved_cents'] ?? 0)) / 100, 'paidCommission' => ((int) ($row['paid_cents'] ?? 0)) / 100,
        ];
    }

    private function date(mixed $value, string $field): ?string
    {
        if ($value === null || $value === '') return null;
        $timestamp = strtotime((string) $value);
        if ($timestamp === false) throw new ApiException('VALIDATION_FAILED', 'Enter a valid date.', 422, [$field => 'Enter a valid date and time.']);
        return gmdate('Y-m-d H:i:s', $timestamp);
    }
}

final class OrderService
{
    public function __construct(
        private readonly Database $database,
        private readonly StoreRepository $store,
        private readonly ?Config $config = null,
        private readonly ?ReferralService $referrals = null,
    ) {
    }

    /** @param list<array<string, mixed>> $items @return array<string, mixed> */
    public function validatePromo(string $code, array $items, ?int $userId = null): array
    {
        try {
            [, $subtotal] = $this->pricedItems($items, false);
            $shipping = $this->shippingFor($subtotal);
            $result = $this->promoFor($code, $subtotal, $shipping, $userId, false);
            return [
                'valid' => true,
                'code' => $result['code'],
                'discount' => $result['discount_cents'] / 100,
                'shipping' => $result['shipping_cents'] / 100,
                'message' => 'Offer applied to this ritual.',
            ];
        } catch (ApiException $exception) {
            if (in_array($exception->errorCode, ['PROMO_NOT_FOUND', 'PROMO_INACTIVE', 'PROMO_NOT_STARTED', 'PROMO_ENDED', 'PROMO_MINIMUM_NOT_MET', 'PROMO_LIMIT_REACHED'], true)) {
                return ['valid' => false, 'message' => $exception->getMessage()];
            }
            throw $exception;
        }
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public function create(AuthContext $context, array $input, string $idempotencyKey): array
    {
        if ($context->userId() === null) {
            throw new ApiException('AUTHENTICATION_REQUIRED', 'Sign in to place an order.', 401);
        }
        if (strlen($idempotencyKey) < 8 || strlen($idempotencyKey) > 128 || preg_match('/[^A-Za-z0-9._:-]/', $idempotencyKey)) {
            throw new ApiException('IDEMPOTENCY_KEY_INVALID', 'Provide a valid Idempotency-Key header.', 400);
        }
        $idempotencyHash = hash('sha256', $idempotencyKey);
        $requestHash = Security::canonicalJsonHash($input);
        $existing = $this->database->fetchOne('SELECT id, request_hash FROM orders WHERE customer_id = ? AND idempotency_hash = ?', [$context->userId(), $idempotencyHash]);
        if ($existing !== null) {
            $this->assertIdempotencyMatch($existing, $requestHash);
            return $this->getOrder((int) $existing['id'], (int) $context->userId());
        }

        Validator::requireValid($input, [
            'items' => 'required|array',
            'shippingAddress' => 'required|array',
            'paymentMethod' => 'required|string|in:manual_confirmation',
            'promoCode' => 'sometimes|nullable|string|max:64',
            'referralCode' => 'sometimes|nullable|string|max:64',
            'bundleMetadata' => 'sometimes|nullable|array',
        ]);
        /** @var list<array<string,mixed>> $items */
        $items = array_values($input['items']);
        if ($items === [] || count($items) > 30) {
            throw new ApiException('VALIDATION_FAILED', 'Choose at least one product.', 422, ['items' => 'Choose between 1 and 30 order lines.']);
        }
        /** @var array<string,mixed> $address */
        $address = $input['shippingAddress'];
        $this->validateAddress($address);
        $bundleMetadata = $input['bundleMetadata'] ?? null;
        if ($bundleMetadata !== null && strlen(Security::jsonEncode($bundleMetadata)) > 16384) {
            throw new ApiException('VALIDATION_FAILED', 'Bundle metadata is too large.', 422, ['bundleMetadata' => 'Reduce the bundle data.']);
        }

        try {
            return $this->database->transaction(function () use ($context, $input, $items, $address, $bundleMetadata, $idempotencyHash, $requestHash): array {
                if ($this->database->isMysql()) {
                    $this->database->fetchOne('SELECT id FROM users WHERE id = ? FOR UPDATE', [$context->userId()]);
                }
                $existingSql = 'SELECT id, request_hash FROM orders WHERE customer_id = ? AND idempotency_hash = ?';
                if ($this->database->isMysql()) {
                    $existingSql .= ' FOR UPDATE';
                }
                $existing = $this->database->fetchOne($existingSql, [$context->userId(), $idempotencyHash]);
                if ($existing !== null) {
                    $this->assertIdempotencyMatch($existing, $requestHash);
                    return $this->getOrder((int) $existing['id'], (int) $context->userId());
                }
                [$lines, $subtotal] = $this->pricedItems($items, true);
                $normalizedBundle = $this->validateBundleMetadata($bundleMetadata, $lines);
                $bundleDiscount = $this->bundleDiscount($normalizedBundle, $lines);
                $shipping = $this->shippingFor($subtotal);
                $promo = null;
                $promoDiscount = 0;
                if (!empty($input['promoCode'])) {
                    $promo = $this->promoFor((string) $input['promoCode'], $subtotal, $shipping, (int) $context->userId(), true);
                    $promoDiscount = (int) $promo['discount_cents'];
                    $shipping = (int) $promo['shipping_cents'];
                }
                $referral = $this->referrals?->forOrder((int) $context->userId(), $input['referralCode'] ?? null, $subtotal, $bundleDiscount)
                    ?? ['link' => null, 'discount_cents' => 0];
                $referralDiscount = (int) $referral['discount_cents'];
                $discount = min($subtotal, $bundleDiscount + $promoDiscount + $referralDiscount);
                $total = max(0, $subtotal - $discount + $shipping);
                $user = $this->database->fetchOne('SELECT email, first_name, last_name, phone FROM users WHERE id = ?', [$context->userId()]);
                if ($user === null) {
                    throw new ApiException('ACCOUNT_NOT_FOUND', 'The customer account no longer exists.', 409);
                }
                $publicId = Security::uuid();
                $orderNumber = '3R-' . gmdate('Ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
                $now = Security::now();
                $contact = [
                    'name' => trim((string) $user['first_name'] . ' ' . (string) $user['last_name']),
                    'email' => (string) $user['email'],
                    'phone' => $address['phone'] ?? $user['phone'],
                ];
                $this->database->execute(
                    'INSERT INTO orders (public_id, order_number, customer_id, status, payment_status, payment_method, currency, subtotal_cents, discount_cents, shipping_cents, total_cents, promo_id, promo_code, referral_link_id, referrer_user_id, referral_code, referral_discount_cents, contact_json, shipping_address_json, bundle_metadata_json, idempotency_hash, request_hash, inventory_reserved_until, tracking_number, internal_note, inventory_restored_at, deleted_at, created_at, updated_at) ' .
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        $publicId, $orderNumber, $context->userId(), 'pending_payment', 'pending', 'manual_confirmation', 'MYR',
                        $subtotal, $discount, $shipping, $total, $promo['id'] ?? null, $promo['code'] ?? null,
                        $referral['link']['id'] ?? null, $referral['link']['referrer_user_id'] ?? null, $referral['link']['code'] ?? null, $referralDiscount,
                        Security::jsonEncode($contact), Security::jsonEncode($address),
                        $normalizedBundle === null ? null : Security::jsonEncode($normalizedBundle), $idempotencyHash, $requestHash,
                        Security::afterSeconds($this->config?->int('order.reservation_seconds') ?: 86400),
                        null, null, null, null, $now, $now,
                    ],
                );
                $orderId = $this->database->lastInsertId();
                if ($referral['link'] !== null) {
                    $this->referrals?->createCommission($referral['link'], $orderId, (int) $context->userId(), max(0, $subtotal - $discount));
                }
                foreach ($lines as $line) {
                    $affected = $this->database->execute(
                        'UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ? AND stock_quantity >= ?',
                        [$line['quantity'], $now, $line['id'], $line['quantity']],
                    );
                    if ($affected !== 1) {
                        throw new ApiException('OUT_OF_STOCK', $line['name'] . ' no longer has enough stock.', 409, ['productId' => $line['id']]);
                    }
                    $bundleInfo = $this->bundleInfoForProduct($normalizedBundle, (string) $line['id']);
                    $this->database->execute(
                        'INSERT INTO order_items (order_id, product_id, product_name, sku, unit_price_cents, quantity, line_total_cents, bundle_id, bundle_step_id, bundle_group_id, bundle_metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            $orderId, $line['id'], $line['name'], $line['sku'], $line['price_cents'], $line['quantity'], $line['line_total_cents'],
                            $bundleInfo['bundleId'] ?? null, $bundleInfo['stepId'] ?? null, $bundleInfo['groupId'] ?? null,
                            $bundleInfo === null ? null : Security::jsonEncode($bundleInfo), $now,
                        ],
                    );
                    $this->database->execute(
                        'INSERT INTO inventory_movements (product_id, order_id, quantity_delta, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                        [$line['id'], $orderId, -((int) $line['quantity']), 'order_placed', $context->userId(), $now],
                    );
                }
                if ($promo !== null) {
                    $this->database->execute(
                        'INSERT INTO promo_redemptions (promo_id, order_id, user_id, discount_cents, created_at) VALUES (?, ?, ?, ?, ?)',
                        [$promo['id'], $orderId, $context->userId(), $promoDiscount, $now],
                    );
                    $this->database->execute('UPDATE promos SET use_count = use_count + 1, updated_at = ? WHERE id = ?', [$now, $promo['id']]);
                }

                return $this->getOrder($orderId, (int) $context->userId());
            });
        } catch (PDOException $exception) {
            if ((string) $exception->getCode() === '23000') {
                $existing = $this->database->fetchOne('SELECT id, request_hash FROM orders WHERE customer_id = ? AND idempotency_hash = ?', [$context->userId(), $idempotencyHash]);
                if ($existing !== null) {
                    $this->assertIdempotencyMatch($existing, $requestHash);
                    return $this->getOrder((int) $existing['id'], (int) $context->userId());
                }
            }
            throw $exception;
        }
    }

    /** @return array<string, mixed> */
    public function getOrder(int $id, ?int $customerId = null): array
    {
        $sql = 'SELECT o.*, u.first_name, u.last_name, u.email FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = ? AND o.deleted_at IS NULL';
        $params = [$id];
        if ($customerId !== null) {
            $sql .= ' AND o.customer_id = ?';
            $params[] = $customerId;
        }
        $row = $this->database->fetchOne($sql, $params);
        if ($row === null) {
            throw new ApiException('ORDER_NOT_FOUND', 'The order was not found.', 404);
        }

        return $this->mapOrder($row);
    }

    /** @return list<array<string, mixed>> */
    public function customerOrders(int $customerId): array
    {
        $rows = $this->database->fetchAll(
            'SELECT o.*, u.first_name, u.last_name, u.email FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.customer_id = ? AND o.deleted_at IS NULL ORDER BY o.created_at DESC, o.id DESC',
            [$customerId],
        );

        return array_map([$this, 'mapOrder'], $rows);
    }

    /** @return list<array<string, mixed>> */
    public function allOrders(): array
    {
        return array_map([$this, 'mapOrder'], $this->database->fetchAll(
            'SELECT o.*, u.first_name, u.last_name, u.email FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.deleted_at IS NULL ORDER BY o.created_at DESC, o.id DESC LIMIT 500',
        ));
    }

    /** @param array<string, mixed> $input */
    public function updateByAdmin(int $orderId, array $input, ?int $actorUserId): void
    {
        $this->database->transaction(function () use ($orderId, $input, $actorUserId): void {
            $order = $this->lockedOrder($orderId);
            $status = (string) ($input['status'] ?? $order['status']);
            $this->assertStatusTransition((string) $order['status'], $status);

            $paymentStatus = (string) ($input['paymentStatus'] ?? $order['payment_status']);
            if (in_array($status, ['payment_confirmed', 'processing', 'packing', 'shipped', 'delivered'], true)) {
                if (!array_key_exists('paymentStatus', $input)) {
                    $paymentStatus = 'confirmed';
                }
                if ($paymentStatus === 'pending') {
                    throw new ApiException('ORDER_PAYMENT_STATUS_INVALID', 'A confirmed or fulfilled order cannot have pending payment.', 409);
                }
            }

            $now = Security::now();
            $restoredAt = $order['inventory_restored_at'];
            if ($status === 'cancelled' && $restoredAt === null) {
                $restoredAt = $this->restoreInventoryLocked($order, 'order_cancelled', $actorUserId, $now);
            }
            $reservationUntil = $status === 'pending_payment' ? $order['inventory_reserved_until'] : null;
            $trackingNumber = array_key_exists('trackingNumber', $input) ? ($input['trackingNumber'] ?: null) : $order['tracking_number'];
            $internalNote = array_key_exists('internalNote', $input) ? ($input['internalNote'] ?: null) : $order['internal_note'];

            $this->database->execute(
                'UPDATE orders SET status = ?, payment_status = ?, tracking_number = ?, internal_note = ?, inventory_reserved_until = ?, inventory_restored_at = ?, updated_at = ? WHERE id = ?',
                [$status, $paymentStatus, $trackingNumber, $internalNote, $reservationUntil, $restoredAt, $now, $order['id']],
            );
            $this->referrals?->transitionOrder($orderId, $status);
        });
    }

    public function archiveByAdmin(int $orderId, ?int $actorUserId): void
    {
        $this->database->transaction(function () use ($orderId, $actorUserId): void {
            $order = $this->lockedOrder($orderId);
            $now = Security::now();
            $status = (string) $order['status'];
            $restoredAt = $order['inventory_restored_at'];

            if ($restoredAt === null && !in_array($status, ['shipped', 'delivered'], true)) {
                $restoredAt = $this->restoreInventoryLocked($order, 'order_archived', $actorUserId, $now);
                $status = 'cancelled';
            }
            $this->database->execute(
                'UPDATE orders SET status = ?, inventory_reserved_until = NULL, inventory_restored_at = ?, deleted_at = ?, updated_at = ? WHERE id = ?',
                [$status, $restoredAt, $now, $now, $order['id']],
            );
            if ($status === 'cancelled') $this->referrals?->transitionOrder($orderId, 'cancelled');
        });
    }

    public function releaseExpiredReservations(int $limit = 100): int
    {
        $limit = max(1, min(1000, $limit));
        $now = Security::now();
        $rows = $this->database->fetchAll(
            "SELECT id FROM orders WHERE status = 'pending_payment' AND inventory_reserved_until IS NOT NULL AND inventory_reserved_until <= ? AND inventory_restored_at IS NULL AND deleted_at IS NULL ORDER BY id LIMIT " . $limit,
            [$now],
        );
        $released = 0;
        foreach ($rows as $candidate) {
            $didRelease = $this->database->transaction(function () use ($candidate, $now): bool {
                $sql = 'SELECT * FROM orders WHERE id = ?';
                if ($this->database->isMysql()) {
                    $sql .= ' FOR UPDATE';
                }
                $order = $this->database->fetchOne($sql, [(int) $candidate['id']]);
                if (
                    $order === null
                    || $order['deleted_at'] !== null
                    || $order['inventory_restored_at'] !== null
                    || $order['status'] !== 'pending_payment'
                    || $order['inventory_reserved_until'] === null
                    || (string) $order['inventory_reserved_until'] > $now
                ) {
                    return false;
                }
                $restoredAt = $this->restoreInventoryLocked($order, 'reservation_expired', null, $now);
                $this->database->execute(
                    "UPDATE orders SET status = 'cancelled', inventory_reserved_until = NULL, inventory_restored_at = ?, updated_at = ? WHERE id = ?",
                    [$restoredAt, $now, $order['id']],
                );
                $this->referrals?->transitionOrder((int) $order['id'], 'cancelled');
                return true;
            });
            if ($didRelease) {
                $released++;
            }
        }

        return $released;
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public function mapOrder(array $row): array
    {
        $lines = $this->database->fetchAll('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [$row['id']]);
        $receipt = $this->database->fetchOne('SELECT r.*, m.display_name AS payment_method_name, m.method_type FROM payment_receipts r JOIN payment_methods m ON m.id = r.payment_method_id WHERE r.order_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 1', [$row['id']]);
        return [
            'id' => (string) $row['public_id'],
            'orderNumber' => (string) $row['order_number'],
            'createdAt' => (string) $row['created_at'],
            'customerName' => trim((string) $row['first_name'] . ' ' . (string) $row['last_name']),
            'customerEmail' => (string) $row['email'],
            'status' => (string) $row['status'],
            'paymentStatus' => (string) $row['payment_status'],
            'paymentMethod' => (string) $row['payment_method'],
            'subtotal' => ((int) $row['subtotal_cents']) / 100,
            'discount' => ((int) $row['discount_cents']) / 100,
            'shipping' => ((int) $row['shipping_cents']) / 100,
            'total' => ((int) $row['total_cents']) / 100,
            'promoCode' => $row['promo_code'],
            'referralCode' => $row['referral_code'] ?? null,
            'referralDiscount' => ((int) ($row['referral_discount_cents'] ?? 0)) / 100,
            'trackingNumber' => $row['tracking_number'],
            'inventoryReservedUntil' => $row['inventory_reserved_until'] ?? null,
            'shippingAddress' => Security::jsonDecode((string) $row['shipping_address_json'], []),
            'bundleMetadata' => Security::jsonDecode($row['bundle_metadata_json'] ?? null),
            'paymentReceipt' => $receipt === null ? null : [
                'id' => (string) $receipt['public_id'], 'status' => (string) $receipt['status'],
                'paymentMethodId' => (string) $receipt['payment_method_id'], 'paymentMethodName' => (string) $receipt['payment_method_name'],
                'customerReference' => $receipt['customer_reference'], 'customerNote' => $receipt['customer_note'],
                'originalName' => (string) $receipt['original_name'], 'mimeType' => (string) $receipt['mime_type'],
                'sizeBytes' => (int) $receipt['size_bytes'], 'reviewNote' => $receipt['review_note'],
                'createdAt' => (string) $receipt['created_at'], 'reviewedAt' => $receipt['reviewed_at'],
            ],
            'lines' => array_map(static fn (array $line): array => [
                'id' => (string) $line['id'], 'productId' => (string) $line['product_id'], 'name' => (string) $line['product_name'],
                'quantity' => (int) $line['quantity'], 'unitPrice' => ((int) $line['unit_price_cents']) / 100,
            ], $lines),
        ];
    }

    /** @param list<array<string, mixed>> $items @return array{0:list<array<string,mixed>>,1:int} */
    private function pricedItems(array $items, bool $lock): array
    {
        $quantities = [];
        foreach ($items as $index => $item) {
            if (!is_array($item) || !isset($item['productId'], $item['quantity']) || !is_string($item['productId']) || !is_numeric($item['quantity'])) {
                throw new ApiException('VALIDATION_FAILED', 'Each order item must include a productId and quantity.', 422, ['items.' . $index => 'Invalid order line.']);
            }
            $quantity = (int) $item['quantity'];
            if ($quantity < 1 || $quantity > 20) {
                throw new ApiException('VALIDATION_FAILED', 'Order quantities must be between 1 and 20.', 422, ['items.' . $index . '.quantity' => 'Choose 1–20.']);
            }
            $quantities[$item['productId']] = ($quantities[$item['productId']] ?? 0) + $quantity;
        }
        ksort($quantities, SORT_STRING);
        $lines = [];
        $subtotal = 0;
        foreach ($quantities as $productId => $quantity) {
            $sql = 'SELECT id, sku, name, price_cents, stock_quantity, status FROM products WHERE id = ?';
            if ($lock && $this->database->isMysql()) {
                $sql .= ' FOR UPDATE';
            }
            $product = $this->database->fetchOne($sql, [$productId]);
            if ($product === null || $product['status'] !== 'active') {
                throw new ApiException('PRODUCT_UNAVAILABLE', 'A selected product is unavailable.', 409, ['productId' => $productId]);
            }
            if ((int) $product['stock_quantity'] < $quantity) {
                throw new ApiException('OUT_OF_STOCK', $product['name'] . ' does not have enough stock.', 409, ['productId' => $productId, 'available' => (int) $product['stock_quantity']]);
            }
            $lineTotal = (int) $product['price_cents'] * $quantity;
            $lines[] = [
                'id' => (string) $product['id'], 'sku' => $product['sku'], 'name' => (string) $product['name'],
                'price_cents' => (int) $product['price_cents'], 'quantity' => $quantity, 'line_total_cents' => $lineTotal,
            ];
            $subtotal += $lineTotal;
        }

        return [$lines, $subtotal];
    }

    /** @return array<string, mixed> */
    private function promoFor(string $code, int $subtotal, int $shipping, ?int $userId, bool $lock): array
    {
        $sql = 'SELECT * FROM promos WHERE code = ?';
        if ($lock && $this->database->isMysql()) {
            $sql .= ' FOR UPDATE';
        }
        $promo = $this->database->fetchOne($sql, [strtoupper(trim($code))]);
        if ($promo === null) {
            throw new ApiException('PROMO_NOT_FOUND', 'That offer code was not found.', 422);
        }
        $now = Security::now();
        if (!(bool) $promo['is_active']) {
            throw new ApiException('PROMO_INACTIVE', 'That offer is not currently active.', 422);
        }
        if ($promo['starts_at'] !== null && $promo['starts_at'] > $now) {
            throw new ApiException('PROMO_NOT_STARTED', 'That offer has not started yet.', 422);
        }
        if ($promo['ends_at'] !== null && $promo['ends_at'] < $now) {
            throw new ApiException('PROMO_ENDED', 'That offer has ended.', 422);
        }
        if ($subtotal < (int) $promo['minimum_subtotal_cents']) {
            throw new ApiException('PROMO_MINIMUM_NOT_MET', 'This ritual does not meet the offer’s minimum spend.', 422);
        }
        if ($promo['usage_limit'] !== null && (int) $promo['use_count'] >= (int) $promo['usage_limit']) {
            throw new ApiException('PROMO_LIMIT_REACHED', 'That offer has reached its usage limit.', 422);
        }
        if ($userId !== null && $promo['per_customer_limit'] !== null) {
            $used = $this->database->fetchOne('SELECT COUNT(*) AS aggregate FROM promo_redemptions WHERE promo_id = ? AND user_id = ?', [$promo['id'], $userId]);
            if ((int) ($used['aggregate'] ?? 0) >= (int) $promo['per_customer_limit']) {
                throw new ApiException('PROMO_LIMIT_REACHED', 'This account has already used that offer.', 422);
            }
        }
        $discount = 0;
        if ($promo['discount_type'] === 'percentage') {
            $discount = (int) round($subtotal * ((int) $promo['value_int']) / 10000, 0, PHP_ROUND_HALF_UP);
        } elseif ($promo['discount_type'] === 'fixed') {
            $discount = min($subtotal, (int) $promo['value_int']);
        } elseif ($promo['discount_type'] === 'free_shipping') {
            $shipping = 0;
        }
        if ($promo['max_discount_cents'] !== null) {
            $discount = min($discount, (int) $promo['max_discount_cents']);
        }
        $promo['discount_cents'] = $discount;
        $promo['shipping_cents'] = $shipping;

        return $promo;
    }

    private function shippingFor(int $subtotal): int
    {
        $settings = $this->store->settings(true);
        $threshold = (int) round(((float) ($settings['shippingThreshold'] ?? 180)) * 100);
        $fee = (int) round(((float) ($settings['shippingFee'] ?? 12)) * 100);

        return $subtotal >= $threshold ? 0 : $fee;
    }

    /** @param array<string, mixed> $address */
    private function validateAddress(array $address): void
    {
        Validator::requireValid($address, [
            'recipientName' => 'required|string|max:200', 'phone' => 'required|string|max:40', 'line1' => 'required|string|max:255',
            'line2' => 'sometimes|nullable|string|max:255', 'city' => 'required|string|max:120', 'state' => 'required|string|max:120',
            'postcode' => 'required|string|max:20', 'country' => 'required|string|max:120',
        ]);
        if (($address['country'] ?? '') === 'Malaysia' && !preg_match('/^\d{5}$/', (string) $address['postcode'])) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the shipping address.', 422, ['shippingAddress.postcode' => 'Enter a five-digit Malaysian postcode.']);
        }
    }

    /** @param array<string, mixed>|null $metadata @param list<array<string,mixed>> $lines @return array<string,mixed>|null */
    private function validateBundleMetadata(?array $metadata, array $lines): ?array
    {
        if ($metadata === null) {
            return null;
        }
        $groups = array_is_list($metadata) ? $metadata : [$metadata];
        $itemCounts = [];
        foreach ($lines as $line) {
            $itemCounts[$line['id']] = (int) $line['quantity'];
        }
        $normalized = [];
        $requiredCounts = [];
        $seenGroupIds = [];
        foreach ($groups as $groupIndex => $group) {
            if (!is_array($group) || !isset($group['bundleId'], $group['selections']) || !is_array($group['selections'])) {
                throw new ApiException('BUNDLE_INVALID', 'The selected bundle is incomplete.', 422, ['bundleMetadata.' . $groupIndex => 'Invalid bundle selection.']);
            }
            $bundle = $this->store->findBundle((string) $group['bundleId']);
            if ($bundle === null || !$bundle['active']) {
                throw new ApiException('BUNDLE_UNAVAILABLE', 'The selected bundle is no longer available.', 409);
            }
            $selectionsByStep = [];
            foreach ($group['selections'] as $selection) {
                if (!is_array($selection) || !isset($selection['stepId'], $selection['productIds']) || !is_array($selection['productIds'])) {
                    throw new ApiException('BUNDLE_INVALID', 'The selected bundle is incomplete.', 422);
                }
                $selectionsByStep[(string) $selection['stepId']] = array_values(array_unique(array_map('strval', $selection['productIds'])));
            }
            $knownStepIds = array_column($bundle['steps'], 'id');
            $unknownStepIds = array_diff(array_keys($selectionsByStep), $knownStepIds);
            if ($unknownStepIds !== []) {
                throw new ApiException('BUNDLE_INVALID', 'The bundle contains an unknown step.', 422);
            }
            foreach ($bundle['steps'] as $step) {
                $selected = $selectionsByStep[$step['id']] ?? [];
                if (count($selected) < $step['minSelections'] || count($selected) > $step['maxSelections']) {
                    throw new ApiException('BUNDLE_INVALID', 'Choose the required number of products for ' . $step['label'] . '.', 422);
                }
                foreach ($selected as $productId) {
                    if (!in_array($productId, $step['productIds'], true)) {
                        throw new ApiException('BUNDLE_INVALID', 'A bundle selection is not allowed or is missing from the cart.', 422);
                    }
                    $requiredCounts[$productId] = ($requiredCounts[$productId] ?? 0) + 1;
                }
            }
            $groupId = isset($group['groupId']) ? (string) $group['groupId'] : Security::uuid();
            if (!preg_match('/^[A-Za-z0-9._:-]{1,64}$/', $groupId) || isset($seenGroupIds[$groupId])) {
                throw new ApiException('BUNDLE_INVALID', 'Each bundle group must have a unique valid groupId.', 422);
            }
            $seenGroupIds[$groupId] = true;
            $normalized[] = [
                'bundleId' => $bundle['id'],
                'groupId' => $groupId,
                'discountType' => $bundle['discountType'] ?? 'none',
                'discountValue' => (float) ($bundle['discountValue'] ?? 0),
                'selections' => array_map(static fn (array $step): array => ['stepId' => $step['id'], 'productIds' => $selectionsByStep[$step['id']] ?? []], $bundle['steps']),
            ];
        }
        foreach ($requiredCounts as $productId => $required) {
            if (($itemCounts[$productId] ?? 0) < $required) {
                throw new ApiException('BUNDLE_INVALID', 'Bundle selections require more units than the cart contains.', 422, ['productId' => $productId, 'required' => $required]);
            }
        }

        return ['groups' => $normalized];
    }

    /** @param array<string,mixed>|null $metadata @param list<array<string,mixed>> $lines */
    private function bundleDiscount(?array $metadata, array $lines): int
    {
        $prices = [];
        foreach ($lines as $line) {
            $prices[(string) $line['id']] = (int) $line['price_cents'];
        }
        $discount = 0;
        foreach ($metadata['groups'] ?? [] as $group) {
            $groupSubtotal = 0;
            foreach ($group['selections'] ?? [] as $selection) {
                foreach ($selection['productIds'] ?? [] as $productId) {
                    $groupSubtotal += $prices[(string) $productId] ?? 0;
                }
            }
            $value = max(0.0, (float) ($group['discountValue'] ?? 0));
            if (($group['discountType'] ?? 'none') === 'fixed') {
                $discount += min($groupSubtotal, (int) round($value * 100));
            } elseif (($group['discountType'] ?? 'none') === 'percentage') {
                $basisPoints = min(10000, (int) round($value * 100));
                $discount += intdiv($groupSubtotal * $basisPoints, 10000);
            }
        }

        return $discount;
    }

    /** @param array<string,mixed>|null $metadata @return array<string,string>|null */
    private function bundleInfoForProduct(?array $metadata, string $productId): ?array
    {
        foreach ($metadata['groups'] ?? [] as $group) {
            foreach ($group['selections'] ?? [] as $selection) {
                if (in_array($productId, $selection['productIds'] ?? [], true)) {
                    return ['bundleId' => (string) $group['bundleId'], 'stepId' => (string) $selection['stepId'], 'groupId' => (string) $group['groupId']];
                }
            }
        }
        return null;
    }

    /** @return array<string, mixed> */
    private function lockedOrder(int $orderId): array
    {
        $sql = 'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL';
        if ($this->database->isMysql()) {
            $sql .= ' FOR UPDATE';
        }
        $order = $this->database->fetchOne($sql, [$orderId]);
        if ($order === null) {
            throw new ApiException('ORDER_NOT_FOUND', 'The order was not found.', 404);
        }

        return $order;
    }

    /** @param array<string, mixed> $existing */
    private function assertIdempotencyMatch(array $existing, string $requestHash): void
    {
        if (!hash_equals((string) ($existing['request_hash'] ?? ''), $requestHash)) {
            throw new ApiException('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different order request.', 409);
        }
    }

    private function assertStatusTransition(string $from, string $to): void
    {
        $allowed = [
            'pending_payment' => ['pending_payment', 'payment_confirmed', 'processing', 'packing', 'shipped', 'delivered', 'cancelled'],
            'payment_confirmed' => ['payment_confirmed', 'processing', 'packing', 'shipped', 'delivered', 'cancelled'],
            'processing' => ['processing', 'packing', 'shipped', 'delivered', 'cancelled'],
            'packing' => ['packing', 'shipped', 'delivered', 'cancelled'],
            'shipped' => ['shipped', 'delivered'],
            'delivered' => ['delivered'],
            'cancelled' => ['cancelled'],
        ];
        if (!in_array($to, $allowed[$from] ?? [], true)) {
            throw new ApiException('ORDER_STATUS_INVALID', 'This order status transition is not allowed.', 409);
        }
    }

    /** @param array<string, mixed> $order */
    private function restoreInventoryLocked(array $order, string $reason, ?int $actorUserId, string $now): string
    {
        $lines = $this->database->fetchAll('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [$order['id']]);
        foreach ($lines as $line) {
            $this->database->execute(
                'UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?',
                [(int) $line['quantity'], $now, $line['product_id']],
            );
            $this->database->execute(
                'INSERT INTO inventory_movements (product_id, order_id, quantity_delta, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$line['product_id'], $order['id'], (int) $line['quantity'], $reason, $actorUserId, $now],
            );
        }
        if ($order['promo_id'] !== null) {
            $removed = $this->database->execute('DELETE FROM promo_redemptions WHERE order_id = ?', [$order['id']]);
            if ($removed > 0) {
                $this->database->execute(
                    'UPDATE promos SET use_count = CASE WHEN use_count > 0 THEN use_count - 1 ELSE 0 END, updated_at = ? WHERE id = ?',
                    [$now, $order['promo_id']],
                );
            }
        }

        return $now;
    }
}

final class UploadService
{
    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
    ) {
    }

    /** @param array<string, mixed> $file @return array<string, mixed> */
    public function store(array $file, int $userId): array
    {
        $uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if (in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            throw new ApiException('UPLOAD_TOO_LARGE', 'The image exceeds the server upload limit.', 413);
        }
        if ($uploadError !== UPLOAD_ERR_OK || !isset($file['tmp_name'], $file['name'], $file['size'])) {
            throw new ApiException('UPLOAD_FAILED', 'The image upload did not complete.', 422);
        }
        $size = (int) $file['size'];
        if ($size < 1 || $size > $this->config->int('upload.max_bytes')) {
            throw new ApiException('UPLOAD_TOO_LARGE', 'The image exceeds the configured upload limit.', 413);
        }
        $temporary = (string) $file['tmp_name'];
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->file($temporary);
        $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        if (!isset($extensions[$mime])) {
            throw new ApiException('UPLOAD_TYPE_NOT_ALLOWED', 'Upload a JPEG, PNG or WebP image.', 422);
        }
        $dimensions = getimagesize($temporary);
        if ($dimensions === false || $dimensions[0] < 1 || $dimensions[1] < 1 || $dimensions[0] > 8000 || $dimensions[1] > 8000) {
            throw new ApiException('UPLOAD_IMAGE_INVALID', 'The image dimensions are invalid or too large.', 422);
        }
        $directory = $this->config->string('upload.dir');
        if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
            throw new ApiException('UPLOAD_STORAGE_UNAVAILABLE', 'Image storage is unavailable.', 500);
        }
        if (!chmod($directory, 0755)) {
            throw new ApiException('UPLOAD_STORAGE_UNAVAILABLE', 'Image storage permissions could not be prepared.', 500);
        }
        $storedName = gmdate('Y/m') . '/' . bin2hex(random_bytes(18)) . '.' . $extensions[$mime];
        $target = $directory . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $storedName);
        $targetDirectory = dirname($target);
        if (!is_dir($targetDirectory) && !mkdir($targetDirectory, 0755, true) && !is_dir($targetDirectory)) {
            throw new ApiException('UPLOAD_STORAGE_UNAVAILABLE', 'Image storage is unavailable.', 500);
        }
        if (!chmod($targetDirectory, 0755)) {
            throw new ApiException('UPLOAD_STORAGE_UNAVAILABLE', 'Image storage permissions could not be prepared.', 500);
        }
        if (!move_uploaded_file($temporary, $target)) {
            throw new ApiException('UPLOAD_FAILED', 'The image could not be stored.', 500);
        }
        if (!chmod($target, 0644)) {
            @unlink($target);
            throw new ApiException('UPLOAD_STORAGE_UNAVAILABLE', 'The uploaded image permissions could not be prepared.', 500);
        }
        $publicId = Security::uuid();
        $publicUrl = rtrim($this->config->string('upload.public_base'), '/') . '/' . str_replace('\\', '/', $storedName);
        try {
            $this->database->execute(
                'INSERT INTO uploads (public_id, original_name, stored_name, public_url, mime_type, size_bytes, width_px, height_px, sha256, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $publicId, mb_substr(basename((string) $file['name']), 0, 255), $storedName, $publicUrl, $mime, $size,
                    (int) $dimensions[0], (int) $dimensions[1], hash_file('sha256', $target), $userId, Security::now(),
                ],
            );
        } catch (\Throwable $exception) {
            @unlink($target);
            throw $exception;
        }

        return [
            'id' => $publicId, 'url' => $publicUrl, 'mimeType' => $mime, 'size' => $size,
            'width' => (int) $dimensions[0], 'height' => (int) $dimensions[1], 'createdAt' => Security::now(),
        ];
    }

    /** @return list<array<string, mixed>> */
    public function all(): array
    {
        return array_map(static fn (array $row): array => [
            'id' => (string) $row['public_id'], 'url' => (string) $row['public_url'], 'originalName' => (string) $row['original_name'],
            'mimeType' => (string) $row['mime_type'], 'size' => (int) $row['size_bytes'], 'width' => (int) $row['width_px'],
            'height' => (int) $row['height_px'], 'createdAt' => (string) $row['created_at'],
        ], $this->database->fetchAll('SELECT * FROM uploads ORDER BY created_at DESC, id DESC LIMIT 500'));
    }

    /** @return array<string, mixed> */
    public function delete(string $publicId): array
    {
        $row = $this->database->fetchOne('SELECT * FROM uploads WHERE public_id = ?', [$publicId]);
        if ($row === null) {
            throw new ApiException('UPLOAD_NOT_FOUND', 'The uploaded image was not found.', 404);
        }
        $root = realpath($this->config->string('upload.dir'));
        $path = $this->config->string('upload.dir') . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $row['stored_name']);
        $resolved = realpath($path);
        if ($root === false || ($resolved !== false && !str_starts_with($resolved, $root . DIRECTORY_SEPARATOR))) {
            throw new ApiException('UPLOAD_PATH_INVALID', 'The stored upload path is invalid.', 500);
        }

        $publicUrl = (string) $row['public_url'];
        $references = $this->database->fetchOne(
            'SELECT (' .
            '(SELECT COUNT(*) FROM products WHERE image_url = ? OR editorial_url = ? OR INSTR(story_images_json, ?) > 0) + ' .
            '(SELECT COUNT(*) FROM slides WHERE image_url = ?) + ' .
            '(SELECT COUNT(*) FROM gallery_items WHERE image_url = ?)' .
            ') AS aggregate',
            [$publicUrl, $publicUrl, $publicUrl, $publicUrl, $publicUrl],
        );
        if ((int) ($references['aggregate'] ?? 0) > 0) {
            throw new ApiException('UPLOAD_IN_USE', 'Remove this image from every product, slider and gallery item before deleting it.', 409);
        }

        $tombstone = null;
        if ($resolved !== false && is_file($resolved)) {
            $trashDirectory = dirname($this->config->string('upload.dir')) . DIRECTORY_SEPARATOR . 'upload-trash';
            if (!is_dir($trashDirectory) && !mkdir($trashDirectory, 0700, true) && !is_dir($trashDirectory)) {
                throw new ApiException('UPLOAD_STORAGE_UNAVAILABLE', 'Image cleanup storage is unavailable.', 500);
            }
            chmod($trashDirectory, 0700);
            $tombstone = $trashDirectory . DIRECTORY_SEPARATOR . $publicId . '-' . bin2hex(random_bytes(8));
            if (!rename($resolved, $tombstone)) {
                throw new ApiException('UPLOAD_DELETE_FAILED', 'The image could not be prepared for deletion.', 500);
            }
        }

        try {
            $this->database->transaction(function () use ($row): void {
                if ($this->database->execute('DELETE FROM uploads WHERE id = ?', [$row['id']]) !== 1) {
                    throw new RuntimeException('Upload metadata changed during deletion.');
                }
            });
        } catch (\Throwable $exception) {
            if ($tombstone !== null && is_file($tombstone) && !rename($tombstone, $path)) {
                error_log('[3rnco-upload] Unable to restore tombstoned upload after database rollback: ' . $tombstone);
            }
            throw $exception;
        }
        if ($tombstone !== null && is_file($tombstone) && !unlink($tombstone)) {
            error_log('[3rnco-upload] Deleted metadata but retained private tombstone for later cleanup: ' . $tombstone);
        }

        return ['id' => $publicId, 'deleted' => true];
    }
}

final class PaymentReceiptService
{
    public function __construct(private readonly Config $config, private readonly Database $database)
    {
    }

    /** @param array<string, mixed> $file @return array<string, mixed> */
    public function store(array $file, int $orderId, int $customerId, string $paymentMethodId, ?string $reference, ?string $note): array
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            throw new ApiException('RECEIPT_TOO_LARGE', 'The receipt exceeds the server upload limit.', 413);
        }
        if ($error !== UPLOAD_ERR_OK || !isset($file['tmp_name'], $file['name'], $file['size'])) {
            throw new ApiException('RECEIPT_UPLOAD_FAILED', 'The receipt upload did not complete.', 422);
        }
        $size = (int) $file['size'];
        if ($size < 1 || $size > $this->config->int('receipt.max_bytes')) {
            throw new ApiException('RECEIPT_TOO_LARGE', 'Receipts must be 8 MB or smaller.', 413);
        }
        $temporary = (string) $file['tmp_name'];
        $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($temporary);
        $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];
        if (!isset($extensions[$mime])) {
            throw new ApiException('RECEIPT_TYPE_NOT_ALLOWED', 'Upload a JPEG, PNG, WebP or PDF receipt.', 422);
        }
        $root = $this->config->string('receipt.dir');
        if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) {
            throw new ApiException('RECEIPT_STORAGE_UNAVAILABLE', 'Private receipt storage is unavailable.', 500);
        }
        chmod($root, 0700);
        $storedName = gmdate('Y/m') . '/' . bin2hex(random_bytes(20)) . '.' . $extensions[$mime];
        $target = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $storedName);
        if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0700, true) && !is_dir(dirname($target))) {
            throw new ApiException('RECEIPT_STORAGE_UNAVAILABLE', 'Private receipt storage is unavailable.', 500);
        }
        chmod(dirname($target), 0700);
        if (!move_uploaded_file($temporary, $target)) {
            throw new ApiException('RECEIPT_UPLOAD_FAILED', 'The receipt could not be stored.', 500);
        }
        chmod($target, 0600);
        $publicId = Security::uuid();
        $now = Security::now();
        try {
            $this->database->execute(
                'INSERT INTO payment_receipts (public_id, order_id, customer_id, payment_method_id, storage_key, original_name, mime_type, size_bytes, sha256, customer_reference, customer_note, status, review_note, reviewed_by, reviewed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$publicId, $orderId, $customerId, $paymentMethodId, $storedName, mb_substr(basename((string) $file['name']), 0, 255), $mime, $size, hash_file('sha256', $target), $reference, $note, 'submitted', null, null, null, $now, $now],
            );
        } catch (\Throwable $exception) {
            @unlink($target);
            throw $exception;
        }

        return ['id' => $publicId, 'status' => 'submitted', 'paymentMethodId' => $paymentMethodId, 'customerReference' => $reference, 'customerNote' => $note, 'originalName' => basename((string) $file['name']), 'mimeType' => $mime, 'sizeBytes' => $size, 'createdAt' => $now];
    }

    /** @return array<string, mixed> */
    public function file(string $publicId): array
    {
        $row = $this->database->fetchOne('SELECT * FROM payment_receipts WHERE public_id = ?', [$publicId]);
        if ($row === null) {
            throw new ApiException('RECEIPT_NOT_FOUND', 'The payment receipt was not found.', 404);
        }
        $root = realpath($this->config->string('receipt.dir'));
        $path = $this->config->string('receipt.dir') . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $row['storage_key']);
        $resolved = realpath($path);
        if ($root === false || $resolved === false || !str_starts_with($resolved, $root . DIRECTORY_SEPARATOR) || !is_file($resolved)) {
            throw new ApiException('RECEIPT_FILE_NOT_FOUND', 'The receipt file is unavailable.', 404);
        }
        $bytes = file_get_contents($resolved);
        if ($bytes === false) {
            throw new ApiException('RECEIPT_FILE_UNAVAILABLE', 'The receipt file could not be read.', 500);
        }

        return ['bytes' => $bytes, 'mimeType' => (string) $row['mime_type'], 'originalName' => (string) $row['original_name']];
    }
}
