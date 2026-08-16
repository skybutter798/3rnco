<?php

declare(strict_types=1);

namespace Rnco;

use RuntimeException;

final class Config
{
    /** @var array<string, mixed> */
    private array $values;

    /** @param array<string, mixed> $values */
    public function __construct(array $values)
    {
        $this->values = $values;
    }

    public static function fromEnvironment(?string $envFile = null): self
    {
        $envFile ??= dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
        $fileValues = is_file($envFile) ? self::parseEnvFile($envFile) : [];

        $get = static function (string $name, mixed $default = null) use ($fileValues): mixed {
            $environment = getenv($name);
            if ($environment !== false) {
                return $environment;
            }

            return $fileValues[$name] ?? $default;
        };

        $root = dirname(__DIR__);
        $driver = strtolower((string) $get('DB_DRIVER', 'mysql'));
        $environment = strtolower((string) $get('APP_ENV', 'production'));
        $key = (string) $get('APP_KEY', '');
        $origin = rtrim((string) $get('APP_ORIGIN', 'http://127.0.0.1:8080'), '/');
        $mailEnabled = self::toBool($get('MAIL_ENABLED', false));
        $mailRecipient = strtolower(trim((string) $get('MAIL_NOTIFICATION_TO', '')));
        $mailFromAddress = strtolower(trim((string) $get('MAIL_FROM_ADDRESS', $mailRecipient)));
        $mailFromName = trim((string) $get('MAIL_FROM_NAME', '3R&Co Notifications'));
        $bootstrapAdminIps = self::parseIpList((string) $get('BOOTSTRAP_ADMIN_IPS', ''));

        if ($environment === 'production' && strlen($key) < 32) {
            throw new RuntimeException('APP_KEY must contain at least 32 characters in production.');
        }
        if ($environment === 'production' && $bootstrapAdminIps === []) {
            throw new RuntimeException('BOOTSTRAP_ADMIN_IPS must contain at least one exact IP address in production.');
        }

        if (!in_array($driver, ['mysql', 'sqlite'], true)) {
            throw new RuntimeException('DB_DRIVER must be mysql or sqlite.');
        }
        if ($mailEnabled && (filter_var($mailRecipient, FILTER_VALIDATE_EMAIL) === false || filter_var($mailFromAddress, FILTER_VALIDATE_EMAIL) === false)) {
            throw new RuntimeException('MAIL_NOTIFICATION_TO and MAIL_FROM_ADDRESS must be valid email addresses when mail is enabled.');
        }
        if (str_contains($mailFromName, "\r") || str_contains($mailFromName, "\n")) {
            throw new RuntimeException('MAIL_FROM_NAME cannot contain line breaks.');
        }

        return new self([
            'app.env' => $environment,
            'app.debug' => self::toBool($get('APP_DEBUG', false)),
            'app.key' => $key !== '' ? $key : 'local-test-key-change-me-32-characters',
            'app.origin' => $origin,
            'app.public_root' => self::absolutePath((string) $get('PUBLIC_ROOT', $root . '/public')),
            'db.driver' => $driver,
            'db.host' => (string) $get('DB_HOST', '127.0.0.1'),
            'db.port' => (int) $get('DB_PORT', 3306),
            'db.database' => (string) $get('DB_DATABASE', $root . '/var/local.sqlite'),
            'db.username' => (string) $get('DB_USERNAME', ''),
            'db.password' => (string) $get('DB_PASSWORD', ''),
            'db.charset' => 'utf8mb4',
            'db.collation' => 'utf8mb4_unicode_ci',
            'session.cookie' => (string) $get('SESSION_COOKIE', 'rnco_session'),
            'session.ttl' => max(900, (int) $get('SESSION_TTL_SECONDS', 43200)),
            'session.guest_ttl' => max(300, (int) $get('GUEST_SESSION_TTL_SECONDS', 3600)),
            'session.secure' => self::toBool($get('SESSION_COOKIE_SECURE', $environment === 'production')),
            'session.same_site' => 'Lax',
            'auth.bootstrap_admin_ips' => $bootstrapAdminIps,
            'order.reservation_seconds' => max(300, (int) $get('ORDER_RESERVATION_MINUTES', 1440) * 60),
            'upload.dir' => self::absolutePath((string) $get('UPLOAD_DIR', $root . '/var/uploads')),
            'upload.public_base' => '/' . trim((string) $get('UPLOAD_PUBLIC_BASE', 'uploads'), '/'),
            'upload.max_bytes' => max(1024, (int) $get('UPLOAD_MAX_BYTES', 7864320)),
            'receipt.dir' => self::absolutePath((string) $get('PAYMENT_RECEIPT_DIR', $root . '/var/payment-receipts')),
            'receipt.max_bytes' => max(1024, (int) $get('PAYMENT_RECEIPT_MAX_BYTES', 8388608)),
            'mail.enabled' => $mailEnabled,
            'mail.recipient' => $mailRecipient,
            'mail.from_address' => $mailFromAddress,
            'mail.from_name' => $mailFromName,
            'mail.max_attempts' => max(1, min(20, (int) $get('MAIL_MAX_ATTEMPTS', 5))),
            'mail.admin_url' => (string) $get('MAIL_ADMIN_URL', $origin . '/admin/'),
            'backup.dir' => self::absolutePath((string) $get('BACKUP_DIR', $root . '/var/backups')),
            'backup.upload_dir' => self::absolutePath((string) $get('BACKUP_UPLOAD_DIR', $root . '/var/uploads')),
            'backup.mysqldump' => (string) $get('MYSQLDUMP_BINARY', 'mysqldump'),
            'backup.tar' => (string) $get('TAR_BINARY', 'tar'),
        ]);
    }

