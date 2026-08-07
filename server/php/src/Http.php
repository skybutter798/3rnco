<?php

declare(strict_types=1);

namespace Rnco;

use JsonException;
use Closure;
use RuntimeException;
use Throwable;

final class ApiException extends RuntimeException
{
    /** @param array<string, mixed> $fields */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 400,
        public readonly array $fields = [],
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}

final class Request
{
    /** @param array<string, string> $headers @param array<string, string> $cookies @param array<string, mixed> $query @param array<string, mixed>|null $json */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        private readonly array $headers = [],
        private readonly array $cookies = [],
        private readonly array $query = [],
        private readonly ?array $json = null,
        private readonly array $files = [],
        public readonly string $remoteAddress = '127.0.0.1',
        public readonly string $userAgent = 'test-agent',
    ) {
    }

    public static function fromGlobals(): self
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        $headers = [];
        if (function_exists('getallheaders')) {
            foreach ((array) getallheaders() as $name => $value) {
                $headers[strtolower((string) $name)] = (string) $value;
            }
        }
        foreach ($_SERVER as $name => $value) {
            if (str_starts_with($name, 'HTTP_')) {
                $header = strtolower(str_replace('_', '-', substr($name, 5)));
                $headers[$header] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }
        if (isset($_SERVER['CONTENT_LENGTH'])) {
            $headers['content-length'] = (string) $_SERVER['CONTENT_LENGTH'];
        }

        $json = null;
        if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true) && !str_starts_with($headers['content-type'] ?? '', 'multipart/form-data')) {
            $length = (int) ($headers['content-length'] ?? 0);
            if ($length > 1048576) {
                throw new ApiException('PAYLOAD_TOO_LARGE', 'The JSON request body is too large.', 413);
            }
            $raw = file_get_contents('php://input');
            if ($raw === false) {
                throw new ApiException('INVALID_REQUEST', 'Unable to read the request body.', 400);
            }
            if (strlen($raw) > 1048576) {
                throw new ApiException('PAYLOAD_TOO_LARGE', 'The JSON request body is too large.', 413);
            }
            if ($raw !== '') {
                try {
                    $decoded = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
                } catch (JsonException $exception) {
                    throw new ApiException('INVALID_JSON', 'The request body must contain valid JSON.', 400, [], $exception);
                }
                if (!is_array($decoded)) {
                    throw new ApiException('INVALID_JSON', 'The request body must be a JSON object.', 400);
                }
                $json = $decoded;
            }
        }

        return new self(
            $method,
            $path,
            $headers,
            array_map('strval', $_COOKIE),
            $_GET,
            $json,
            $_FILES,
            (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'),
            (string) ($headers['user-agent'] ?? ''),
        );
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function cookie(string $name): ?string
    {
        return $this->cookies[$name] ?? null;
    }

    public function query(string $name, mixed $default = null): mixed
    {
        return $this->query[$name] ?? $default;
    }

    /** @return array<string, mixed> */
    public function json(): array
    {
        return $this->json ?? [];
    }

    public function input(string $name, mixed $default = null): mixed
    {
        return ($this->json ?? [])[$name] ?? $default;
    }

    /** @return array<string, mixed>|null */
    public function file(string $name): ?array
    {
        $file = $this->files[$name] ?? null;

        return is_array($file) ? $file : null;
    }
}

final class Response
{
    /** @var array<string, string> */
    public array $headers = [];
    /** @var list<array{name:string,value:string,options:array<string,mixed>}> */
    public array $cookies = [];

    /** @param array<string, mixed>|null $body */
    public function __construct(
        public readonly int $status,
        public readonly ?array $body,
    ) {
        $this->headers = [
            'Content-Type' => 'application/json; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'same-origin',
        ];
    }

    /** @param array<string, mixed> $data */
    public static function success(array $data = [], int $status = 200): self
    {
        return new self($status, ['ok' => true, 'data' => $data]);
    }

    public static function empty(int $status = 204): self
    {
        return new self($status, null);
    }

    /** @param array<string, mixed> $fields */
    public static function error(string $code, string $message, int $status, array $fields = []): self
    {
        $error = ['code' => $code, 'message' => $message];
        if ($fields !== []) {
            $error['fields'] = $fields;
        }

        return new self($status, ['ok' => false, 'error' => $error]);
    }

    /** @param array<string, mixed> $options */
    public function withCookie(string $name, string $value, array $options): self
    {
        $this->cookies[] = ['name' => $name, 'value' => $value, 'options' => $options];

        return $this;
    }

    public function withHeader(string $name, string $value): self
    {
        $this->headers[$name] = $value;

        return $this;
    }

    public function send(): never
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header($name . ': ' . $value);
        }
        foreach ($this->cookies as $cookie) {
            setcookie($cookie['name'], $cookie['value'], $cookie['options']);
        }
        if ($this->body !== null) {
            echo json_encode($this->body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
        }
        exit;
    }
}

final class Route
{
    /** @param callable(Request,array<string,string>,?AuthContext):Response $handler @param array<string,mixed> $options */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly string $pattern,
        public readonly Closure $handler,
        public readonly array $options,
    ) {
    }
}

final class Router
{
    /** @var list<Route> */
    private array $routes = [];

    /** @param callable(Request,array<string,string>,?AuthContext):Response $handler @param array<string,mixed> $options */
    public function add(string $method, string $path, callable $handler, array $options = []): void
    {
        $pattern = preg_replace_callback('/\{([A-Za-z][A-Za-z0-9_]*)\}/', static fn (array $match): string => '(?P<' . $match[1] . '>[^/]+)', $path);
        $this->routes[] = new Route(strtoupper($method), $path, '#^' . $pattern . '$#', Closure::fromCallable($handler), $options);
    }

    /** @return array{0:Route,1:array<string,string>} */
    public function match(Request $request): array
    {
        $pathMatched = false;
        foreach ($this->routes as $route) {
            if (!preg_match($route->pattern, $request->path, $matches)) {
                continue;
            }
            $pathMatched = true;
            if ($route->method !== $request->method) {
                continue;
            }
            $params = [];
            foreach ($matches as $name => $value) {
                if (is_string($name)) {
                    $params[$name] = rawurldecode((string) $value);
                }
            }

            return [$route, $params];
        }

        throw new ApiException(
            $pathMatched ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
            $pathMatched ? 'The requested method is not allowed.' : 'The requested API route was not found.',
            $pathMatched ? 405 : 404,
        );
    }
}
