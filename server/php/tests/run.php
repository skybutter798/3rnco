<?php

declare(strict_types=1);

use Rnco\App;
use Rnco\Config;
use Rnco\Database;
use Rnco\Migrator;
use Rnco\MaintenanceService;
use Rnco\OrderService;
use Rnco\RateLimiter;
use Rnco\Request;
use Rnco\Response;
use Rnco\Seeder;
use Rnco\StoreRepository;

$root = dirname(__DIR__);
foreach (['Config', 'Database', 'Http', 'Security', 'Migrator', 'Seeder', 'Auth', 'Services', 'Controllers', 'App'] as $file) {
    require_once $root . '/src/' . $file . '.php';
}

$passed = 0;
$failed = 0;

function test(string $name, callable $callback): void
{
    global $passed, $failed;
    try {
        $callback();
        $passed++;
        fwrite(STDOUT, "PASS {$name}\n");
    } catch (Throwable $exception) {
        $failed++;
        fwrite(STDERR, "FAIL {$name}: {$exception->getMessage()}\n");
    }
}

function assertTrue(bool $condition, string $message = 'Assertion failed'): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function assertSameValue(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(($message !== '' ? $message . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

/** @param array<string,mixed>|null $body @param array<string,string> $headers @param array<string,string> $cookies */
function callApi(App $app, string $method, string $path, ?array $body = null, array $headers = [], array $cookies = [], string $remoteAddress = '127.0.0.1'): Response
{
    $normalized = [];
    foreach ($headers as $name => $value) {
        $normalized[strtolower($name)] = $value;
    }
    if (!in_array(strtoupper($method), ['GET', 'HEAD', 'OPTIONS'], true)) {
        $normalized['origin'] ??= 'http://localhost';
    }
    return $app->handle(new Request(
        method: strtoupper($method),
        path: $path,
        headers: $normalized,
        cookies: $cookies,
        json: $body,
        remoteAddress: $remoteAddress,
        userAgent: '3rnco-automated-test',
    ));
}

/** @return array{cookie:string,csrf:string,user:array<string,mixed>} */
function sessionFrom(Response $response, string $cookieName): array
{
    assertTrue(($response->body['ok'] ?? false) === true, 'Expected a successful session response');
    $data = $response->body['data'];
    $cookie = null;
    foreach ($response->cookies as $item) {
        if ($item['name'] === $cookieName && $item['value'] !== '') {
            $cookie = $item;
        }
    }
    assertTrue($cookie !== null, 'Expected a rotated session cookie');
    assertTrue(($cookie['options']['httponly'] ?? false) === true, 'Session cookie must be HttpOnly');
    assertSameValue('Lax', $cookie['options']['samesite'] ?? null, 'Session cookie must be SameSite=Lax');
    return ['cookie' => $cookie['value'], 'csrf' => (string) ($data['csrfToken'] ?? ''), 'user' => (array) ($data['user'] ?? [])];
}

$temporaryRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'rnco-php-tests-' . bin2hex(random_bytes(6));
mkdir($temporaryRoot, 0700, true);
$databasePath = $temporaryRoot . DIRECTORY_SEPARATOR . 'test.sqlite';
$config = Config::forTesting([
    'db.database' => $databasePath,
    'upload.dir' => $temporaryRoot . DIRECTORY_SEPARATOR . 'uploads',
    'backup.dir' => $temporaryRoot . DIRECTORY_SEPARATOR . 'backups',
]);
$database = Database::connect($config);
$migrator = new Migrator($database, $root . '/database/migrations');
$applied = $migrator->migrate();
$seeder = new Seeder($database);
$firstSeed = $seeder->seed();
$secondSeed = $seeder->seed();
$app = new App($config, $database);
$cookieName = $config->string('session.cookie');

test('SQLite migration applies once and is idempotent', function () use ($applied, $migrator): void {
    assertSameValue(['001_schema', '002_staff_payments', '003_care_led_hero', '004_warm_gentle_hero', '005_core_essence_hero', '006_referrals'], $applied);
    assertSameValue([], $migrator->migrate());
});

test('seed preserves content and starts operational tables empty', function () use ($database, $firstSeed, $secondSeed): void {
    assertSameValue(4, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM products')['aggregate']);
    assertSameValue(3, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM slides')['aggregate']);
    assertSameValue(11, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM gallery_items')['aggregate']);
    assertSameValue(2, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM bundles')['aggregate']);
    assertSameValue(0, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM orders')['aggregate']);
    assertSameValue(0, (int) $database->fetchOne("SELECT COUNT(*) AS aggregate FROM users WHERE role = 'customer'")['aggregate']);
    assertSameValue(0, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM promos')['aggregate']);
    assertSameValue(0, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM enquiries')['aggregate']);
    assertSameValue(0, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM staff_profiles')['aggregate']);
    assertSameValue(0, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM payment_receipts')['aggregate']);
    assertSameValue(3, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM payment_methods')['aggregate']);
    assertSameValue(0, (int) $database->fetchOne('SELECT SUM(stock_quantity) AS aggregate FROM products')['aggregate']);
    assertSameValue(4, $firstSeed['products']);
    assertSameValue(0, $secondSeed['products']);
});

test('default admin is hashed and forced to change password', function () use ($database): void {
    $admin = $database->fetchOne("SELECT * FROM users WHERE username = 'admin'");
    assertTrue($admin !== null);
    assertTrue(password_verify('88888888', (string) $admin['password_hash']), 'Seed password must verify through password_verify');
    assertTrue($admin['password_hash'] !== '88888888', 'Seed password must never be stored in plaintext');
    assertSameValue(1, (int) $admin['must_change_password']);
});

test('storefront contract contains current content and exact bundle shape', function () use ($app): void {
    $response = callApi($app, 'GET', '/api/v1/storefront');
    assertSameValue(200, $response->status);
    $data = $response->body['data'];
    assertSameValue('3R&Co Malaysia', $data['settings']['storeName']);
    assertSameValue('60177816398', $data['settings']['whatsappNumber']);
    assertSameValue('Come home', $data['slides'][0]['title']);
    assertSameValue('/images/campaign/story-care-essence-v3.webp', $data['slides'][0]['image']);
    assertSameValue('From moringa,', $data['slides'][1]['title']);
    assertSameValue('/images/generated-v3/slider-botanical-leaf-v3.webp', $data['slides'][1]['image']);
    assertSameValue('/images/generated-v3/body-cream-texture-v4.webp', $data['products'][0]['storyImages'][0]['image']);
    assertTrue(is_int($data['products'][0]['price']) || is_float($data['products'][0]['price']), 'MYR price must be numeric');
    assertSameValue(0, $data['products'][0]['stock']);
    $bundle = $data['bundles'][0];
    assertSameValue(['id', 'name', 'title', 'description', 'active', 'discountType', 'discountValue', 'steps'], array_keys($bundle));
    assertSameValue(['id', 'label', 'description', 'productIds', 'minSelections', 'maxSelections', 'sortOrder'], array_keys($bundle['steps'][0]));
    assertSameValue(['body-cream', 'tree-body-oil'], $bundle['steps'][1]['productIds']);
});

test('health endpoint checks the database without leaking configuration', function () use ($app): void {
    $response = callApi($app, 'GET', '/api/v1/health');
    assertSameValue(200, $response->status);
    assertSameValue(['ok' => true, 'data' => ['status' => 'ok']], $response->body);
    $head = callApi($app, 'HEAD', '/api/v1/health');
    assertSameValue(200, $head->status);
    assertSameValue(null, $head->body);
});

$guest = sessionFrom(callApi($app, 'GET', '/api/v1/auth/session'), $cookieName);

test('auth session keeps a stable CSRF token across browser tabs', function () use ($app, $cookieName, &$guest): void {
    $again = callApi($app, 'GET', '/api/v1/auth/session', null, [], [$cookieName => $guest['cookie']]);
    assertSameValue(200, $again->status);
    assertSameValue($guest['csrf'], $again->body['data']['csrfToken']);
    assertSameValue([], $again->cookies);
});

test('temporary admin password is restricted to configured bootstrap IPs', function () use ($app, $cookieName): void {
    $remoteAddress = '198.51.100.20';
    $outsideGuest = sessionFrom(callApi($app, 'GET', '/api/v1/auth/session', null, [], [], $remoteAddress), $cookieName);
    $response = callApi(
        $app,
        'POST',
        '/api/v1/auth/login',
        ['identifier' => 'admin', 'password' => '88888888'],
        ['X-CSRF-Token' => $outsideGuest['csrf']],
        [$cookieName => $outsideGuest['cookie']],
        $remoteAddress,
    );
    assertSameValue(403, $response->status);
    assertSameValue('BOOTSTRAP_ADMIN_NETWORK_REQUIRED', $response->body['error']['code']);
});

test('admin login accepts username and requires password change', function () use ($app, $cookieName, &$guest, &$adminSession): void {
    $response = callApi($app, 'POST', '/api/v1/auth/login', ['identifier' => 'admin', 'password' => '88888888'], ['X-CSRF-Token' => $guest['csrf']], [$cookieName => $guest['cookie']]);
    assertSameValue(200, $response->status);
    $adminSession = sessionFrom($response, $cookieName);
    assertSameValue('admin', $adminSession['user']['role']);
    assertTrue($adminSession['user']['mustChangePassword'] === true);
});

test('forced admin can read settings but cannot access or mutate other admin resources', function () use ($app, $cookieName, &$adminSession): void {
    $settings = callApi($app, 'GET', '/api/v1/admin/settings', null, [], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $settings->status);
    $dashboard = callApi($app, 'GET', '/api/v1/admin/dashboard', null, [], [$cookieName => $adminSession['cookie']]);
    assertSameValue(403, $dashboard->status);
    assertSameValue('PASSWORD_CHANGE_REQUIRED', $dashboard->body['error']['code']);
    $mutation = callApi($app, 'PATCH', '/api/v1/admin/settings', ['announcement' => 'Not saved'], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(403, $mutation->status);
    assertSameValue('PASSWORD_CHANGE_REQUIRED', $mutation->body['error']['code']);
});

test('password change verifies current password, clears flag and rotates sessions', function () use ($app, $cookieName, &$adminSession): void {
    $wrong = callApi($app, 'POST', '/api/v1/auth/change-password', ['currentPassword' => 'wrong', 'newPassword' => 'BetterAdminPass123'], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(422, $wrong->status);
    assertSameValue('CURRENT_PASSWORD_INVALID', $wrong->body['error']['code']);
    $changed = callApi($app, 'POST', '/api/v1/auth/change-password', ['currentPassword' => '88888888', 'newPassword' => 'BetterAdminPass123'], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $changed->status);
    $previousCookie = $adminSession['cookie'];
    $adminSession = sessionFrom($changed, $cookieName);
    assertTrue($adminSession['cookie'] !== $previousCookie, 'Session token must rotate after password change');
    assertTrue($adminSession['user']['mustChangePassword'] === false);
    $old = callApi($app, 'GET', '/api/v1/admin/settings', null, [], [$cookieName => $previousCookie]);
    assertSameValue(401, $old->status);
    assertSameValue(200, callApi($app, 'GET', '/api/v1/admin/dashboard', null, [], [$cookieName => $adminSession['cookie']])->status);

    $remoteAddress = '198.51.100.20';
    $outsideGuest = sessionFrom(callApi($app, 'GET', '/api/v1/auth/session', null, [], [], $remoteAddress), $cookieName);
    $outsideLogin = callApi($app, 'POST', '/api/v1/auth/login', ['identifier' => 'admin', 'password' => 'BetterAdminPass123'], ['X-CSRF-Token' => $outsideGuest['csrf']], [$cookieName => $outsideGuest['cookie']], $remoteAddress);
    assertSameValue(200, $outsideLogin->status);
});

test('admin can update inventory and settings after securing account', function () use ($app, $cookieName, &$adminSession): void {
    $missingVersion = callApi($app, 'PATCH', '/api/v1/admin/products/body-cream', ['stock' => 2], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(422, $missingVersion->status);
    $product = callApi($app, 'PATCH', '/api/v1/admin/products/body-cream', ['stock' => 2, 'expectedStock' => 0], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $product->status);
    assertSameValue(2, $product->body['data']['product']['stock']);
    $settings = callApi($app, 'PATCH', '/api/v1/admin/settings', ['announcement' => 'Moringa-led body care · Made in Malaysia'], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $settings->status);
    $unsafe = callApi($app, 'PATCH', '/api/v1/admin/settings', ['instagramUrl' => 'javascript://alert.example/x'], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(422, $unsafe->status);
});

test('owner can create staff access without exposing the password', function () use ($app, $cookieName, &$adminSession): void {
    $created = callApi($app, 'POST', '/api/v1/admin/staff', ['username' => 'orders.team', 'fullName' => 'Orders Team', 'email' => 'orders@example.test', 'password' => 'staff8888', 'permissions' => ['dashboard', 'orders']], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(201, $created->status);
    assertSameValue('orders.team', $created->body['data']['staff']['username']);
    assertTrue(!array_key_exists('password', $created->body['data']['staff']));
    $listed = callApi($app, 'GET', '/api/v1/admin/staff', null, [], [$cookieName => $adminSession['cookie']]);
    assertSameValue(1, count($listed->body['data']['staff']));
});

$customerGuest = sessionFrom(callApi($app, 'GET', '/api/v1/auth/session'), $cookieName);

test('registration rejects missing CSRF and passwords shorter than eight characters', function () use ($app, $database, $cookieName, &$customerGuest): void {
    $body = ['fullName' => 'Blocked Customer', 'email' => 'blocked@example.test', 'phone' => '+6011222333', 'password' => 'Customer123'];
    $missingCsrf = callApi($app, 'POST', '/api/v1/auth/register', $body, [], [$cookieName => $customerGuest['cookie']]);
    assertSameValue(419, $missingCsrf->status);
    assertSameValue('CSRF_TOKEN_INVALID', $missingCsrf->body['error']['code']);

    $body['password'] = 'Short12';
    $weak = callApi($app, 'POST', '/api/v1/auth/register', $body, ['X-CSRF-Token' => $customerGuest['csrf']], [$cookieName => $customerGuest['cookie']]);
    assertSameValue(422, $weak->status);
    assertSameValue(0, (int) $database->fetchOne("SELECT COUNT(*) AS aggregate FROM users WHERE email = 'blocked@example.test'")['aggregate']);
});

test('customer can register, manage full profile and address', function () use ($app, $cookieName, &$customerGuest, &$customerSession): void {
    $registered = callApi($app, 'POST', '/api/v1/auth/register', [
        'fullName' => 'Alya Test', 'email' => 'alya@example.test', 'phone' => '+6011222333', 'password' => '!!!!!!!!',
    ], ['X-CSRF-Token' => $customerGuest['csrf']], [$cookieName => $customerGuest['cookie']]);
    assertSameValue(201, $registered->status);
    $customerSession = sessionFrom($registered, $cookieName);
    assertSameValue('Alya Test', $customerSession['user']['fullName']);
    $address = callApi($app, 'POST', '/api/v1/profile/addresses', [
        'label' => 'Home', 'recipientName' => 'Alya Test', 'phone' => '+6011222333', 'line1' => '1 Jalan Moringa',
        'city' => 'Kuala Lumpur', 'postcode' => '50000', 'state' => 'Kuala Lumpur', 'country' => 'Malaysia', 'isDefault' => true,
    ], ['X-CSRF-Token' => $customerSession['csrf']], [$cookieName => $customerSession['cookie']]);
    assertSameValue(201, $address->status);
    assertTrue($address->body['data']['address']['isDefault'] === true);
    $profile = callApi($app, 'GET', '/api/v1/profile', null, [], [$cookieName => $customerSession['cookie']]);
    assertSameValue(1, count($profile->body['data']['profile']['addresses']));
});

test('atomic order creation decrements once and honors idempotency', function () use ($app, $database, $cookieName, &$customerSession): void {
    $body = [
        'items' => [['productId' => 'body-cream', 'quantity' => 1]],
        'shippingAddress' => ['recipientName' => 'Alya Test', 'phone' => '+6011222333', 'line1' => '1 Jalan Moringa', 'city' => 'Kuala Lumpur', 'postcode' => '50000', 'state' => 'Kuala Lumpur', 'country' => 'Malaysia'],
        'paymentMethod' => 'manual_confirmation',
    ];
    $headers = ['X-CSRF-Token' => $customerSession['csrf'], 'Idempotency-Key' => 'test-order-key-0001'];
    $first = callApi($app, 'POST', '/api/v1/orders', $body, $headers, [$cookieName => $customerSession['cookie']]);
    assertSameValue(201, $first->status);
    assertSameValue('pending_payment', $first->body['data']['order']['status']);
    $second = callApi($app, 'POST', '/api/v1/orders', $body, $headers, [$cookieName => $customerSession['cookie']]);
    assertSameValue($first->body['data']['order']['id'], $second->body['data']['order']['id']);
    assertSameValue(1, (int) $database->fetchOne("SELECT stock_quantity FROM products WHERE id = 'body-cream'")['stock_quantity']);
    assertSameValue(1, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM orders')['aggregate']);

    $differentBody = $body;
    $differentBody['shippingAddress']['line1'] = '2 Jalan Moringa';
    $conflict = callApi($app, 'POST', '/api/v1/orders', $differentBody, $headers, [$cookieName => $customerSession['cookie']]);
    assertSameValue(409, $conflict->status);
    assertSameValue('IDEMPOTENCY_CONFLICT', $conflict->body['error']['code']);

    $body['items'][0]['quantity'] = 2;
    $failedOrder = callApi($app, 'POST', '/api/v1/orders', $body, ['X-CSRF-Token' => $customerSession['csrf'], 'Idempotency-Key' => 'test-order-key-0002'], [$cookieName => $customerSession['cookie']]);
    assertSameValue(409, $failedOrder->status);
    assertSameValue('OUT_OF_STOCK', $failedOrder->body['error']['code']);
    assertSameValue(1, (int) $database->fetchOne("SELECT stock_quantity FROM products WHERE id = 'body-cream'")['stock_quantity']);
    assertSameValue(1, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM orders')['aggregate']);
});

test('promo CRUD and validation use server-side product prices', function () use ($app, $cookieName, &$adminSession, &$customerSession): void {
    $created = callApi($app, 'POST', '/api/v1/admin/promos', [
        'code' => 'TEST10', 'description' => 'Ten percent test', 'type' => 'percentage', 'value' => 10,
        'minimumSpend' => 50, 'maximumDiscount' => 30, 'active' => true,
    ], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(201, $created->status);
    $promo = callApi($app, 'POST', '/api/v1/promos/validate', ['code' => 'TEST10', 'items' => [['productId' => 'body-cream', 'quantity' => 1]]], ['X-CSRF-Token' => $customerSession['csrf']], [$cookieName => $customerSession['cookie']]);
    assertSameValue(200, $promo->status);
    assertTrue($promo->body['data']['valid'] === true);
    assertSameValue(6.9, $promo->body['data']['discount']);
});

test('referral links apply configurable discounts and pay commission on repeat downline orders', function () use ($app, $database, $cookieName, &$adminSession, &$customerSession): void {
    $owner = callApi($app, 'POST', '/api/v1/admin/customers', [
        'fullName' => 'Sky Butter', 'email' => 'skybutter@example.test', 'phone' => '+60113334444',
        'password' => 'ReferralOwner123', 'status' => 'active',
    ], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(201, $owner->status);

    $linkInput = [
        'code' => 'skybutter', 'name' => 'Skybutter partner link',
        'referrerUserId' => $owner->body['data']['customer']['id'],
        'discountPercent' => 15, 'discountScope' => 'first_purchase',
        'commissionPercent' => 15, 'attributionDays' => 45, 'active' => true,
    ];
    $createdLink = callApi($app, 'POST', '/api/v1/admin/referrals', $linkInput, ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(201, $createdLink->status);
    assertSameValue(15, $createdLink->body['data']['referral']['discountPercent']);
    assertSameValue(15, $createdLink->body['data']['referral']['commissionPercent']);
    assertSameValue('first_purchase', $createdLink->body['data']['referral']['discountScope']);

    $existingCustomerPreview = callApi($app, 'POST', '/api/v1/referrals/resolve', ['code' => 'skybutter'], ['X-CSRF-Token' => $customerSession['csrf']], [$cookieName => $customerSession['cookie']]);
    assertSameValue(200, $existingCustomerPreview->status);
    assertSameValue(false, $existingCustomerPreview->body['data']['eligible']);

    $guest = sessionFrom(callApi($app, 'GET', '/api/v1/auth/session', null, [], [], '127.0.0.2'), $cookieName);
    $registered = callApi($app, 'POST', '/api/v1/auth/register', [
        'fullName' => 'Referral Buyer', 'email' => 'referral-buyer@example.test', 'phone' => '+60115556666', 'password' => 'ReferralBuyer123',
    ], ['X-CSRF-Token' => $guest['csrf']], [$cookieName => $guest['cookie']], '127.0.0.2');
    assertSameValue(201, $registered->status);
    $buyer = sessionFrom($registered, $cookieName);

    $preview = callApi($app, 'POST', '/api/v1/referrals/resolve', ['code' => 'skybutter'], ['X-CSRF-Token' => $buyer['csrf']], [$cookieName => $buyer['cookie']], '127.0.0.2');
    assertSameValue(200, $preview->status);
    assertSameValue(true, $preview->body['data']['eligible']);
    assertSameValue(45, $preview->body['data']['attributionDays']);

    $stocked = callApi($app, 'PATCH', '/api/v1/admin/products/tree-body-oil-travel', ['stock' => 2, 'expectedStock' => 0], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $stocked->status);
    $orderBody = [
        'items' => [['productId' => 'tree-body-oil-travel', 'quantity' => 1]],
        'referralCode' => 'skybutter',
        'shippingAddress' => ['recipientName' => 'Referral Buyer', 'phone' => '+60115556666', 'line1' => '15 Referral Lane', 'city' => 'Kuala Lumpur', 'postcode' => '50000', 'state' => 'Kuala Lumpur', 'country' => 'Malaysia'],
        'paymentMethod' => 'manual_confirmation',
    ];
    $first = callApi($app, 'POST', '/api/v1/orders', $orderBody, ['X-CSRF-Token' => $buyer['csrf'], 'Idempotency-Key' => 'referral-first-order-0001'], [$cookieName => $buyer['cookie']], '127.0.0.2');
    assertSameValue(201, $first->status);
    assertSameValue('skybutter', $first->body['data']['order']['referralCode']);
    assertSameValue(7.35, $first->body['data']['order']['referralDiscount']);
    assertSameValue(1, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM customer_referrals')['aggregate']);
    $firstCommission = $database->fetchOne('SELECT status, basis_cents, rate_basis_points, amount_cents FROM referral_commissions ORDER BY id DESC LIMIT 1');
    assertSameValue('pending', $firstCommission['status']);
    assertSameValue(4165, (int) $firstCommission['basis_cents']);
    assertSameValue(1500, (int) $firstCommission['rate_basis_points']);
    assertSameValue(625, (int) $firstCommission['amount_cents']);

    $confirmed = callApi($app, 'PATCH', '/api/v1/admin/orders/' . $first->body['data']['order']['id'], ['status' => 'payment_confirmed', 'paymentStatus' => 'confirmed'], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $confirmed->status);
    assertSameValue('approved', $database->fetchOne('SELECT status FROM referral_commissions ORDER BY id DESC LIMIT 1')['status']);

    $second = callApi($app, 'POST', '/api/v1/orders', $orderBody, ['X-CSRF-Token' => $buyer['csrf'], 'Idempotency-Key' => 'referral-repeat-order-0002'], [$cookieName => $buyer['cookie']], '127.0.0.2');
    assertSameValue(201, $second->status);
    assertSameValue(0, $second->body['data']['order']['referralDiscount']);
    $repeatCommission = $database->fetchOne('SELECT status, basis_cents, amount_cents FROM referral_commissions ORDER BY id DESC LIMIT 1');
    assertSameValue('pending', $repeatCommission['status']);
    assertSameValue(4900, (int) $repeatCommission['basis_cents']);
    assertSameValue(735, (int) $repeatCommission['amount_cents']);

    $linkInput['discountScope'] = 'every_purchase';
    $updatedLink = callApi($app, 'PATCH', '/api/v1/admin/referrals/' . $createdLink->body['data']['referral']['id'], $linkInput, ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $updatedLink->status);
    assertSameValue('every_purchase', $updatedLink->body['data']['referral']['discountScope']);

    $report = callApi($app, 'GET', '/api/v1/admin/referral-commissions', null, [], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $report->status);
    assertSameValue(2, count($report->body['data']['commissions']));
    $approved = array_values(array_filter($report->body['data']['commissions'], static fn (array $row): bool => $row['status'] === 'approved'));
    assertSameValue(1, count($approved));
    $paid = callApi($app, 'PATCH', '/api/v1/admin/referral-commissions/' . $approved[0]['id'], ['status' => 'paid', 'note' => 'August partner payout'], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
    assertSameValue(200, $paid->status);
    assertSameValue('paid', $paid->body['data']['commission']['status']);
});

test('canonical bundle order reserves stock and expiry restores inventory and promo once', function () use ($app, $config, $database, $cookieName, &$adminSession, &$customerSession): void {
    $database->execute("UPDATE bundles SET pricing_mode = 'fixed_discount', fixed_price_cents = 500 WHERE id = 'two-step'");
    foreach (['body-cream' => 1, 'champion-soap' => 0] as $productId => $expectedStock) {
        $stocked = callApi($app, 'PATCH', '/api/v1/admin/products/' . $productId, ['stock' => 1, 'expectedStock' => $expectedStock], ['X-CSRF-Token' => $adminSession['csrf']], [$cookieName => $adminSession['cookie']]);
        assertSameValue(200, $stocked->status);
    }
    $body = [
        'items' => [
            ['productId' => 'champion-soap', 'quantity' => 1],
            ['productId' => 'body-cream', 'quantity' => 1],
        ],
        'bundleMetadata' => [[
            'bundleId' => 'two-step',
            'selections' => [
                ['stepId' => 'cleanse', 'productIds' => ['champion-soap']],
                ['stepId' => 'layer', 'productIds' => ['body-cream']],
            ],
        ]],
        'promoCode' => 'TEST10',
        'shippingAddress' => ['recipientName' => 'Alya Test', 'phone' => '+6011222333', 'line1' => '1 Jalan Moringa', 'city' => 'Kuala Lumpur', 'postcode' => '50000', 'state' => 'Kuala Lumpur', 'country' => 'Malaysia'],
        'paymentMethod' => 'manual_confirmation',
    ];
    $created = callApi($app, 'POST', '/api/v1/orders', $body, ['X-CSRF-Token' => $customerSession['csrf'], 'Idempotency-Key' => 'bundle-order-key-0001'], [$cookieName => $customerSession['cookie']]);
    assertSameValue(201, $created->status);
    assertSameValue('two-step', $created->body['data']['order']['bundleMetadata']['groups'][0]['bundleId']);
    assertSameValue(17.6, $created->body['data']['order']['discount']);
    assertSameValue(1260, (int) $database->fetchOne("SELECT discount_cents FROM promo_redemptions r JOIN promos p ON p.id = r.promo_id WHERE p.code = 'TEST10' ORDER BY r.id DESC LIMIT 1")['discount_cents']);
    assertTrue($created->body['data']['order']['inventoryReservedUntil'] !== null);
    assertSameValue(1, (int) $database->fetchOne("SELECT use_count FROM promos WHERE code = 'TEST10'")['use_count']);

    $internal = $database->fetchOne('SELECT id FROM orders WHERE public_id = ?', [$created->body['data']['order']['id']]);
    assertTrue($internal !== null);
    $database->execute("UPDATE orders SET inventory_reserved_until = '2000-01-01 00:00:00' WHERE id = ?", [$internal['id']]);
    $service = new OrderService($database, new StoreRepository($database), $config);
    assertSameValue(1, $service->releaseExpiredReservations());
    assertSameValue(0, $service->releaseExpiredReservations());
    $released = $database->fetchOne('SELECT status, inventory_restored_at, inventory_reserved_until FROM orders WHERE id = ?', [$internal['id']]);
    assertSameValue('cancelled', $released['status']);
    assertTrue($released['inventory_restored_at'] !== null);
    assertSameValue(null, $released['inventory_reserved_until']);
    assertSameValue(1, (int) $database->fetchOne("SELECT stock_quantity FROM products WHERE id = 'body-cream'")['stock_quantity']);
    assertSameValue(1, (int) $database->fetchOne("SELECT stock_quantity FROM products WHERE id = 'champion-soap'")['stock_quantity']);
    assertSameValue(0, (int) $database->fetchOne("SELECT use_count FROM promos WHERE code = 'TEST10'")['use_count']);
    assertSameValue(1, (int) $database->fetchOne("SELECT COUNT(*) AS aggregate FROM inventory_movements WHERE order_id = ? AND reason = 'reservation_expired' AND product_id = 'body-cream'", [$internal['id']])['aggregate']);

    $duplicateGroups = $body;
    unset($duplicateGroups['promoCode']);
    $duplicateGroups['bundleMetadata'][] = $duplicateGroups['bundleMetadata'][0];
    $invalid = callApi($app, 'POST', '/api/v1/orders', $duplicateGroups, ['X-CSRF-Token' => $customerSession['csrf'], 'Idempotency-Key' => 'bundle-order-key-0002'], [$cookieName => $customerSession['cookie']]);
    assertSameValue(422, $invalid->status);
    assertSameValue('BUNDLE_INVALID', $invalid->body['error']['code']);
    assertSameValue(1, (int) $database->fetchOne("SELECT stock_quantity FROM products WHERE id = 'body-cream'")['stock_quantity']);
});

test('public enquiries and newsletter persist without simulation seeds', function () use ($app, $database, $cookieName, &$customerSession): void {
    $enquiry = callApi($app, 'POST', '/api/v1/enquiries', [
        'name' => 'Alya Test', 'email' => 'alya@example.test', 'subject' => 'Product guidance', 'message' => 'Which finishing layer suits a first ritual?',
    ], ['X-CSRF-Token' => $customerSession['csrf']], [$cookieName => $customerSession['cookie']]);
    assertSameValue(201, $enquiry->status);
    $newsletter = callApi($app, 'POST', '/api/v1/newsletter', ['email' => 'alya@example.test'], ['X-CSRF-Token' => $customerSession['csrf']], [$cookieName => $customerSession['cookie']]);
    assertSameValue(200, $newsletter->status);
    assertSameValue(1, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM enquiries')['aggregate']);
    assertSameValue(1, (int) $database->fetchOne('SELECT COUNT(*) AS aggregate FROM newsletter_subscribers')['aggregate']);
});

test('SQLite query planner uses customer order index', function () use ($database): void {
    $plan = $database->fetchAll('EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC', [2]);
    $detail = implode(' ', array_map(static fn (array $row): string => (string) $row['detail'], $plan));
    assertTrue(str_contains($detail, 'idx_orders_customer_created'), 'Expected customer order index, got: ' . $detail);
});

test('all API failures keep the fixed error envelope', function () use ($app): void {
    $response = callApi($app, 'GET', '/api/v1/does-not-exist');
    assertSameValue(404, $response->status);
    assertSameValue(false, $response->body['ok']);
    assertTrue(isset($response->body['error']['code'], $response->body['error']['message']));
});

test('rate limiter atomically preserves the limit after a rejected hit', function () use ($config, $database): void {
    $limiter = new RateLimiter($config, $database);
    $limiter->consume('automated-limit-test', 'one-subject', 2, 60);
    $limiter->consume('automated-limit-test', 'one-subject', 2, 60);
    try {
        $limiter->consume('automated-limit-test', 'one-subject', 2, 60);
        throw new RuntimeException('Expected the third request to be rate limited.');
    } catch (Rnco\ApiException $exception) {
        assertSameValue('RATE_LIMITED', $exception->errorCode);
    }
    $hash = Rnco\Security::keyedHash('automated-limit-test|one-subject', $config);
    assertSameValue(2, (int) $database->fetchOne('SELECT hits FROM rate_limits WHERE bucket_hash = ?', [$hash])['hits']);
});

test('maintenance cleanup removes only stale session and rate-limit state', function () use ($database): void {
    $database->execute(
        'INSERT INTO auth_sessions (token_hash, user_id, csrf_hash, ip_hash, user_agent_hash, expires_at, last_seen_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [str_repeat('a', 64), null, str_repeat('b', 64), str_repeat('c', 64), str_repeat('d', 64), '2000-01-01 00:00:00', '2000-01-01 00:00:00', null, '2000-01-01 00:00:00'],
    );
    $database->execute(
        'INSERT INTO rate_limits (bucket_hash, hits, window_started_at, updated_at) VALUES (?, ?, ?, ?)',
        [str_repeat('e', 64), 1, '2000-01-01 00:00:00', '2000-01-01 00:00:00'],
    );
    $result = (new MaintenanceService($database))->cleanup();
    assertTrue($result['sessions'] >= 1);
    assertTrue($result['rateLimits'] >= 1);
    assertSameValue(null, $database->fetchOne('SELECT token_hash FROM auth_sessions WHERE token_hash = ?', [str_repeat('a', 64)]));
    assertSameValue(null, $database->fetchOne('SELECT bucket_hash FROM rate_limits WHERE bucket_hash = ?', [str_repeat('e', 64)]));
});

test('MySQL migration is explicitly MySQL 5.7 utf8mb4 compatible', function () use ($root): void {
    $sql = file_get_contents($root . '/database/migrations/mysql/001_schema.sql');
    assertTrue($sql !== false);
    assertTrue(str_contains($sql, 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'));
    assertTrue(!str_contains($sql, 'utf8mb4_0900'), 'MySQL 8-only collation must not be used');
});

test('public upload permissions are compatible with cPanel static serving', function () use ($root): void {
    $source = file_get_contents($root . '/src/Services.php');
    assertTrue($source !== false);
    assertTrue(str_contains($source, 'mkdir($directory, 0755, true)'));
    assertTrue(str_contains($source, 'mkdir($targetDirectory, 0755, true)'));
    assertTrue(str_contains($source, 'chmod($target, 0644)'));
});

test('upload deletion refuses referenced media and completes through private tombstone', function () use ($config, $database): void {
    $uploadRoot = $config->string('upload.dir');
    $storedName = '2026/08/delete-test.png';
    $storedPath = $uploadRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $storedName);
    if (!is_dir(dirname($storedPath))) {
        mkdir(dirname($storedPath), 0755, true);
    }
    file_put_contents($storedPath, 'test-image');
    $admin = $database->fetchOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    $publicId = Rnco\Security::uuid();
    $publicUrl = '/uploads/' . $storedName;
    $database->execute(
        'INSERT INTO uploads (public_id, original_name, stored_name, public_url, mime_type, size_bytes, width_px, height_px, sha256, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$publicId, 'delete-test.png', $storedName, $publicUrl, 'image/png', 10, 1, 1, hash('sha256', 'test-image'), $admin['id'], Rnco\Security::now()],
    );
    $product = $database->fetchOne("SELECT image_url FROM products WHERE id = 'body-cream'");
    $database->execute("UPDATE products SET image_url = ? WHERE id = 'body-cream'", [$publicUrl]);
    $service = new Rnco\UploadService($config, $database);
    try {
        $service->delete($publicId);
        throw new RuntimeException('Referenced upload deletion should have failed.');
    } catch (Rnco\ApiException $exception) {
        assertSameValue('UPLOAD_IN_USE', $exception->errorCode);
        assertSameValue(409, $exception->status);
    }
    assertTrue(is_file($storedPath));
    $database->execute("UPDATE products SET image_url = ? WHERE id = 'body-cream'", [$product['image_url']]);
    $result = $service->delete($publicId);
    assertSameValue(true, $result['deleted']);
    assertTrue(!is_file($storedPath));
    assertSameValue(null, $database->fetchOne('SELECT id FROM uploads WHERE public_id = ?', [$publicId]));
});

if ($failed === 0) {
    @unlink($databasePath);
    @rmdir($temporaryRoot . DIRECTORY_SEPARATOR . 'uploads');
    @rmdir($temporaryRoot . DIRECTORY_SEPARATOR . 'backups');
    @rmdir($temporaryRoot);
}

fwrite(STDOUT, sprintf("\n%d passed, %d failed\n", $passed, $failed));
exit($failed === 0 ? 0 : 1);
