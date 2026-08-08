<?php

declare(strict_types=1);

namespace Rnco;

use DateTimeImmutable;
use DateTimeZone;
use JsonException;

final class Security
{
    public static function now(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');
    }

    public static function afterSeconds(int $seconds): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))
            ->modify('+' . $seconds . ' seconds')
            ->format('Y-m-d H:i:s');
    }

    public static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);

        return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
    }

    public static function randomToken(int $bytes = 32): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    public static function passwordHash(string $password): string
    {
        $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
        $hash = password_hash($password, $algorithm);
        if ($hash === false) {
            throw new ApiException('PASSWORD_HASH_FAILED', 'Unable to secure the password.', 500);
        }

        return $hash;
    }

    public static function keyedHash(string $value, Config $config): string
    {
        return hash_hmac('sha256', $value, $config->string('app.key'));
    }

    public static function normalizeEmail(string $email): string
    {
        return mb_strtolower(trim($email), 'UTF-8');
    }

    public static function assertSameOrigin(Request $request, Config $config): void
    {
        $origin = $request->header('origin');
        if ($origin === null || $origin === '') {
            return;
        }
        if (!hash_equals(strtolower($config->string('app.origin')), strtolower(rtrim($origin, '/')))) {
            throw new ApiException('ORIGIN_REJECTED', 'Cross-origin requests are not allowed.', 403);
        }
    }

    /** @param mixed $value */
    public static function jsonEncode(mixed $value): string
    {
        try {
            return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
        } catch (JsonException $exception) {
            throw new ApiException('INVALID_DATA', 'The supplied data cannot be encoded safely.', 422, [], $exception);
        }
    }

    /** @return mixed */
    public static function jsonDecode(?string $value, mixed $default = null): mixed
    {
        if ($value === null || $value === '') {
            return $default;
        }
        try {
            return json_decode($value, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return $default;
        }
    }

    /** @param array<string, mixed> $value */
    public static function canonicalJsonHash(array $value): string
    {
        return hash('sha256', self::jsonEncode(self::canonicalize($value)));
    }

    private static function canonicalize(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map([self::class, 'canonicalize'], $value);
        }
        ksort($value, SORT_STRING);
        foreach ($value as $key => $item) {
            $value[$key] = self::canonicalize($item);
        }

        return $value;
    }
}

final class Validator
{
    /** @param array<string, mixed> $input @param array<string, string> $rules @return array<string, string> */
    public static function validate(array $input, array $rules): array
    {
        $errors = [];
        foreach ($rules as $field => $ruleList) {
            $rulesForField = explode('|', $ruleList);
            $present = array_key_exists($field, $input);
            $value = $input[$field] ?? null;
            foreach ($rulesForField as $rule) {
                [$name, $argument] = array_pad(explode(':', $rule, 2), 2, null);
                if ($name === 'sometimes' && !$present) {
                    break;
                }
                if ($name === 'nullable' && ($value === null || $value === '')) {
                    break;
                }
                if ($name === 'required' && (!$present || $value === null || (is_string($value) && trim($value) === ''))) {
                    $errors[$field] = 'This field is required.';
                    break;
                }
                if (!$present || $value === null) {
                    continue;
                }
                if ($name === 'string' && !is_string($value)) {
                    $errors[$field] = 'This field must be a string.';
                } elseif ($name === 'array' && !is_array($value)) {
                    $errors[$field] = 'This field must be an array.';
                } elseif ($name === 'email' && (!is_string($value) || filter_var($value, FILTER_VALIDATE_EMAIL) === false)) {
                    $errors[$field] = 'Enter a valid email address.';
                } elseif ($name === 'min' && is_string($value) && mb_strlen($value) < (int) $argument) {
                    $errors[$field] = sprintf('This field must contain at least %d characters.', (int) $argument);
                } elseif ($name === 'max' && is_string($value) && mb_strlen($value) > (int) $argument) {
                    $errors[$field] = sprintf('This field may contain at most %d characters.', (int) $argument);
                } elseif ($name === 'in' && !in_array((string) $value, explode(',', (string) $argument), true)) {
                    $errors[$field] = 'Choose a supported value.';
                } elseif ($name === 'bool' && !is_bool($value) && !in_array($value, [0, 1, '0', '1'], true)) {
                    $errors[$field] = 'This field must be true or false.';
                } elseif ($name === 'numeric' && !is_numeric($value)) {
                    $errors[$field] = 'This field must be numeric.';
                }
                if (isset($errors[$field])) {
                    break;
                }
            }
        }

        return $errors;
    }

    /** @param array<string, mixed> $input @param array<string, string> $rules */
    public static function requireValid(array $input, array $rules): void
    {
        $errors = self::validate($input, $rules);
        if ($errors !== []) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, $errors);
        }
    }

    public static function password(string $password, int $minimum = 8, bool $requireMixed = true): void
    {
        $errors = [];
        if (mb_strlen($password) < $minimum) {
            $errors[] = sprintf('at least %d characters', $minimum);
        }
        if ($requireMixed && !preg_match('/[A-Za-z]/', $password)) {
            $errors[] = 'a letter';
        }
        if ($requireMixed && !preg_match('/\d/', $password)) {
            $errors[] = 'a number';
        }
        if ($errors !== []) {
            throw new ApiException('WEAK_PASSWORD', 'Password must include ' . implode(', ', $errors) . '.', 422, ['password' => 'Choose a stronger password.']);
        }
    }

    public static function slug(string $value, string $field = 'id'): string
    {
        $value = trim($value);
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $value)) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, [$field => 'Use lowercase letters, numbers and hyphens only.']);
        }

        return $value;
    }

    public static function moneyToCents(mixed $value, string $field): int
    {
        if (!is_numeric($value) || (float) $value < 0) {
            throw new ApiException('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, [$field => 'Enter a non-negative amount.']);
        }

        return (int) round(((float) $value) * 100, 0, PHP_ROUND_HALF_UP);
    }
}