    /** @param array<string, mixed> $overrides */
    public static function forTesting(array $overrides = []): self
    {
        $root = dirname(__DIR__);

        return new self(array_replace([
            'app.env' => 'testing',
            'app.debug' => true,
            'app.key' => 'automated-test-key-with-at-least-32-characters',
            'app.origin' => 'http://localhost',
            'app.public_root' => $root . '/public',
            'db.driver' => 'sqlite',
            'db.host' => '127.0.0.1',
            'db.port' => 3306,
            'db.database' => ':memory:',
            'db.username' => '',
            'db.password' => '',
            'db.charset' => 'utf8mb4',
            'db.collation' => 'utf8mb4_unicode_ci',
            'session.cookie' => 'rnco_test_session',
            'session.ttl' => 43200,
            'session.guest_ttl' => 3600,
            'session.secure' => false,
            'session.same_site' => 'Lax',
            'auth.bootstrap_admin_ips' => ['127.0.0.1', '::1'],
            'order.reservation_seconds' => 86400,
            'upload.dir' => $root . '/var/uploads',
            'upload.public_base' => '/uploads',
            'upload.max_bytes' => 10485760,
            'receipt.dir' => $root . '/var/payment-receipts',
            'receipt.max_bytes' => 8388608,
            'mail.enabled' => false,
            'mail.recipient' => 'notifications@example.test',
            'mail.from_address' => 'notifications@example.test',
            'mail.from_name' => '3R&Co Notifications',
            'mail.max_attempts' => 5,
            'mail.admin_url' => 'http://localhost/admin/',
            'backup.dir' => $root . '/var/backups',
            'backup.upload_dir' => $root . '/var/uploads',
            'backup.mysqldump' => 'mysqldump',
            'backup.tar' => 'tar',
        ], $overrides));
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->values[$key] ?? $default;
    }

    public function string(string $key): string
    {
        return (string) ($this->values[$key] ?? '');
    }

    public function int(string $key): int
    {
        return (int) ($this->values[$key] ?? 0);
    }

    public function bool(string $key): bool
    {
        return (bool) ($this->values[$key] ?? false);
    }

    /** @return array<string, string> */
    private static function parseEnvFile(string $path): array
    {
        $result = [];
        $lines = file($path, FILE_IGNORE_NEW_LINES);
        if ($lines === false) {
            throw new RuntimeException('Unable to read private environment configuration.');
        }

        foreach ($lines as $lineNumber => $line) {
            $trimmed = trim($line);
            if ($trimmed === '' || str_starts_with($trimmed, '#')) {
                continue;
            }
            if (!str_contains($trimmed, '=')) {
                throw new RuntimeException(sprintf('Invalid environment entry on line %d.', $lineNumber + 1));
            }

            [$name, $value] = array_map('trim', explode('=', $trimmed, 2));
            if (!preg_match('/^[A-Z][A-Z0-9_]*$/', $name)) {
                throw new RuntimeException(sprintf('Invalid environment key on line %d.', $lineNumber + 1));
            }
            if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
                $value = substr($value, 1, -1);
            }
            $result[$name] = $value;
        }

        return $result;
    }

    private static function toBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return filter_var((string) $value, FILTER_VALIDATE_BOOL);
    }

    /** @return list<string> */
    private static function parseIpList(string $value): array
    {
        $addresses = [];
        foreach (explode(',', $value) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '') {
                continue;
            }
            if (filter_var($candidate, FILTER_VALIDATE_IP) === false) {
                throw new RuntimeException('BOOTSTRAP_ADMIN_IPS contains an invalid IP address.');
            }
            $addresses[$candidate] = true;
        }

        return array_keys($addresses);
    }

    private static function absolutePath(string $path): string
    {
        if ($path === '') {
            throw new RuntimeException('Configured filesystem path cannot be empty.');
        }

        return rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $path), DIRECTORY_SEPARATOR);
    }
}
