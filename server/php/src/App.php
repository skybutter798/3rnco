<?php

declare(strict_types=1);

namespace Rnco;

use Throwable;

final class App
{
    private readonly Router $router;
    private readonly Auth $auth;
    private readonly RateLimiter $rateLimiter;

    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
    ) {
        $this->router = new Router();
        $this->auth = new Auth($config, $database);
        $this->rateLimiter = new RateLimiter($config, $database);
        $audit = new AuditLogger($config, $database);
        $store = new StoreRepository($database);
        $referrals = new ReferralService($database);
        $notifications = new NotificationService($config, $database);
        $orders = new OrderService($database, $store, $config, $referrals);
        $uploads = new UploadService($config, $database);
        $receipts = new PaymentReceiptService($config, $database);

        $storeController = new StoreController($store, $database);
        $authController = new AuthController($this->auth, $this->rateLimiter, $audit);
        $accountController = new AccountController($database, $this->auth, $orders, $receipts, $audit, $referrals, $notifications);
        $publicController = new PublicController($database, $orders, $this->rateLimiter, $audit, $referrals, $notifications);
        $adminController = new AdminController($database, $store, $orders, $uploads, $receipts, $this->auth, $audit, $referrals);

        $this->routes($storeController, $authController, $accountController, $publicController, $adminController);
    }

    public function handle(Request $request): Response
    {
        if ($request->method === 'OPTIONS') {
            return Response::empty(204)->withHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
        }

        try {
            if (!str_starts_with($request->path, '/api/v1')) {
                throw new ApiException('NOT_FOUND', 'The requested API route was not found.', 404);
            }
            if (!in_array($request->method, ['GET', 'HEAD'], true)) {
                Security::assertSameOrigin($request, $this->config);
            }
            [$route, $params] = $this->router->match($request);
            $context = $this->auth->resolve($request);
            $options = $route->options;

            if (isset($options['rate']) && is_array($options['rate'])) {
                $this->rateLimiter->consume(
                    (string) ($options['rate']['bucket'] ?? $route->path),
                    $request->remoteAddress,
                    (int) ($options['rate']['limit'] ?? 60),
                    (int) ($options['rate']['window'] ?? 60),
                );
            }
            $requiredRole = $options['auth'] ?? null;
            if ($requiredRole !== null) {
                if ($context === null || !$context->authenticated()) {
                    throw new ApiException('AUTHENTICATION_REQUIRED', 'Sign in to continue.', 401);
                }
                if ($requiredRole === 'customer' && $context->role() !== 'customer') {
                    throw new ApiException('CUSTOMER_ACCESS_REQUIRED', 'A customer account is required.', 403);
                }
                if ($requiredRole === 'admin' && $context->role() !== 'admin') {
                    throw new ApiException('ADMIN_ACCESS_REQUIRED', 'Administrator access is required.', 403);
                }
                if ($requiredRole === 'backoffice' && !$context->isBackoffice()) {
                    throw new ApiException('STAFF_ACCESS_REQUIRED', 'Staff access is required.', 403);
                }
                if (isset($options['permission']) && !$context->can((string) $options['permission'])) {
                    throw new ApiException('STAFF_PERMISSION_REQUIRED', 'Your staff account does not have access to this area.', 403);
                }
            }
            if (in_array(($requiredRole ?? null), ['admin', 'backoffice'], true) && $context?->mustChangePassword() && !($options['allowMustChange'] ?? false)) {
                throw new ApiException('PASSWORD_CHANGE_REQUIRED', 'Change the temporary administrator password before using this area.', 403);
            }
            if (($options['csrf'] ?? false) === true) {
                $this->auth->verifyCsrf($context, $request);
            }

            $response = ($route->handler)($request, $params, $context);
        } catch (ApiException $exception) {
            $response = Response::error($exception->errorCode, $exception->getMessage(), $exception->status, $exception->fields);
            if ($exception->errorCode === 'RATE_LIMITED' && isset($exception->fields['retryAfter'])) {
                $response->withHeader('Retry-After', (string) $exception->fields['retryAfter']);
            }
        } catch (Throwable $exception) {
            $fields = $this->config->bool('app.debug') ? ['exception' => $exception::class] : [];
            $response = Response::error('INTERNAL_ERROR', 'The server could not complete this request.', 500, $fields);
            error_log('[3rnco-api] ' . $exception::class . ': ' . $exception->getMessage());
        }

        foreach ($this->auth->pullCookies() as $cookie) {
            $response->withCookie($cookie['name'], $cookie['value'], $cookie['options']);
        }

        return $response;
    }

    private function routes(StoreController $store, AuthController $auth, AccountController $account, PublicController $public, AdminController $admin): void
    {
        $this->router->add('GET', '/api/v1/health', [$store, 'health'], ['rate' => ['bucket' => 'health', 'limit' => 120, 'window' => 60]]);
        $this->router->add('HEAD', '/api/v1/health', [$store, 'health'], ['rate' => ['bucket' => 'health', 'limit' => 120, 'window' => 60]]);
        $this->router->add('GET', '/api/v1/storefront', [$store, 'storefront'], ['rate' => ['bucket' => 'storefront', 'limit' => 120, 'window' => 60]]);

        $this->router->add('GET', '/api/v1/auth/session', [$auth, 'session'], ['rate' => ['bucket' => 'auth-session', 'limit' => 30, 'window' => 60]]);
        $this->router->add('POST', '/api/v1/auth/register', [$auth, 'register'], ['csrf' => true]);
        $this->router->add('POST', '/api/v1/auth/login', [$auth, 'login'], ['csrf' => true]);
        $this->router->add('POST', '/api/v1/auth/logout', [$auth, 'logout'], ['auth' => 'user', 'csrf' => true]);
        $this->router->add('POST', '/api/v1/auth/change-password', [$auth, 'changePassword'], ['auth' => 'user', 'csrf' => true, 'rate' => ['bucket' => 'auth-change-password', 'limit' => 5, 'window' => 900]]);

        $this->router->add('GET', '/api/v1/profile', [$account, 'profile'], ['auth' => 'user']);
        $this->router->add('PATCH', '/api/v1/profile', [$account, 'updateProfile'], ['auth' => 'user', 'csrf' => true]);
        $this->router->add('GET', '/api/v1/profile/addresses', [$account, 'addresses'], ['auth' => 'user']);
        $this->router->add('POST', '/api/v1/profile/addresses', [$account, 'createAddress'], ['auth' => 'user', 'csrf' => true]);
        $this->router->add('PATCH', '/api/v1/profile/addresses/{id}', [$account, 'updateAddress'], ['auth' => 'user', 'csrf' => true]);
        $this->router->add('DELETE', '/api/v1/profile/addresses/{id}', [$account, 'deleteAddress'], ['auth' => 'user', 'csrf' => true]);
        $this->router->add('GET', '/api/v1/addresses', [$account, 'addresses'], ['auth' => 'user']);
        $this->router->add('POST', '/api/v1/addresses', [$account, 'createAddress'], ['auth' => 'user', 'csrf' => true]);
        $this->router->add('PATCH', '/api/v1/addresses/{id}', [$account, 'updateAddress'], ['auth' => 'user', 'csrf' => true]);
        $this->router->add('DELETE', '/api/v1/addresses/{id}', [$account, 'deleteAddress'], ['auth' => 'user', 'csrf' => true]);
        $this->router->add('GET', '/api/v1/orders', [$account, 'orders'], ['auth' => 'customer']);
        $this->router->add('GET', '/api/v1/account/referrals', [$account, 'referrals'], ['auth' => 'customer']);
        $this->router->add('POST', '/api/v1/orders', [$public, 'createOrder'], ['auth' => 'customer', 'csrf' => true, 'rate' => ['bucket' => 'order-create', 'limit' => 20, 'window' => 3600]]);
        $this->router->add('POST', '/api/v1/promos/validate', [$public, 'validatePromo'], ['csrf' => true, 'rate' => ['bucket' => 'promo-validate', 'limit' => 60, 'window' => 600]]);
        $this->router->add('POST', '/api/v1/referrals/resolve', [$public, 'resolveReferral'], ['csrf' => true, 'rate' => ['bucket' => 'referral-resolve', 'limit' => 60, 'window' => 600]]);
        $this->router->add('POST', '/api/v1/enquiries', [$public, 'enquiry'], ['csrf' => true, 'rate' => ['bucket' => 'enquiry-create', 'limit' => 8, 'window' => 3600]]);
        $this->router->add('POST', '/api/v1/newsletter', [$public, 'newsletter'], ['csrf' => true, 'rate' => ['bucket' => 'newsletter', 'limit' => 8, 'window' => 3600]]);

        $this->router->add('GET', '/api/v1/admin/settings', [$admin, 'settings'], ['auth' => 'backoffice', 'allowMustChange' => true]);
        $this->router->add('PATCH', '/api/v1/admin/settings', [$admin, 'updateSettings'], ['auth' => 'admin', 'csrf' => true]);
        $this->router->add('GET', '/api/v1/admin/dashboard', [$admin, 'dashboard'], ['auth' => 'backoffice', 'permission' => 'dashboard']);

        $this->router->add('GET', '/api/v1/admin/staff', [$admin, 'staff'], ['auth' => 'admin']);
        $this->router->add('POST', '/api/v1/admin/staff', [$admin, 'createStaff'], ['auth' => 'admin', 'csrf' => true]);
        $this->router->add('PATCH', '/api/v1/admin/staff/{id}', [$admin, 'updateStaff'], ['auth' => 'admin', 'csrf' => true]);
        $this->router->add('GET', '/api/v1/admin/payment-receipts/{id}/file', [$admin, 'paymentReceiptFile'], ['auth' => 'backoffice', 'permission' => 'orders']);
        $this->router->add('PATCH', '/api/v1/admin/payment-receipts/{id}', [$admin, 'reviewPaymentReceipt'], ['auth' => 'backoffice', 'permission' => 'orders', 'csrf' => true]);

        $this->router->add('POST', '/api/v1/orders/{id}/receipt', [$account, 'uploadPaymentReceipt'], ['auth' => 'customer', 'csrf' => true, 'rate' => ['bucket' => 'payment-receipt', 'limit' => 10, 'window' => 3600]]);

        $this->resource('/api/v1/admin/products', $admin, 'products', 'product', 'createProduct', 'updateProduct', 'deleteProduct');
        $this->resource('/api/v1/admin/slides', $admin, 'slides', 'product', 'createSlide', 'updateSlide', 'deleteSlide', 'slide');
        $this->resource('/api/v1/admin/bundles', $admin, 'bundles', 'bundle', 'createBundle', 'updateBundle', 'deleteBundle');
        $this->resource('/api/v1/admin/promos', $admin, 'promos', 'promo', 'createPromo', 'updatePromo', 'deletePromo');
        $this->resource('/api/v1/admin/referrals', $admin, 'referrals', 'referrals', 'createReferral', 'updateReferral', 'deleteReferral');
        $this->router->add('GET', '/api/v1/admin/referral-commissions', [$admin, 'referralCommissions'], ['auth' => 'backoffice', 'permission' => 'referrals']);
        $this->router->add('PATCH', '/api/v1/admin/referral-commissions/{id}', [$admin, 'updateReferralCommission'], ['auth' => 'backoffice', 'permission' => 'referrals', 'csrf' => true]);
        $this->resource('/api/v1/admin/orders', $admin, 'orders', 'order', null, 'updateOrder', 'deleteOrder');
        $this->resource('/api/v1/admin/customers', $admin, 'customers', 'customer', 'createCustomer', 'updateCustomer', 'deleteCustomer');
        $this->resource('/api/v1/admin/enquiries', $admin, 'enquiries', 'enquiry', null, 'updateEnquiry', 'deleteEnquiry');
        $this->router->add('POST', '/api/v1/admin/enquiries/{id}/replies', [$admin, 'replyEnquiry'], ['auth' => 'backoffice', 'permission' => 'enquiries', 'csrf' => true]);
        $this->router->add('GET', '/api/v1/admin/uploads', [$admin, 'uploads'], ['auth' => 'backoffice', 'permission' => 'content']);
        $this->router->add('POST', '/api/v1/admin/uploads', [$admin, 'createUpload'], ['auth' => 'backoffice', 'permission' => 'content', 'csrf' => true, 'rate' => ['bucket' => 'admin-upload', 'limit' => 30, 'window' => 3600]]);
        $this->router->add('DELETE', '/api/v1/admin/uploads/{id}', [$admin, 'deleteUpload'], ['auth' => 'backoffice', 'permission' => 'content', 'csrf' => true]);
        $this->router->add('GET', '/api/v1/admin/audit-logs', [$admin, 'auditLogs'], ['auth' => 'admin']);
    }

    private function resource(string $base, AdminController $controller, string $list, string $show, ?string $create, string $update, string $delete, ?string $showOverride = null): void
    {
        $permission = match (true) {
            str_contains($base, '/orders') => 'orders', str_contains($base, '/customers') => 'customers',
            str_contains($base, '/enquiries') => 'enquiries', str_contains($base, '/promos') => 'promos', str_contains($base, '/referrals') => 'referrals',
            default => 'content',
        };
        $options = ['auth' => 'backoffice', 'permission' => $permission];
        $this->router->add('GET', $base, [$controller, $list], $options);
        $this->router->add('GET', $base . '/{id}', [$controller, $showOverride ?? $show], $options);
        if ($create !== null) {
            $this->router->add('POST', $base, [$controller, $create], $options + ['csrf' => true]);
        }
        $this->router->add('PATCH', $base . '/{id}', [$controller, $update], $options + ['csrf' => true]);
        $this->router->add('DELETE', $base . '/{id}', [$controller, $delete], $options + ['csrf' => true]);
    }
}
