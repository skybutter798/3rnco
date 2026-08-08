<?php

declare(strict_types=1);

namespace Rnco;

use PDOException;

final class StoreController
{
    public function __construct(
        private readonly StoreRepository $store,
        private readonly Database $database,
    ) {
    }

    public function storefront(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success($this->store->storefront());
    }

    public function health(Request $request, array $params, ?AuthContext $context): Response
    {
        $this->database->fetchOne('SELECT 1 AS healthy');
        if ($request->method === 'HEAD') {
            return Response::empty(200);
        }
        return Response::success(['status' => 'ok']);
    }
}

final class AuthController
{
    public function __construct(
        private readonly Auth $auth,
        private readonly RateLimiter $rateLimiter,
        private readonly AuditLogger $audit,
    ) {
    }

    public function session(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success($this->auth->sessionSnapshot($request));
    }

    public function register(Request $request, array $params, ?AuthContext $context): Response
    {
        if ($context === null) {
            throw new ApiException('CSRF_SESSION_REQUIRED', 'Start a secure session before registering.', 419);
        }
        if ($context->authenticated()) {
            throw new ApiException('ALREADY_AUTHENTICATED', 'Sign out before creating another account.', 409);
        }
        $email = Security::normalizeEmail((string) ($request->input('email') ?? ''));
        $this->rateLimiter->consume('register-ip-email', $request->remoteAddress . '|' . $email, 3, 3600);
        $result = $this->auth->register($context, $request->json(), $request);
        $this->audit->log(null, $request, 'auth.register', 'user', (string) ($result['user']['id'] ?? ''), null, ['role' => 'customer']);

        return Response::success($result, 201);
    }

    public function login(Request $request, array $params, ?AuthContext $context): Response
    {
        if ($context === null) {
            throw new ApiException('CSRF_SESSION_REQUIRED', 'Start a secure session before signing in.', 419);
        }
        if ($context->authenticated()) {
            throw new ApiException('ALREADY_AUTHENTICATED', 'This browser is already signed in.', 409);
        }
        $identifier = Security::normalizeEmail((string) ($request->input('identifier') ?? $request->input('email') ?? $request->input('username') ?? $request->input('login') ?? ''));
        $this->rateLimiter->consume('login-ip-identifier', $request->remoteAddress . '|' . $identifier, 8, 900);
        $result = $this->auth->login($context, $request->json(), $request);
        $this->audit->log(null, $request, 'auth.login', 'user', (string) ($result['user']['id'] ?? ''), null, ['role' => $result['user']['role'] ?? null]);

        return Response::success($result);
    }

    public function logout(Request $request, array $params, ?AuthContext $context): Response
    {
        if ($context === null) {
            throw new ApiException('AUTHENTICATION_REQUIRED', 'Sign in to continue.', 401);
        }
        $this->auth->logout($context);

        return Response::success(['signedOut' => true]);
    }

    public function changePassword(Request $request, array $params, ?AuthContext $context): Response
    {
        if ($context === null || !$context->authenticated()) {
            throw new ApiException('AUTHENTICATION_REQUIRED', 'Sign in to continue.', 401);
        }
        $result = $this->auth->changePassword($context, $request->json(), $request);
        $this->audit->log($context, $request, 'auth.password_changed', 'user', (string) ($context->user['public_id'] ?? ''), null, ['sessionsRotated' => true]);

        return Response::success($result);
    }
}

final class AccountController
{
    public function __construct(
        private readonly Database $database,
        private readonly Auth $auth,
        private readonly OrderService $orders,
        private readonly AuditLogger $audit,
    ) {
    }

    public function profile(Request $request, array $params, ?AuthContext $context): Response
    {
        $user = $this->requiredUser($context);
        $profile = $this->profileData((int) $user['id']);

        return Response::success(['profile' => $profile]);
    }

