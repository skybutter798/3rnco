<?php

declare(strict_types=1);

namespace Rnco;

use PDOException;

final class AuthContext
{
    /** @param array<string, mixed>|null $user */
    public function __construct(
        public readonly string $tokenHash,
        public readonly ?array $user,
    ) {
    }

    public function authenticated(): bool
    {
        return $this->user !== null;
    }

    public function userId(): ?int
    {
        return $this->user === null ? null : (int) $this->user['id'];
    }

    public function role(): ?string
    {
        return $this->user === null ? null : (string) $this->user['role'];
    }

    public function mustChangePassword(): bool
    {
        return $this->user !== null && (bool) $this->user['must_change_password'];
    }
}

final class Auth
{
    /** @var list<array{name:string,value:string,options:array<string,mixed>}> */
    private array $pendingCookies = [];

    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
    ) {
    }

    public function resolve(Request $request): ?AuthContext
    {
        $token = $request->cookie($this->config->string('session.cookie'));
        if ($token === null || strlen($token) < 32 || strlen($token) > 128) {
            return null;
        }
        $tokenHash = hash('sha256', $token);
        $row = $this->database->fetchOne(
            'SELECT s.token_hash, s.user_id AS session_user_id, s.expires_at, s.revoked_at, ' .
            'u.id, u.public_id, u.role, u.username, u.email, u.first_name, u.last_name, u.display_name, u.phone, ' .
            'u.date_of_birth, u.marketing_consent, u.status, u.must_change_password, u.email_verified_at, u.last_login_at, u.created_at, u.updated_at ' .
            'FROM auth_sessions s LEFT JOIN users u ON u.id = s.user_id ' .
            'WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?',
            [$tokenHash, Security::now()],
        );
        if ($row === null) {
            return null;
        }
        if ($row['session_user_id'] !== null && ($row['status'] ?? null) !== 'active') {
            $this->database->execute('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?', [Security::now(), $tokenHash]);
            $this->queueExpiredCookie();
            return null;
        }

        $this->database->execute('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?', [Security::now(), $tokenHash]);
        $user = $row['session_user_id'] === null ? null : $this->extractUser($row);

        return new AuthContext($tokenHash, $user);
    }

    /** @return array<string, mixed> */
    public function sessionSnapshot(Request $request): array
    {
        $context = $this->resolve($request);
        if ($context === null) {
            [$context, $csrfToken] = $this->issueSession(null, $request);
        } else {
            $sessionToken = $request->cookie($this->config->string('session.cookie'));
            if ($sessionToken === null) {
                throw new ApiException('SESSION_INVALID', 'The browser session is invalid.', 401);
            }
            $csrfToken = $this->csrfTokenForSession($sessionToken);
            $this->database->execute(
                'UPDATE auth_sessions SET csrf_hash = ?, last_seen_at = ? WHERE token_hash = ?',
                [hash('sha256', $csrfToken), Security::now(), $context->tokenHash],
            );
        }

        return [
            'authenticated' => $context->authenticated(),
            'user' => $context->user === null ? null : $this->publicUser($context->user),
            'csrfToken' => $csrfToken,
        ];
    }

    public function verifyCsrf(?AuthContext $context, Request $request): void
    {
        if ($context === null) {
            throw new ApiException('CSRF_SESSION_REQUIRED', 'Start a secure session before submitting this form.', 419);
        }
        $token = $request->header('x-csrf-token');
        if ($token === null || strlen($token) < 32 || strlen($token) > 128) {
            throw new ApiException('CSRF_TOKEN_INVALID', 'The security token is missing or invalid.', 419);
        }
        $row = $this->database->fetchOne('SELECT csrf_hash FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL', [$context->tokenHash]);
        if ($row === null || !hash_equals((string) $row['csrf_hash'], hash('sha256', $token))) {
            throw new ApiException('CSRF_TOKEN_INVALID', 'The security token is missing or invalid.', 419);
        }
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public function register(AuthContext $guest, array $input, Request $request): array
    {
        if ((!isset($input['firstName']) || !isset($input['lastName'])) && isset($input['fullName']) && is_string($input['fullName'])) {
            $parts = preg_split('/\s+/', trim($input['fullName']), 2) ?: [];
            $input['firstName'] = $parts[0] ?? '';
            $input['lastName'] = $parts[1] ?? '';
            $input['displayName'] ??= trim($input['fullName']);
        }
        Validator::requireValid($input, [
            'email' => 'required|string|email|max:191',
            'password' => 'required|string|min:10|max:200',
            'firstName' => 'required|string|max:100',
            'lastName' => 'required|string|max:100',
            'phone' => 'required|string|max:40',
            'displayName' => 'sometimes|nullable|string|max:150',
            'dateOfBirth' => 'sometimes|nullable|string|max:10',
            'marketingConsent' => 'sometimes|bool',
        ]);
        Validator::password((string) $input['password'], 10);
        $email = Security::normalizeEmail((string) $input['email']);
        if ($this->database->fetchOne('SELECT id FROM users WHERE email = ?', [$email]) !== null) {
            throw new ApiException('EMAIL_ALREADY_REGISTERED', 'An account already exists for this email address.', 409, ['email' => 'Use a different email or sign in.']);
        }
        $dateOfBirth = $input['dateOfBirth'] ?? null;
        if ($dateOfBirth !== null && $dateOfBirth !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $dateOfBirth)) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, ['dateOfBirth' => 'Use YYYY-MM-DD.']);
        }
        $now = Security::now();
        try {
            $this->database->execute(
                'INSERT INTO users (public_id, role, username, email, password_hash, first_name, last_name, display_name, phone, date_of_birth, marketing_consent, status, must_change_password, email_verified_at, last_login_at, created_at, updated_at) ' .
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    Security::uuid(), 'customer', null, $email, Security::passwordHash((string) $input['password']),
                    trim((string) $input['firstName']), trim((string) $input['lastName']),
                    isset($input['displayName']) ? trim((string) $input['displayName']) : null,
                    trim((string) $input['phone']), $dateOfBirth ?: null, !empty($input['marketingConsent']) ? 1 : 0,
                    'active', 0, null, $now, $now, $now,
                ],
            );
        } catch (PDOException $exception) {
            throw new ApiException('EMAIL_ALREADY_REGISTERED', 'An account already exists for this email address.', 409, ['email' => 'Use a different email or sign in.'], $exception);
        }
        $userId = $this->database->lastInsertId();
        $this->revoke($guest);
        [$context, $csrfToken] = $this->issueSession($userId, $request);

        return ['authenticated' => true, 'user' => $this->publicUser($context->user ?? []), 'csrfToken' => $csrfToken];
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public function login(AuthContext $guest, array $input, Request $request): array
    {
        if (!isset($input['login'])) {
            $input['login'] = $input['identifier'] ?? $input['email'] ?? $input['username'] ?? null;
        }
        Validator::requireValid($input, [
            'login' => 'required|string|max:191',
            'password' => 'required|string|max:200',
        ]);
        $login = Security::normalizeEmail((string) $input['login']);
        $user = $this->database->fetchOne('SELECT * FROM users WHERE (email = ? OR username = ?) LIMIT 1', [$login, $login]);
        $dummy = '$2y$12$H0V7WlVMwxj95L7zaNdQ8eoAzS7U5y2mMhpvW9gUoWkLGyH0ghewy';
        $verified = password_verify((string) $input['password'], (string) ($user['password_hash'] ?? $dummy));
        if (!$verified || $user === null || $user['status'] !== 'active') {
            throw new ApiException('INVALID_CREDENTIALS', 'The username/email or password is incorrect.', 401);
        }
        $this->assertBootstrapAdminNetwork($user, $request);
        if (password_needs_rehash((string) $user['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
            $this->database->execute('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [Security::passwordHash((string) $input['password']), Security::now(), $user['id']]);
        }
        $this->database->execute('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [Security::now(), Security::now(), $user['id']]);
        $this->revoke($guest);
        [$context, $csrfToken] = $this->issueSession((int) $user['id'], $request);

        return ['authenticated' => true, 'user' => $this->publicUser($context->user ?? []), 'csrfToken' => $csrfToken];
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public function changePassword(AuthContext $context, array $input, Request $request): array
    {
        if (!$context->authenticated()) {
            throw new ApiException('AUTHENTICATION_REQUIRED', 'Sign in to continue.', 401);
        }
        $this->assertBootstrapAdminNetwork($context->user ?? [], $request);
        Validator::requireValid($input, [
            'currentPassword' => 'required|string|max:200',
            'newPassword' => 'required|string|min:12|max:200',
        ]);
        Validator::password((string) $input['newPassword'], 12);
        $credentials = $this->database->fetchOne('SELECT password_hash FROM users WHERE id = ?', [$context->userId()]);
        if ($credentials === null || !password_verify((string) $input['currentPassword'], (string) $credentials['password_hash'])) {
            throw new ApiException('CURRENT_PASSWORD_INVALID', 'The current password is incorrect.', 422, ['currentPassword' => 'Check the current password.']);
        }
        if (password_verify((string) $input['newPassword'], (string) $credentials['password_hash'])) {
            throw new ApiException('PASSWORD_REUSE_NOT_ALLOWED', 'Choose a password you have not just used.', 422, ['newPassword' => 'Choose a different password.']);
        }
        $this->database->transaction(function () use ($context, $input): void {
            $this->database->execute(
                'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
                [Security::passwordHash((string) $input['newPassword']), Security::now(), $context->userId()],
            );
            $this->database->execute('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Security::now(), $context->userId()]);
        });
        [$newContext, $csrfToken] = $this->issueSession((int) $context->userId(), $request);

        return ['authenticated' => true, 'user' => $this->publicUser($newContext->user ?? []), 'csrfToken' => $csrfToken];
    }

    public function logout(AuthContext $context): void
    {
        $this->revoke($context);
        $this->queueExpiredCookie();
    }

    /** @return list<array{name:string,value:string,options:array<string,mixed>}> */
    public function pullCookies(): array
    {
        $cookies = $this->pendingCookies;
        $this->pendingCookies = [];

        return $cookies;
    }

    /** @param array<string, mixed> $user @return array<string, mixed> */
    public function publicUser(array $user): array
    {
        return [
            'id' => (string) ($user['public_id'] ?? ''),
            'role' => (string) ($user['role'] ?? ''),
            'username' => $user['username'] ?? null,
            'email' => (string) ($user['email'] ?? ''),
            'fullName' => trim((string) ($user['first_name'] ?? '') . ' ' . (string) ($user['last_name'] ?? '')),
            'firstName' => (string) ($user['first_name'] ?? ''),
            'lastName' => (string) ($user['last_name'] ?? ''),
            'displayName' => $user['display_name'] ?? null,
            'phone' => $user['phone'] ?? null,
            'dateOfBirth' => $user['date_of_birth'] ?? null,
            'birthDate' => $user['date_of_birth'] ?? null,
            'marketingConsent' => (bool) ($user['marketing_consent'] ?? false),
            'mustChangePassword' => (bool) ($user['must_change_password'] ?? false),
            'emailVerified' => ($user['email_verified_at'] ?? null) !== null,
            'lastLoginAt' => $user['last_login_at'] ?? null,
            'createdAt' => $user['created_at'] ?? null,
        ];
    }

    /** @return array{0:AuthContext,1:string} */
    private function issueSession(?int $userId, Request $request): array
    {
        $token = Security::randomToken();
        $csrfToken = $this->csrfTokenForSession($token);
        $tokenHash = hash('sha256', $token);
        $now = Security::now();
        $ttl = $userId === null ? $this->config->int('session.guest_ttl') : $this->config->int('session.ttl');
        $this->database->execute(
            'INSERT INTO auth_sessions (token_hash, user_id, csrf_hash, ip_hash, user_agent_hash, expires_at, last_seen_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $tokenHash,
                $userId,
                hash('sha256', $csrfToken),
                Security::keyedHash($request->remoteAddress, $this->config),
                Security::keyedHash($request->userAgent, $this->config),
                Security::afterSeconds($ttl),
                $now,
                null,
                $now,
            ],
        );
        $this->pendingCookies[] = [
            'name' => $this->config->string('session.cookie'),
            'value' => $token,
            'options' => $this->cookieOptions(time() + $ttl),
        ];
        $row = $userId === null ? null : $this->database->fetchOne('SELECT * FROM users WHERE id = ?', [$userId]);

        return [new AuthContext($tokenHash, $row), $csrfToken];
    }

    private function csrfTokenForSession(string $sessionToken): string
    {
        return Security::keyedHash('csrf|' . $sessionToken, $this->config);
    }

    private function revoke(AuthContext $context): void
    {
        $this->database->execute('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [Security::now(), $context->tokenHash]);
    }

    private function queueExpiredCookie(): void
    {
        $this->pendingCookies[] = [
            'name' => $this->config->string('session.cookie'),
            'value' => '',
            'options' => $this->cookieOptions(time() - 3600),
        ];
    }

    /** @param array<string, mixed> $user */
    private function assertBootstrapAdminNetwork(array $user, Request $request): void
    {
        if (($user['role'] ?? null) !== 'admin' || !(bool) ($user['must_change_password'] ?? false)) {
            return;
        }
        $allowed = $this->config->get('auth.bootstrap_admin_ips', []);
        if (!is_array($allowed) || !in_array($request->remoteAddress, $allowed, true)) {
            throw new ApiException(
                'BOOTSTRAP_ADMIN_NETWORK_REQUIRED',
                'The temporary administrator password may only be used from the configured bootstrap network.',
                403,
            );
        }
    }

    /** @return array<string, mixed> */
    private function cookieOptions(int $expires): array
    {
        return [
            'expires' => $expires,
            'path' => '/',
            'secure' => $this->config->bool('session.secure'),
            'httponly' => true,
            'samesite' => $this->config->string('session.same_site'),
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function extractUser(array $row): array
    {
        return [
            'id' => $row['id'], 'public_id' => $row['public_id'], 'role' => $row['role'], 'username' => $row['username'], 'email' => $row['email'],
            'first_name' => $row['first_name'], 'last_name' => $row['last_name'], 'display_name' => $row['display_name'], 'phone' => $row['phone'],
            'date_of_birth' => $row['date_of_birth'], 'marketing_consent' => $row['marketing_consent'], 'status' => $row['status'],
            'must_change_password' => $row['must_change_password'], 'email_verified_at' => $row['email_verified_at'], 'last_login_at' => $row['last_login_at'],
            'created_at' => $row['created_at'], 'updated_at' => $row['updated_at'],
        ];
    }
}