    public function updateProfile(Request $request, array $params, ?AuthContext $context): Response
    {
        $user = $this->requiredUser($context);
        $input = $request->json();
        if (isset($input['fullName']) && (!isset($input['firstName']) || !isset($input['lastName']))) {
            $parts = preg_split('/\s+/', trim((string) $input['fullName']), 2) ?: [];
            $input['firstName'] = $parts[0] ?? '';
            $input['lastName'] = $parts[1] ?? '';
        }
        if (array_key_exists('birthDate', $input) && !array_key_exists('dateOfBirth', $input)) {
            $input['dateOfBirth'] = $input['birthDate'];
        }
        Validator::requireValid($input, [
            'firstName' => 'sometimes|string|max:100', 'lastName' => 'sometimes|string|max:100', 'displayName' => 'sometimes|nullable|string|max:150',
            'phone' => 'sometimes|nullable|string|max:40', 'dateOfBirth' => 'sometimes|nullable|string|max:10', 'marketingConsent' => 'sometimes|bool',
        ]);
        $fields = [
            'first_name' => $input['firstName'] ?? $user['first_name'],
            'last_name' => $input['lastName'] ?? $user['last_name'],
            'display_name' => array_key_exists('displayName', $input) ? ($input['displayName'] ?: null) : $user['display_name'],
            'phone' => array_key_exists('phone', $input) ? ($input['phone'] ?: null) : $user['phone'],
            'date_of_birth' => array_key_exists('dateOfBirth', $input) ? ($input['dateOfBirth'] ?: null) : $user['date_of_birth'],
            'marketing_consent' => array_key_exists('marketingConsent', $input) ? (!empty($input['marketingConsent']) ? 1 : 0) : (int) $user['marketing_consent'],
        ];
        if ($fields['date_of_birth'] !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $fields['date_of_birth'])) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['birthDate' => 'Use YYYY-MM-DD.']);
        }
        $this->database->execute(
            'UPDATE users SET first_name = ?, last_name = ?, display_name = ?, phone = ?, date_of_birth = ?, marketing_consent = ?, updated_at = ? WHERE id = ?',
            [$fields['first_name'], $fields['last_name'], $fields['display_name'], $fields['phone'], $fields['date_of_birth'], $fields['marketing_consent'], Security::now(), $user['id']],
        );
        $profile = $this->profileData((int) $user['id']);
        $this->audit->log($context, $request, 'profile.updated', 'user', (string) $user['public_id'], null, ['fields' => array_keys($input)]);

        return Response::success(['profile' => $profile]);
    }

    public function addresses(Request $request, array $params, ?AuthContext $context): Response
    {
        $user = $this->requiredUser($context);
        return Response::success(['addresses' => $this->addressRows((int) $user['id'])]);
    }

    public function createAddress(Request $request, array $params, ?AuthContext $context): Response
    {
        $user = $this->requiredUser($context);
        $address = $this->normalizeAddress($request->json());
        $publicId = Security::uuid();
        $this->database->transaction(function () use ($user, $address, $publicId): void {
            if ($address['isDefault']) {
                $this->database->execute('UPDATE user_addresses SET is_default_shipping = 0, updated_at = ? WHERE user_id = ?', [Security::now(), $user['id']]);
            }
            $now = Security::now();
            $this->database->execute(
                'INSERT INTO user_addresses (public_id, user_id, label, recipient_name, phone, line1, line2, city, state, postcode, country_code, is_default_shipping, is_default_billing, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$publicId, $user['id'], $address['label'], $address['recipientName'], $address['phone'], $address['line1'], $address['line2'], $address['city'], $address['state'], $address['postcode'], $address['countryCode'], $address['isDefault'] ? 1 : 0, 0, $now, $now],
            );
        });
        $saved = $this->database->fetchOne('SELECT * FROM user_addresses WHERE public_id = ?', [$publicId]);
        $this->audit->log($context, $request, 'address.created', 'address', $publicId, null, $address);

        return Response::success(['address' => $this->mapAddress($saved ?? [])], 201);
    }

    public function updateAddress(Request $request, array $params, ?AuthContext $context): Response
    {
        $user = $this->requiredUser($context);
        $existing = $this->database->fetchOne('SELECT * FROM user_addresses WHERE public_id = ? AND user_id = ?', [$params['id'], $user['id']]);
        if ($existing === null) {
            throw new ApiException('ADDRESS_NOT_FOUND', 'The address was not found.', 404);
        }
        $input = array_replace($this->mapAddress($existing), $request->json());
        $address = $this->normalizeAddress($input);
        $this->database->transaction(function () use ($user, $existing, $address): void {
            if ($address['isDefault']) {
                $this->database->execute('UPDATE user_addresses SET is_default_shipping = 0, updated_at = ? WHERE user_id = ?', [Security::now(), $user['id']]);
            }
            $this->database->execute(
                'UPDATE user_addresses SET label = ?, recipient_name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, state = ?, postcode = ?, country_code = ?, is_default_shipping = ?, updated_at = ? WHERE id = ?',
                [$address['label'], $address['recipientName'], $address['phone'], $address['line1'], $address['line2'], $address['city'], $address['state'], $address['postcode'], $address['countryCode'], $address['isDefault'] ? 1 : 0, Security::now(), $existing['id']],
            );
        });
        $saved = $this->database->fetchOne('SELECT * FROM user_addresses WHERE id = ?', [$existing['id']]);
        $this->audit->log($context, $request, 'address.updated', 'address', (string) $params['id'], $this->mapAddress($existing), $address);

        return Response::success(['address' => $this->mapAddress($saved ?? [])]);
    }

    public function deleteAddress(Request $request, array $params, ?AuthContext $context): Response
    {
        $user = $this->requiredUser($context);
        $existing = $this->database->fetchOne('SELECT * FROM user_addresses WHERE public_id = ? AND user_id = ?', [$params['id'], $user['id']]);
        if ($existing === null) {
            throw new ApiException('ADDRESS_NOT_FOUND', 'The address was not found.', 404);
        }
        $this->database->execute('DELETE FROM user_addresses WHERE id = ?', [$existing['id']]);
        $this->audit->log($context, $request, 'address.deleted', 'address', (string) $params['id'], $this->mapAddress($existing), null);

        return Response::success(['id' => $params['id'], 'deleted' => true]);
    }

    public function orders(Request $request, array $params, ?AuthContext $context): Response
    {
        $user = $this->requiredUser($context);
        return Response::success(['orders' => $this->orders->customerOrders((int) $user['id'])]);
    }

    /** @return array<string, mixed> */
    private function requiredUser(?AuthContext $context): array
    {
        if ($context === null || $context->user === null) {
            throw new ApiException('AUTHENTICATION_REQUIRED', 'Sign in to continue.', 401);
        }
        return $context->user;
    }

    /** @return array<string, mixed> */
    private function profileData(int $userId): array
    {
        $user = $this->database->fetchOne('SELECT * FROM users WHERE id = ?', [$userId]);
        if ($user === null) {
            throw new ApiException('ACCOUNT_NOT_FOUND', 'The account was not found.', 404);
        }
        return array_merge($this->auth->publicUser($user), ['addresses' => $this->addressRows($userId)]);
    }

    /** @return list<array<string, mixed>> */
    private function addressRows(int $userId): array
    {
        return array_map([$this, 'mapAddress'], $this->database->fetchAll('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default_shipping DESC, created_at, id', [$userId]));
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    private function normalizeAddress(array $input): array
    {
        Validator::requireValid($input, [
            'label' => 'required|string|max:80', 'recipientName' => 'required|string|max:200', 'phone' => 'required|string|max:40',
            'line1' => 'required|string|max:255', 'line2' => 'sometimes|nullable|string|max:255', 'city' => 'required|string|max:120',
            'state' => 'required|string|max:120', 'postcode' => 'required|string|max:20', 'country' => 'required|string|max:120', 'isDefault' => 'sometimes|bool',
        ]);
        $country = trim((string) $input['country']);
        if ($country === 'Malaysia' && !preg_match('/^\d{5}$/', (string) $input['postcode'])) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['postcode' => 'Enter a five-digit Malaysian postcode.']);
        }
        return [
            'label' => trim((string) $input['label']), 'recipientName' => trim((string) $input['recipientName']), 'phone' => trim((string) $input['phone']),
            'line1' => trim((string) $input['line1']), 'line2' => isset($input['line2']) && trim((string) $input['line2']) !== '' ? trim((string) $input['line2']) : null,
            'city' => trim((string) $input['city']), 'state' => trim((string) $input['state']), 'postcode' => trim((string) $input['postcode']),
            'country' => $country, 'countryCode' => $country === 'Malaysia' ? 'MY' : strtoupper(substr($country, 0, 2)), 'isDefault' => !empty($input['isDefault']),
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function mapAddress(array $row): array
    {
        return [
            'id' => (string) ($row['public_id'] ?? ''), 'label' => (string) ($row['label'] ?? ''), 'recipientName' => (string) ($row['recipient_name'] ?? ''),
            'phone' => (string) ($row['phone'] ?? ''), 'line1' => (string) ($row['line1'] ?? ''), 'line2' => $row['line2'] ?? null,
            'city' => (string) ($row['city'] ?? ''), 'postcode' => (string) ($row['postcode'] ?? ''), 'state' => (string) ($row['state'] ?? ''),
            'country' => ($row['country_code'] ?? 'MY') === 'MY' ? 'Malaysia' : (string) $row['country_code'], 'isDefault' => (bool) ($row['is_default_shipping'] ?? false),
        ];
    }
}

final class PublicController
{
    public function __construct(
        private readonly Database $database,
        private readonly OrderService $orders,
        private readonly RateLimiter $rateLimiter,
        private readonly AuditLogger $audit,
    ) {
    }

    public function validatePromo(Request $request, array $params, ?AuthContext $context): Response
    {
        Validator::requireValid($request->json(), ['code' => 'required|string|max:64', 'items' => 'required|array']);
        /** @var list<array<string,mixed>> $items */
        $items = array_values((array) $request->input('items'));
        return Response::success($this->orders->validatePromo((string) $request->input('code'), $items, $context?->userId()));
    }

    public function createOrder(Request $request, array $params, ?AuthContext $context): Response
    {
        if ($context === null || $context->role() !== 'customer') {
            throw new ApiException('CUSTOMER_AUTHENTICATION_REQUIRED', 'Sign in with a customer account to place an order.', 401);
        }
        $idempotencyKey = $request->header('idempotency-key') ?? '';
        $order = $this->orders->create($context, $request->json(), $idempotencyKey);
        $this->audit->log($context, $request, 'order.created', 'order', (string) $order['id'], null, ['orderNumber' => $order['orderNumber'], 'total' => $order['total']]);

        return Response::success(['order' => $order], 201);
    }

    public function enquiry(Request $request, array $params, ?AuthContext $context): Response
    {
        $input = $request->json();
        Validator::requireValid($input, [
            'name' => 'required|string|max:200', 'email' => 'required|string|email|max:191', 'phone' => 'sometimes|nullable|string|max:40',
            'subject' => 'required|string|max:255', 'message' => 'required|string|min:10|max:5000', 'channel' => 'sometimes|string|in:website,whatsapp,email',
        ]);
        $publicId = Security::uuid();
        $now = Security::now();
        $this->database->execute(
            'INSERT INTO enquiries (public_id, user_id, name, email, phone, channel, subject, message, status, admin_notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$publicId, $context?->userId(), trim((string) $input['name']), Security::normalizeEmail((string) $input['email']), $input['phone'] ?? null, $input['channel'] ?? 'website', trim((string) $input['subject']), trim((string) $input['message']), 'new', null, $now, $now],
        );
        return Response::success(['enquiry' => ['id' => $publicId, 'status' => 'new', 'createdAt' => $now]], 201);
    }

    public function newsletter(Request $request, array $params, ?AuthContext $context): Response
    {
        $input = $request->json();
        Validator::requireValid($input, ['email' => 'required|string|email|max:191']);
        $email = Security::normalizeEmail((string) $input['email']);
        $now = Security::now();
        $existing = $this->database->fetchOne('SELECT id FROM newsletter_subscribers WHERE email = ?', [$email]);
        if ($existing === null) {
            $this->database->execute(
                'INSERT INTO newsletter_subscribers (public_id, email, status, source, subscribed_at, unsubscribed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [Security::uuid(), $email, 'subscribed', 'storefront', $now, null, $now],
            );
        } else {
            $this->database->execute("UPDATE newsletter_subscribers SET status = 'subscribed', unsubscribed_at = NULL, updated_at = ? WHERE id = ?", [$now, $existing['id']]);
        }

        return Response::success(['subscribed' => true, 'email' => $email]);
    }
}

final class AdminController
{
    public function __construct(
        private readonly Database $database,
        private readonly StoreRepository $store,
        private readonly OrderService $orders,
        private readonly UploadService $uploads,
        private readonly Auth $auth,
        private readonly AuditLogger $audit,
    ) {
    }

    public function dashboard(Request $request, array $params, ?AuthContext $context): Response
    {
        $revenue = $this->database->fetchOne("SELECT COALESCE(SUM(total_cents), 0) AS aggregate, COUNT(*) AS order_count FROM orders WHERE payment_status = 'confirmed' AND deleted_at IS NULL");
        $units = $this->database->fetchOne("SELECT COALESCE(SUM(oi.quantity), 0) AS aggregate FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.payment_status = 'confirmed' AND o.deleted_at IS NULL");
        $customers = $this->database->fetchOne("SELECT COUNT(*) AS aggregate FROM users WHERE role = 'customer' AND status = 'active'");
        $enquiries = $this->database->fetchOne("SELECT COUNT(*) AS aggregate FROM enquiries WHERE status <> 'closed'");
        $paidOrders = (int) ($revenue['order_count'] ?? 0);
        $revenueMyr = ((int) ($revenue['aggregate'] ?? 0)) / 100;
        $recent = array_slice($this->orders->allOrders(), 0, 5);

        return Response::success(['dashboard' => [
            'revenue' => $revenueMyr,
            'paidOrders' => $paidOrders,
            'averageOrderValue' => $paidOrders > 0 ? $revenueMyr / $paidOrders : 0.0,
            'unitsSold' => (int) ($units['aggregate'] ?? 0),
            'customerCount' => (int) ($customers['aggregate'] ?? 0),
            'openEnquiries' => (int) ($enquiries['aggregate'] ?? 0),
            'recentOrders' => $recent,
        ]]);
    }

    public function settings(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['settings' => $this->store->settings(false)]);
    }

    public function updateSettings(Request $request, array $params, ?AuthContext $context): Response
    {
        $input = $request->json();
        $allowed = ['storeName', 'supportEmail', 'whatsappDisplay', 'whatsappNumber', 'instagramHandle', 'instagramUrl', 'facebookUrl', 'announcement', 'shippingThreshold', 'shippingFee', 'currency', 'country'];
        $unknown = array_diff(array_keys($input), $allowed);
        if ($unknown !== []) {
            throw new ApiException('VALIDATION_FAILED', 'One or more settings are not supported.', 422, ['settings' => 'Unsupported: ' . implode(', ', $unknown)]);
        }
        Validator::requireValid($input, [
            'storeName' => 'sometimes|string|max:150', 'supportEmail' => 'sometimes|string|email|max:191', 'whatsappDisplay' => 'sometimes|string|max:40',
            'whatsappNumber' => 'sometimes|string|max:30', 'instagramHandle' => 'sometimes|string|max:80', 'instagramUrl' => 'sometimes|string|max:500',
            'facebookUrl' => 'sometimes|string|max:500', 'announcement' => 'sometimes|string|max:255', 'shippingThreshold' => 'sometimes|numeric',
            'shippingFee' => 'sometimes|numeric', 'currency' => 'sometimes|string|max:3', 'country' => 'sometimes|string|max:100',
        ]);
        if (isset($input['whatsappNumber']) && !preg_match('/^\d{8,20}$/', (string) $input['whatsappNumber'])) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['whatsappNumber' => 'Use digits only, including country code.']);
        }
        foreach (['instagramUrl', 'facebookUrl'] as $urlField) {
            if (isset($input[$urlField]) && $input[$urlField] !== '') {
                $expectedHost = $urlField === 'instagramUrl' ? 'instagram.com' : 'facebook.com';
                $this->assertSafeHttpsUrl((string) $input[$urlField], $urlField, $expectedHost);
            }
        }
        foreach (['shippingThreshold', 'shippingFee'] as $moneyField) {
            if (isset($input[$moneyField]) && (!is_numeric($input[$moneyField]) || (float) $input[$moneyField] < 0)) {
                throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, [$moneyField => 'Enter a non-negative amount.']);
            }
        }
        if (isset($input['currency'])) {
            $input['currency'] = strtoupper((string) $input['currency']);
        }
        $before = $this->store->settings(false);
        $now = Security::now();
        $this->database->transaction(function () use ($input, $context, $now): void {
            foreach ($input as $key => $value) {
                $updated = $this->database->execute('UPDATE settings SET value_json = ?, is_public = 1, updated_by = ?, updated_at = ? WHERE setting_key = ?', [Security::jsonEncode($value), $context?->userId(), $now, $key]);
                if ($updated === 0) {
                    $this->database->execute('INSERT INTO settings (setting_key, value_json, is_public, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [$key, Security::jsonEncode($value), 1, $context?->userId(), $now, $now]);
                }
            }
        });
        $after = $this->store->settings(false);
        $this->audit->log($context, $request, 'settings.updated', 'settings', 'store', $before, $after);

        return Response::success(['settings' => $after]);
    }

    public function products(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['products' => $this->store->products(false)]);
    }

    public function product(Request $request, array $params, ?AuthContext $context): Response
    {
        $product = $this->store->findProduct($params['id']);
        if ($product === null) {
            throw new ApiException('PRODUCT_NOT_FOUND', 'The product was not found.', 404);
        }
        return Response::success(['product' => $product]);
    }

    public function createProduct(Request $request, array $params, ?AuthContext $context): Response
    {
        $input = $request->json();
        if (!isset($input['id'])) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['id' => 'A product ID is required.']);
        }
        $id = Validator::slug((string) $input['id']);
        if ($this->database->fetchOne('SELECT id FROM products WHERE id = ?', [$id]) !== null) {
            throw new ApiException('PRODUCT_EXISTS', 'A product with this ID already exists.', 409);
        }
        $product = $this->saveProduct($id, $input, true, $context, $request);

        return Response::success(['product' => $product], 201);
    }

    public function updateProduct(Request $request, array $params, ?AuthContext $context): Response
    {
        $id = Validator::slug($params['id']);
        $existing = $this->store->findProduct($id);
        if ($existing === null) {
            throw new ApiException('PRODUCT_NOT_FOUND', 'The product was not found.', 404);
        }
        $changes = $request->json();
        $stockWasProvided = array_key_exists('stock', $changes);
        if ($stockWasProvided && !array_key_exists('expectedStock', $changes)) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['expectedStock' => 'Send the stock value on which this edit was based.']);
        }
        $product = $this->saveProduct($id, array_replace($existing, $changes), false, $context, $request, $stockWasProvided);

        return Response::success(['product' => $product]);
    }

    public function deleteProduct(Request $request, array $params, ?AuthContext $context): Response
    {
        $existing = $this->store->findProduct($params['id']);
        if ($existing === null) {
            throw new ApiException('PRODUCT_NOT_FOUND', 'The product was not found.', 404);
        }
        $this->database->execute("UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?", [Security::now(), $params['id']]);
        $this->audit->log($context, $request, 'product.archived', 'product', $params['id'], $existing, ['active' => false]);

        return Response::success(['id' => $params['id'], 'deleted' => true]);
    }

    public function slides(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['slides' => $this->store->slides(false)]);
    }

    public function slide(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->database->fetchOne('SELECT * FROM slides WHERE id = ?', [$params['id']]);
        if ($raw === null) {
            throw new ApiException('SLIDE_NOT_FOUND', 'The slider was not found.', 404);
        }
        return Response::success(['slide' => $this->store->slide($raw)]);
    }

    public function createSlide(Request $request, array $params, ?AuthContext $context): Response
    {
        $input = $request->json();
        $id = isset($input['id']) && $input['id'] !== '' ? Validator::slug((string) $input['id']) : 'slide-' . substr(str_replace('-', '', Security::uuid()), 0, 12);
        if ($this->database->fetchOne('SELECT id FROM slides WHERE id = ?', [$id]) !== null) {
            throw new ApiException('SLIDE_EXISTS', 'A slider with this ID already exists.', 409);
        }
        $slide = $this->saveSlide($id, $input, true, $context, $request);
        return Response::success(['slide' => $slide], 201);
    }

    public function updateSlide(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->database->fetchOne('SELECT * FROM slides WHERE id = ?', [$params['id']]);
        if ($raw === null) {
            throw new ApiException('SLIDE_NOT_FOUND', 'The slider was not found.', 404);
        }
        $existing = $this->store->slide($raw);
        $slide = $this->saveSlide($params['id'], array_replace($existing, $request->json()), false, $context, $request);
        return Response::success(['slide' => $slide]);
    }

    public function deleteSlide(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->database->fetchOne('SELECT * FROM slides WHERE id = ?', [$params['id']]);
        if ($raw === null) {
            throw new ApiException('SLIDE_NOT_FOUND', 'The slider was not found.', 404);
        }
        $before = $this->store->slide($raw);
        $this->database->execute('DELETE FROM slides WHERE id = ?', [$params['id']]);
        $this->audit->log($context, $request, 'slide.deleted', 'slide', $params['id'], $before, null);
        return Response::success(['id' => $params['id'], 'deleted' => true]);
    }

    public function bundles(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['bundles' => $this->store->bundles(false)]);
    }

    public function bundle(Request $request, array $params, ?AuthContext $context): Response
    {
        $bundle = $this->store->findBundle($params['id']);
        if ($bundle === null) {
            throw new ApiException('BUNDLE_NOT_FOUND', 'The bundle was not found.', 404);
        }
        return Response::success(['bundle' => $bundle]);
    }

    public function createBundle(Request $request, array $params, ?AuthContext $context): Response
    {
        $input = $request->json();
        $id = Validator::slug((string) ($input['id'] ?? ''), 'id');
        if ($this->store->findBundle($id) !== null) {
            throw new ApiException('BUNDLE_EXISTS', 'A bundle with this ID already exists.', 409);
        }
        $bundle = $this->saveBundle($id, $input, true, $context, $request);
        return Response::success(['bundle' => $bundle], 201);
    }

    public function updateBundle(Request $request, array $params, ?AuthContext $context): Response
    {
        $existing = $this->store->findBundle($params['id']);
        if ($existing === null) {
            throw new ApiException('BUNDLE_NOT_FOUND', 'The bundle was not found.', 404);
        }
        $bundle = $this->saveBundle($params['id'], array_replace($existing, $request->json()), false, $context, $request);
        return Response::success(['bundle' => $bundle]);
    }

    public function deleteBundle(Request $request, array $params, ?AuthContext $context): Response
    {
        $existing = $this->store->findBundle($params['id']);
        if ($existing === null) {
            throw new ApiException('BUNDLE_NOT_FOUND', 'The bundle was not found.', 404);
        }
        $this->database->execute('DELETE FROM bundles WHERE id = ?', [$params['id']]);
        $this->audit->log($context, $request, 'bundle.deleted', 'bundle', $params['id'], $existing, null);
        return Response::success(['id' => $params['id'], 'deleted' => true]);
    }

    public function promos(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['promos' => array_map([$this, 'mapPromo'], $this->database->fetchAll('SELECT * FROM promos ORDER BY created_at DESC, id DESC'))]);
    }

    public function promo(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findPromoRaw($params['id']);
        return Response::success(['promo' => $this->mapPromo($raw)]);
    }

    public function createPromo(Request $request, array $params, ?AuthContext $context): Response
    {
        $promo = $this->savePromo(null, $request->json(), true, $context, $request);
        return Response::success(['promo' => $promo], 201);
    }

    public function updatePromo(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findPromoRaw($params['id']);
        $promo = $this->savePromo((int) $raw['id'], array_replace($this->mapPromo($raw), $request->json()), false, $context, $request);
        return Response::success(['promo' => $promo]);
    }

    public function deletePromo(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findPromoRaw($params['id']);
        $before = $this->mapPromo($raw);
        $redemptions = $this->database->fetchOne('SELECT COUNT(*) AS aggregate FROM promo_redemptions WHERE promo_id = ?', [$raw['id']]);
        if ((int) ($redemptions['aggregate'] ?? 0) > 0) {
            $this->database->execute('UPDATE promos SET is_active = 0, updated_at = ? WHERE id = ?', [Security::now(), $raw['id']]);
        } else {
            $this->database->execute('DELETE FROM promos WHERE id = ?', [$raw['id']]);
        }
        $this->audit->log($context, $request, 'promo.deleted', 'promo', (string) $raw['public_id'], $before, null);
        return Response::success(['id' => (string) $raw['public_id'], 'deleted' => true]);
    }

    public function orders(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['orders' => $this->orders->allOrders()]);
    }

    public function order(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findOrderRaw($params['id']);
        return Response::success(['order' => $this->orders->getOrder((int) $raw['id'])]);
    }

    public function updateOrder(Request $request, array $params, ?AuthContext $context): Response
    {
        $input = $request->json();
        Validator::requireValid($input, [
            'status' => 'sometimes|string|in:pending_payment,payment_confirmed,processing,packing,shipped,delivered,cancelled',
            'paymentStatus' => 'sometimes|string|in:pending,confirmed,refunded', 'trackingNumber' => 'sometimes|nullable|string|max:120',
            'internalNote' => 'sometimes|nullable|string|max:5000',
        ]);
        $beforeRaw = $this->findOrderRaw($params['id']);
        $before = $this->orders->getOrder((int) $beforeRaw['id']);
        $this->orders->updateByAdmin((int) $beforeRaw['id'], $input, $context?->userId());
        $after = $this->orders->getOrder((int) $beforeRaw['id']);
        $this->audit->log($context, $request, 'order.updated', 'order', $params['id'], $before, $after);
        return Response::success(['order' => $after]);
    }

    public function deleteOrder(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findOrderRaw($params['id']);
        $before = $this->orders->getOrder((int) $raw['id']);
        $this->orders->archiveByAdmin((int) $raw['id'], $context?->userId());
        $this->audit->log($context, $request, 'order.archived', 'order', $params['id'], $before, null);
        return Response::success(['id' => $params['id'], 'deleted' => true]);
    }

    public function customers(Request $request, array $params, ?AuthContext $context): Response
    {
        $rows = $this->database->fetchAll(
            "SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id AND o.deleted_at IS NULL) AS order_count, " .
            "(SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o WHERE o.customer_id = u.id AND o.payment_status = 'confirmed' AND o.deleted_at IS NULL) AS total_spent_cents, " .
            "(SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = u.id AND o.deleted_at IS NULL) AS last_order_at " .
            "FROM users u WHERE u.role = 'customer' ORDER BY u.created_at DESC, u.id DESC LIMIT 1000",
        );
        return Response::success(['customers' => array_map([$this, 'mapCustomer'], $rows)]);
    }

    public function customer(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['customer' => $this->mapCustomer($this->findCustomerRaw($params['id']), true)]);
    }

    public function createCustomer(Request $request, array $params, ?AuthContext $context): Response
    {
        $input = $request->json();
        if (isset($input['fullName']) && (!isset($input['firstName']) || !isset($input['lastName']))) {
            $parts = preg_split('/\s+/', trim((string) $input['fullName']), 2) ?: [];
            $input['firstName'] = $parts[0] ?? '';
            $input['lastName'] = $parts[1] ?? '';
        }
        Validator::requireValid($input, [
            'email' => 'required|string|email|max:191', 'password' => 'required|string|min:8|max:200', 'firstName' => 'required|string|max:100',
            'lastName' => 'required|string|max:100', 'phone' => 'sometimes|nullable|string|max:40',
        ]);
        Validator::password((string) $input['password'], 8, false);
        $publicId = Security::uuid();
        $now = Security::now();
        try {
            $this->database->execute(
                'INSERT INTO users (public_id, role, username, email, password_hash, first_name, last_name, display_name, phone, date_of_birth, marketing_consent, status, must_change_password, email_verified_at, last_login_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$publicId, 'customer', null, Security::normalizeEmail((string) $input['email']), Security::passwordHash((string) $input['password']), trim((string) $input['firstName']), trim((string) $input['lastName']), $input['displayName'] ?? null, $input['phone'] ?? null, null, 0, 'active', 1, null, null, $now, $now],
            );
        } catch (PDOException $exception) {
            throw new ApiException('EMAIL_ALREADY_REGISTERED', 'An account already exists for this email address.', 409, ['email' => 'Use a unique email.'], $exception);
        }
        $customer = $this->mapCustomer($this->findCustomerRaw($publicId), true);
        $this->audit->log($context, $request, 'customer.created', 'user', $publicId, null, $customer);
        return Response::success(['customer' => $customer], 201);
    }

    public function updateCustomer(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findCustomerRaw($params['id']);
        $input = $request->json();
        if (isset($input['fullName']) && (!isset($input['firstName']) || !isset($input['lastName']))) {
            $parts = preg_split('/\s+/', trim((string) $input['fullName']), 2) ?: [];
            $input['firstName'] = $parts[0] ?? '';
            $input['lastName'] = $parts[1] ?? '';
        }
        Validator::requireValid($input, [
            'firstName' => 'sometimes|string|max:100', 'lastName' => 'sometimes|string|max:100', 'phone' => 'sometimes|nullable|string|max:40',
            'status' => 'sometimes|string|in:active,disabled', 'marketingConsent' => 'sometimes|bool',
        ]);
        $before = $this->mapCustomer($raw, true);
        $this->database->execute(
            'UPDATE users SET first_name = ?, last_name = ?, phone = ?, status = ?, marketing_consent = ?, updated_at = ? WHERE id = ?',
            [$input['firstName'] ?? $raw['first_name'], $input['lastName'] ?? $raw['last_name'], array_key_exists('phone', $input) ? ($input['phone'] ?: null) : $raw['phone'], $input['status'] ?? $raw['status'], array_key_exists('marketingConsent', $input) ? (!empty($input['marketingConsent']) ? 1 : 0) : $raw['marketing_consent'], Security::now(), $raw['id']],
        );
        if (($input['status'] ?? null) === 'disabled') {
            $this->database->execute('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Security::now(), $raw['id']]);
        }
        $after = $this->mapCustomer($this->findCustomerRaw($params['id']), true);
        $this->audit->log($context, $request, 'customer.updated', 'user', $params['id'], $before, $after);
        return Response::success(['customer' => $after]);
    }

    public function deleteCustomer(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findCustomerRaw($params['id']);
        $before = $this->mapCustomer($raw, true);
        $this->database->transaction(function () use ($raw): void {
            $this->database->execute("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?", [Security::now(), $raw['id']]);
            $this->database->execute('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Security::now(), $raw['id']]);
        });
        $this->audit->log($context, $request, 'customer.disabled', 'user', $params['id'], $before, ['status' => 'disabled']);
        return Response::success(['id' => $params['id'], 'deleted' => true]);
    }

    public function enquiries(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['enquiries' => array_map([$this, 'mapEnquiry'], $this->database->fetchAll('SELECT * FROM enquiries ORDER BY created_at DESC, id DESC LIMIT 1000'))]);
    }

    public function enquiry(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['enquiry' => $this->mapEnquiry($this->findEnquiryRaw($params['id']))]);
    }

    public function updateEnquiry(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findEnquiryRaw($params['id']);
        $input = $request->json();
        Validator::requireValid($input, ['status' => 'sometimes|string|in:new,open,replied,closed', 'adminNotes' => 'sometimes|nullable|string|max:10000']);
        $before = $this->mapEnquiry($raw);
        $this->database->execute('UPDATE enquiries SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?', [$input['status'] ?? $raw['status'], array_key_exists('adminNotes', $input) ? ($input['adminNotes'] ?: null) : $raw['admin_notes'], Security::now(), $raw['id']]);
        $after = $this->mapEnquiry($this->findEnquiryRaw($params['id']));
        $this->audit->log($context, $request, 'enquiry.updated', 'enquiry', $params['id'], $before, $after);
        return Response::success(['enquiry' => $after]);
    }

    public function replyEnquiry(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findEnquiryRaw($params['id']);
        $input = $request->json();
        Validator::requireValid($input, ['message' => 'required|string|min:1|max:5000']);
        $replyId = Security::uuid();
        $now = Security::now();
        $this->database->transaction(function () use ($raw, $input, $context, $replyId, $now): void {
            $this->database->execute('INSERT INTO enquiry_replies (public_id, enquiry_id, author_user_id, message, created_at) VALUES (?, ?, ?, ?, ?)', [$replyId, $raw['id'], $context?->userId(), trim((string) $input['message']), $now]);
            $this->database->execute("UPDATE enquiries SET status = 'replied', updated_at = ? WHERE id = ?", [$now, $raw['id']]);
        });
        $after = $this->mapEnquiry($this->findEnquiryRaw($params['id']));
        $this->audit->log($context, $request, 'enquiry.replied', 'enquiry', $params['id'], null, ['replyId' => $replyId]);
        return Response::success(['enquiry' => $after], 201);
    }

    public function deleteEnquiry(Request $request, array $params, ?AuthContext $context): Response
    {
        $raw = $this->findEnquiryRaw($params['id']);
        $before = $this->mapEnquiry($raw);
        $this->database->execute('DELETE FROM enquiries WHERE id = ?', [$raw['id']]);
        $this->audit->log($context, $request, 'enquiry.deleted', 'enquiry', $params['id'], $before, null);
        return Response::success(['id' => $params['id'], 'deleted' => true]);
    }

    public function uploads(Request $request, array $params, ?AuthContext $context): Response
    {
        return Response::success(['uploads' => $this->uploads->all()]);
    }

    public function createUpload(Request $request, array $params, ?AuthContext $context): Response
    {
        $file = $request->file('file') ?? $request->file('image');
        if ($file === null || $context?->userId() === null) {
            throw new ApiException('UPLOAD_REQUIRED', 'Choose an image to upload.', 422);
        }
        $media = $this->uploads->store($file, (int) $context->userId());
        $this->audit->log($context, $request, 'upload.created', 'upload', (string) $media['id'], null, ['url' => $media['url'], 'mimeType' => $media['mimeType']]);
        return Response::success(['media' => $media, 'url' => $media['url']], 201);
    }

    public function deleteUpload(Request $request, array $params, ?AuthContext $context): Response
    {
        $result = $this->uploads->delete($params['id']);
        $this->audit->log($context, $request, 'upload.deleted', 'upload', $params['id'], null, ['deleted' => true]);
        return Response::success($result);
    }

    public function auditLogs(Request $request, array $params, ?AuthContext $context): Response
    {
        $rows = $this->database->fetchAll(
            'SELECT a.*, u.username, u.email, u.first_name, u.last_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC, a.id DESC LIMIT 1000',
        );
        $logs = array_map(static fn (array $row): array => [
            'id' => (string) $row['id'], 'action' => (string) $row['action_name'], 'entityType' => (string) $row['entity_type'],
            'entityId' => $row['entity_id'], 'before' => Security::jsonDecode($row['before_json'] ?? null), 'after' => Security::jsonDecode($row['after_json'] ?? null),
            'actor' => $row['actor_user_id'] === null ? null : ['username' => $row['username'], 'email' => $row['email'], 'fullName' => trim((string) $row['first_name'] . ' ' . (string) $row['last_name'])],
            'createdAt' => (string) $row['created_at'],
        ], $rows);
        return Response::success(['auditLogs' => $logs]);
    }

    /** @return array<string,mixed> */
    private function findOrderRaw(string $publicId): array
    {
        $raw = $this->database->fetchOne('SELECT * FROM orders WHERE public_id = ? AND deleted_at IS NULL', [$publicId]);
        if ($raw === null) {
            throw new ApiException('ORDER_NOT_FOUND', 'The order was not found.', 404);
        }
        return $raw;
    }

    /** @return array<string,mixed> */
    private function findCustomerRaw(string $publicId): array
    {
        $raw = $this->database->fetchOne(
            "SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id AND o.deleted_at IS NULL) AS order_count, " .
            "(SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o WHERE o.customer_id = u.id AND o.payment_status = 'confirmed' AND o.deleted_at IS NULL) AS total_spent_cents, " .
            "(SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = u.id AND o.deleted_at IS NULL) AS last_order_at " .
            "FROM users u WHERE u.public_id = ? AND u.role = 'customer'",
            [$publicId],
        );
        if ($raw === null) {
            throw new ApiException('CUSTOMER_NOT_FOUND', 'The customer was not found.', 404);
        }
        return $raw;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function mapCustomer(array $row, bool $withAddresses = false): array
    {
        $customer = array_merge($this->auth->publicUser($row), [
            'status' => (string) $row['status'], 'orderCount' => (int) ($row['order_count'] ?? 0),
            'totalSpent' => ((int) ($row['total_spent_cents'] ?? 0)) / 100, 'lastOrderAt' => $row['last_order_at'] ?? null,
        ]);
        if ($withAddresses) {
            $customer['addresses'] = array_map(static fn (array $address): array => [
                'id' => (string) $address['public_id'], 'label' => (string) $address['label'], 'recipientName' => (string) $address['recipient_name'],
                'phone' => (string) $address['phone'], 'line1' => (string) $address['line1'], 'line2' => $address['line2'], 'city' => (string) $address['city'],
                'postcode' => (string) $address['postcode'], 'state' => (string) $address['state'], 'country' => $address['country_code'] === 'MY' ? 'Malaysia' : (string) $address['country_code'],
                'isDefault' => (bool) $address['is_default_shipping'],
            ], $this->database->fetchAll('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default_shipping DESC, created_at', [$row['id']]));
        }
        return $customer;
    }

    /** @return array<string,mixed> */
    private function findEnquiryRaw(string $publicId): array
    {
        $raw = $this->database->fetchOne('SELECT * FROM enquiries WHERE public_id = ?', [$publicId]);
        if ($raw === null) {
            throw new ApiException('ENQUIRY_NOT_FOUND', 'The enquiry was not found.', 404);
        }
        return $raw;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function mapEnquiry(array $row): array
    {
        $replies = $this->database->fetchAll(
            'SELECT r.*, u.first_name, u.last_name, u.username FROM enquiry_replies r JOIN users u ON u.id = r.author_user_id WHERE r.enquiry_id = ? ORDER BY r.created_at, r.id',
            [$row['id']],
        );
        return [
            'id' => (string) $row['public_id'], 'name' => (string) $row['name'], 'email' => (string) $row['email'], 'phone' => $row['phone'],
            'channel' => (string) $row['channel'], 'subject' => (string) $row['subject'], 'message' => (string) $row['message'],
            'status' => (string) $row['status'], 'adminNotes' => $row['admin_notes'], 'createdAt' => (string) $row['created_at'], 'updatedAt' => (string) $row['updated_at'],
            'replies' => array_map(static fn (array $reply): array => [
                'id' => (string) $reply['public_id'], 'message' => (string) $reply['message'], 'createdAt' => (string) $reply['created_at'],
                'author' => trim((string) $reply['first_name'] . ' ' . (string) $reply['last_name']) ?: (string) $reply['username'],
            ], $replies),
        ];
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private function saveBundle(string $id, array $input, bool $creating, ?AuthContext $context, Request $request): array
    {
        Validator::requireValid($input, [
            'name' => 'required|string|max:180', 'title' => 'sometimes|nullable|string|max:255', 'description' => 'required|string|max:5000',
            'active' => 'sometimes|bool', 'discountType' => 'sometimes|string|in:none,fixed,percentage',
            'discountValue' => 'sometimes|numeric', 'steps' => 'required|array',
        ]);
        $discountType = (string) ($input['discountType'] ?? 'none');
        $discountValue = (float) ($input['discountValue'] ?? 0);
        if ($discountValue < 0 || ($discountType === 'percentage' && $discountValue > 100)) {
            throw new ApiException('VALIDATION_FAILED', 'Enter a valid set saving value.', 422, ['discountValue' => $discountType === 'percentage' ? 'Enter 0–100%.' : 'Enter a non-negative amount.']);
        }
        $pricingMode = match ($discountType) {
            'fixed' => 'fixed_discount',
            'percentage' => 'percentage_discount',
            default => 'sum',
        };
        $priceValueCents = $discountType === 'none' ? null : (int) round($discountValue * 100);
        if (count($input['steps']) < 1 || count($input['steps']) > 10) {
            throw new ApiException('VALIDATION_FAILED', 'A bundle needs between 1 and 10 steps.', 422, ['steps' => 'Add 1–10 steps.']);
        }
        $steps = [];
        foreach (array_values($input['steps']) as $index => $step) {
            if (!is_array($step)) {
                throw new ApiException('VALIDATION_FAILED', 'Each bundle step must be an object.', 422, ['steps.' . $index => 'Invalid step.']);
            }
            Validator::requireValid($step, [
                'id' => 'required|string|max:64', 'label' => 'required|string|max:180', 'description' => 'sometimes|nullable|string|max:255',
                'productIds' => 'required|array', 'minSelections' => 'sometimes|numeric', 'maxSelections' => 'sometimes|numeric', 'sortOrder' => 'sometimes|numeric',
            ]);
            $stepId = Validator::slug((string) $step['id'], 'steps.' . $index . '.id');
            $productIds = array_values(array_unique(array_map('strval', $step['productIds'])));
            if ($productIds === []) {
                throw new ApiException('VALIDATION_FAILED', 'Each bundle step needs at least one product.', 422, ['steps.' . $index . '.productIds' => 'Choose at least one product.']);
            }
            $min = max(0, (int) ($step['minSelections'] ?? 1));
            $max = max(1, (int) ($step['maxSelections'] ?? 1));
            if ($min > $max || $max > count($productIds)) {
                throw new ApiException('VALIDATION_FAILED', 'Bundle selection limits are invalid.', 422, ['steps.' . $index => 'Check minimum and maximum selections.']);
            }
            foreach ($productIds as $productId) {
                if ($this->database->fetchOne('SELECT id FROM products WHERE id = ?', [$productId]) === null) {
                    throw new ApiException('VALIDATION_FAILED', 'A bundle option references an unknown product.', 422, ['steps.' . $index . '.productIds' => 'Unknown product: ' . $productId]);
                }
            }
            $steps[] = [
                'id' => $stepId, 'label' => trim((string) $step['label']), 'description' => $step['description'] ?? null,
                'productIds' => $productIds, 'minSelections' => $min, 'maxSelections' => $max, 'sortOrder' => (int) ($step['sortOrder'] ?? $index),
            ];
        }
        $before = $this->store->findBundle($id);
        $now = Security::now();
        $this->database->transaction(function () use ($id, $input, $steps, $creating, $now, $pricingMode, $priceValueCents): void {
            if ($creating) {
                $this->database->execute(
                    'INSERT INTO bundles (id, name, title, description, pricing_mode, fixed_price_cents, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$id, trim((string) $input['name']), $input['title'] ?? null, trim((string) $input['description']), $pricingMode, $priceValueCents, 0, !array_key_exists('active', $input) || !empty($input['active']) ? 1 : 0, $now, $now],
                );
            } else {
                $this->database->execute(
                    'UPDATE bundles SET name = ?, title = ?, description = ?, pricing_mode = ?, fixed_price_cents = ?, is_active = ?, updated_at = ? WHERE id = ?',
                    [trim((string) $input['name']), $input['title'] ?? null, trim((string) $input['description']), $pricingMode, $priceValueCents, !array_key_exists('active', $input) || !empty($input['active']) ? 1 : 0, $now, $id],
                );
                $this->database->execute('DELETE FROM bundle_step_products WHERE step_id IN (SELECT id FROM bundle_steps WHERE bundle_id = ?)', [$id]);
                $this->database->execute('DELETE FROM bundle_steps WHERE bundle_id = ?', [$id]);
            }
            foreach ($steps as $step) {
                $this->database->execute(
                    'INSERT INTO bundle_steps (id, bundle_id, name, prompt_text, min_select, max_select, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [$step['id'], $id, $step['label'], $step['description'], $step['minSelections'], $step['maxSelections'], $step['sortOrder']],
                );
                foreach ($step['productIds'] as $optionSort => $productId) {
                    $this->database->execute(
                        'INSERT INTO bundle_step_products (step_id, product_id, price_adjustment_cents, is_default, sort_order) VALUES (?, ?, ?, ?, ?)',
                        [$step['id'], $productId, 0, $optionSort === 0 ? 1 : 0, $optionSort],
                    );
                }
            }
        });
        $after = $this->store->findBundle($id) ?? [];
        $this->audit->log($context, $request, $creating ? 'bundle.created' : 'bundle.updated', 'bundle', $id, $before, $after);
        return $after;
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private function savePromo(?int $internalId, array $input, bool $creating, ?AuthContext $context, Request $request): array
    {
        Validator::requireValid($input, [
            'code' => 'required|string|max:64', 'description' => 'required|string|max:255', 'type' => 'required|string|in:percentage,fixed,free_shipping',
            'value' => 'required|numeric', 'minimumSpend' => 'sometimes|numeric', 'maximumDiscount' => 'sometimes|nullable|numeric',
            'active' => 'sometimes|bool', 'startsAt' => 'sometimes|nullable|string|max:30', 'endsAt' => 'sometimes|nullable|string|max:30',
            'usageLimit' => 'sometimes|nullable|numeric', 'perCustomerLimit' => 'sometimes|nullable|numeric',
        ]);
        $code = strtoupper(trim((string) $input['code']));
        if (!preg_match('/^[A-Z0-9_-]{3,64}$/', $code)) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['code' => 'Use 3–64 uppercase letters, numbers, underscores or hyphens.']);
        }
        $type = (string) $input['type'];
        $value = $type === 'percentage' ? (int) round(((float) $input['value']) * 100) : Validator::moneyToCents($input['value'], 'value');
        if ($type === 'percentage' && ($value < 1 || $value > 10000)) {
            throw new ApiException('VALIDATION_FAILED', 'Percentage offers must be greater than 0 and no more than 100.', 422, ['value' => 'Enter 0.01–100.']);
        }
        $minimum = Validator::moneyToCents($input['minimumSpend'] ?? 0, 'minimumSpend');
        $maximum = isset($input['maximumDiscount']) && (float) $input['maximumDiscount'] > 0 ? Validator::moneyToCents($input['maximumDiscount'], 'maximumDiscount') : null;
        $starts = $this->normalizeDate($input['startsAt'] ?? null, 'startsAt');
        $ends = $this->normalizeDate($input['endsAt'] ?? null, 'endsAt');
        if ($starts !== null && $ends !== null && $ends <= $starts) {
            throw new ApiException('VALIDATION_FAILED', 'The ending date must follow the starting date.', 422, ['endsAt' => 'Choose a later date.']);
        }
        $beforeRaw = $internalId === null ? null : $this->database->fetchOne('SELECT * FROM promos WHERE id = ?', [$internalId]);
        $before = $beforeRaw === null ? null : $this->mapPromo($beforeRaw);
        $now = Security::now();
        try {
            if ($creating) {
                $this->database->execute(
                    'INSERT INTO promos (public_id, code, description, discount_type, value_int, minimum_subtotal_cents, max_discount_cents, starts_at, ends_at, usage_limit, per_customer_limit, use_count, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [Security::uuid(), $code, trim((string) $input['description']), $type, $value, $minimum, $maximum, $starts, $ends, $input['usageLimit'] ?? null, $input['perCustomerLimit'] ?? null, 0, !array_key_exists('active', $input) || !empty($input['active']) ? 1 : 0, $now, $now],
                );
                $internalId = $this->database->lastInsertId();
            } else {
                $this->database->execute(
                    'UPDATE promos SET code = ?, description = ?, discount_type = ?, value_int = ?, minimum_subtotal_cents = ?, max_discount_cents = ?, starts_at = ?, ends_at = ?, usage_limit = ?, per_customer_limit = ?, is_active = ?, updated_at = ? WHERE id = ?',
                    [$code, trim((string) $input['description']), $type, $value, $minimum, $maximum, $starts, $ends, $input['usageLimit'] ?? null, $input['perCustomerLimit'] ?? null, !array_key_exists('active', $input) || !empty($input['active']) ? 1 : 0, $now, $internalId],
                );
            }
        } catch (PDOException $exception) {
            throw new ApiException('PROMO_CODE_EXISTS', 'That promo code already exists.', 409, ['code' => 'Choose a unique code.'], $exception);
        }
        $raw = $this->database->fetchOne('SELECT * FROM promos WHERE id = ?', [$internalId]);
        $after = $this->mapPromo($raw ?? []);
        $this->audit->log($context, $request, $creating ? 'promo.created' : 'promo.updated', 'promo', (string) ($after['id'] ?? ''), $before, $after);
        return $after;
    }

    /** @return array<string,mixed> */
    private function findPromoRaw(string $publicId): array
    {
        $raw = $this->database->fetchOne('SELECT * FROM promos WHERE public_id = ?', [$publicId]);
        if ($raw === null) {
            throw new ApiException('PROMO_NOT_FOUND', 'The promo code was not found.', 404);
        }
        return $raw;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    public function mapPromo(array $row): array
    {
        $type = (string) ($row['discount_type'] ?? 'fixed');
        return [
            'id' => (string) ($row['public_id'] ?? ''), 'code' => (string) ($row['code'] ?? ''), 'description' => (string) ($row['description'] ?? ''),
            'type' => $type, 'value' => $type === 'percentage' ? ((int) ($row['value_int'] ?? 0)) / 100 : ((int) ($row['value_int'] ?? 0)) / 100,
            'minimumSpend' => ((int) ($row['minimum_subtotal_cents'] ?? 0)) / 100,
            'maximumDiscount' => $row['max_discount_cents'] === null ? null : ((int) $row['max_discount_cents']) / 100,
            'active' => (bool) ($row['is_active'] ?? false), 'startsAt' => $row['starts_at'] ?? null, 'endsAt' => $row['ends_at'] ?? null,
            'usageCount' => (int) ($row['use_count'] ?? 0), 'usageLimit' => $row['usage_limit'] === null ? null : (int) $row['usage_limit'],
            'perCustomerLimit' => $row['per_customer_limit'] === null ? null : (int) $row['per_customer_limit'],
        ];
    }

    private function normalizeDate(mixed $value, string $field): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $timestamp = strtotime((string) $value);
        if ($timestamp === false) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, [$field => 'Enter a valid date and time.']);
        }
        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private function saveProduct(string $id, array $input, bool $creating, ?AuthContext $context, Request $request, bool $stockWasProvided = true): array
    {
        Validator::requireValid($input, [
            'name' => 'required|string|max:180', 'shortName' => 'required|string|max:100', 'price' => 'required|numeric', 'stock' => 'required|numeric',
            'badge' => 'required|string|max:120', 'description' => 'required|string|max:5000', 'detail' => 'required|string|max:10000',
            'ingredients' => 'required|string|max:10000', 'ritual' => 'required|string|max:5000', 'volume' => 'required|string|max:160',
            'image' => 'required|string|max:500', 'editorial' => 'required|string|max:500', 'editorialPosition' => 'sometimes|nullable|string|max:80',
            'texture' => 'required|string|max:5000', 'benefits' => 'required|array', 'storyImages' => 'required|array', 'active' => 'sometimes|bool', 'sortOrder' => 'sometimes|numeric',
            'expectedStock' => 'sometimes|numeric',
        ]);
        $price = Validator::moneyToCents($input['price'], 'price');
        if (filter_var($input['stock'], FILTER_VALIDATE_INT) === false) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['stock' => 'Enter a whole-number stock quantity.']);
        }
        $stock = (int) $input['stock'];
        if ($stock < 0 || $stock > 1000000) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['stock' => 'Enter stock between 0 and 1,000,000.']);
        }
        $expectedStock = null;
        if (!$creating && $stockWasProvided) {
            if (filter_var($input['expectedStock'], FILTER_VALIDATE_INT) === false || (int) $input['expectedStock'] < 0 || (int) $input['expectedStock'] > 1000000) {
                throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['expectedStock' => 'Enter the whole-number stock value on which this edit was based.']);
            }
            $expectedStock = (int) $input['expectedStock'];
        }
        if (count($input['benefits']) > 30 || count($input['storyImages']) > 30) {
            throw new ApiException('VALIDATION_FAILED', 'Too many product story entries.', 422);
        }
        foreach ($input['benefits'] as $index => $benefit) {
            if (!is_string($benefit) || mb_strlen($benefit) > 300) {
                throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['benefits.' . $index => 'Use a short text benefit.']);
            }
        }
        $this->assertSafeImageUrl((string) $input['image'], 'image');
        $this->assertSafeImageUrl((string) $input['editorial'], 'editorial');
        foreach ($input['storyImages'] as $index => $story) {
            if (!is_array($story)) {
                throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['storyImages.' . $index => 'Each story image must be an object.']);
            }
            Validator::requireValid($story, [
                'image' => 'required|string|max:500', 'alt' => 'required|string|max:500', 'eyebrow' => 'sometimes|nullable|string|max:180',
                'title' => 'sometimes|nullable|string|max:300', 'copy' => 'sometimes|nullable|string|max:3000',
            ]);
            $this->assertSafeImageUrl((string) $story['image'], 'storyImages.' . $index . '.image');
        }
        $before = $this->store->findProduct($id);
        $now = Security::now();
        try {
            $this->database->transaction(function () use ($id, $input, $creating, $price, $stock, $stockWasProvided, $expectedStock, $context, $now): void {
                $currentStock = 0;
                $effectiveStock = $stock;
                if (!$creating) {
                    $sql = 'SELECT stock_quantity FROM products WHERE id = ?';
                    if ($this->database->isMysql()) {
                        $sql .= ' FOR UPDATE';
                    }
                    $locked = $this->database->fetchOne($sql, [$id]);
                    if ($locked === null) {
                        throw new ApiException('PRODUCT_NOT_FOUND', 'The product was not found.', 404);
                    }
                    $currentStock = (int) $locked['stock_quantity'];
                    if ($stockWasProvided && $currentStock !== $expectedStock) {
                        throw new ApiException('INVENTORY_CHANGED', 'Inventory changed while this product was being edited. Reload and try again.', 409, ['stock' => 'Current stock is ' . $currentStock . '.']);
                    }
                    if (!$stockWasProvided) {
                        $effectiveStock = $currentStock;
                    }
                }
                $values = [
                    $id, $input['sku'] ?? null, trim((string) $input['name']), trim((string) $input['shortName']), $price, $effectiveStock,
                    !array_key_exists('active', $input) || !empty($input['active']) ? 'active' : 'inactive', trim((string) $input['badge']), trim((string) $input['description']),
                    trim((string) $input['detail']), trim((string) $input['ingredients']), trim((string) $input['ritual']), trim((string) $input['volume']),
                    trim((string) $input['image']), trim((string) $input['editorial']), $input['editorialPosition'] ?? null, trim((string) $input['texture']),
                    Security::jsonEncode(array_values($input['benefits'])), Security::jsonEncode(array_values($input['storyImages'])), (int) ($input['sortOrder'] ?? 0),
                ];
                if ($creating) {
                    $this->database->execute(
                        'INSERT INTO products (id, sku, name, short_name, price_cents, stock_quantity, status, badge, description, detail, ingredients, ritual, volume, image_url, editorial_url, editorial_position, texture, benefits_json, story_images_json, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        array_merge($values, [$now, $now]),
                    );
                } else {
                    $this->database->execute(
                        'UPDATE products SET sku = ?, name = ?, short_name = ?, price_cents = ?, stock_quantity = ?, status = ?, badge = ?, description = ?, detail = ?, ingredients = ?, ritual = ?, volume = ?, image_url = ?, editorial_url = ?, editorial_position = ?, texture = ?, benefits_json = ?, story_images_json = ?, sort_order = ?, updated_at = ? WHERE id = ?',
                        array_merge(array_slice($values, 1), [$now, $id]),
                    );
                }
                $adjustment = $effectiveStock - $currentStock;
                if ($adjustment !== 0) {
                    $this->database->execute(
                        'INSERT INTO inventory_movements (product_id, order_id, quantity_delta, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                        [$id, null, $adjustment, 'admin_adjustment', $context?->userId(), $now],
                    );
                }
            });
        } catch (PDOException $exception) {
            if ($creating && (string) $exception->getCode() === '23000') {
                throw new ApiException('PRODUCT_EXISTS', 'A product with this ID or SKU already exists.', 409, [], $exception);
            }
            throw $exception;
        }
        $after = $this->store->findProduct($id) ?? [];
        $this->audit->log($context, $request, $creating ? 'product.created' : 'product.updated', 'product', $id, $before, $after);
        return $after;
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private function saveSlide(string $id, array $input, bool $creating, ?AuthContext $context, Request $request): array
    {
        Validator::requireValid($input, [
            'image' => 'required|string|max:500', 'eyebrow' => 'sometimes|nullable|string|max:180', 'title' => 'required|string|max:220',
            'emphasis' => 'sometimes|nullable|string|max:220', 'copy' => 'sometimes|nullable|string|max:5000', 'caption' => 'sometimes|nullable|string|max:255',
            'tone' => 'required|string|in:dark,light', 'position' => 'required|string|max:80', 'sortOrder' => 'sometimes|numeric', 'active' => 'sometimes|bool',
        ]);
        $this->assertSafeImageUrl((string) $input['image'], 'image');
        $beforeRaw = $this->database->fetchOne('SELECT * FROM slides WHERE id = ?', [$id]);
        $before = $beforeRaw === null ? null : $this->store->slide($beforeRaw);
        $values = [
            trim((string) $input['image']), $input['eyebrow'] ?? null, trim((string) $input['title']), $input['emphasis'] ?? null,
            $input['copy'] ?? null, $input['caption'] ?? null, $input['tone'], trim((string) $input['position']),
            (int) ($input['sortOrder'] ?? 0), !array_key_exists('active', $input) || !empty($input['active']) ? 1 : 0,
        ];
        $now = Security::now();
        if ($creating) {
            $this->database->execute('INSERT INTO slides (id, image_url, eyebrow, title, emphasis, copy_text, caption, tone, position_value, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', array_merge([$id], $values, [$now, $now]));
        } else {
            $this->database->execute('UPDATE slides SET image_url = ?, eyebrow = ?, title = ?, emphasis = ?, copy_text = ?, caption = ?, tone = ?, position_value = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?', array_merge($values, [$now, $id]));
        }
        $raw = $this->database->fetchOne('SELECT * FROM slides WHERE id = ?', [$id]);
        $after = $this->store->slide($raw ?? []);
        $this->audit->log($context, $request, $creating ? 'slide.created' : 'slide.updated', 'slide', $id, $before, $after);
        return $after;
    }

    private function assertSafeHttpsUrl(string $url, string $field, ?string $expectedHost = null): void
    {
        $parts = parse_url(trim($url));
        $host = is_array($parts) ? strtolower((string) ($parts['host'] ?? '')) : '';
        $hostMatches = $expectedHost === null || $host === $expectedHost || str_ends_with($host, '.' . $expectedHost);
        if (
            filter_var($url, FILTER_VALIDATE_URL) === false
            || !is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || $host === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || !$hostMatches
        ) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, [$field => 'Enter an approved HTTPS URL.']);
        }
    }

    private function assertSafeImageUrl(string $url, string $field): void
    {
        $url = trim($url);
        if ($url === '' || preg_match('/[\\x00-\\x1F\\x7F\\\\]/', $url)) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, [$field => 'Enter a safe image URL.']);
        }
        if (str_starts_with($url, '/')) {
            $path = parse_url($url, PHP_URL_PATH);
            if (
                str_starts_with($url, '//')
                || !is_string($path)
                || (!str_starts_with($path, '/images/') && !str_starts_with($path, '/uploads/'))
                || in_array('..', explode('/', rawurldecode($path)), true)
            ) {
                throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, [$field => 'Use an /images or /uploads path.']);
            }
            return;
        }
        $this->assertSafeHttpsUrl($url, $field);
    }
}
