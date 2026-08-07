<?php

declare(strict_types=1);

use Rnco\ApiException;
use Rnco\Request;
use Rnco\Response;

$productionRoot = '/home/rncomy/3rnco_app/current';
$productionEnv = '/home/rncomy/3rnco_shared/.env';
$configuredRoot = getenv('RNCO_APP_ROOT');
$appRoot = $configuredRoot !== false && $configuredRoot !== ''
    ? rtrim($configuredRoot, '/\\')
    : (is_dir($productionRoot) ? $productionRoot : dirname(__DIR__));
$configuredEnv = getenv('RNCO_ENV_FILE');
$envFile = $configuredEnv !== false && $configuredEnv !== ''
    ? $configuredEnv
    : (is_file($productionEnv) ? $productionEnv : $appRoot . DIRECTORY_SEPARATOR . '.env');

putenv('RNCO_APP_ROOT=' . $appRoot);
putenv('RNCO_ENV_FILE=' . $envFile);

$bootstrap = $appRoot . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR . 'bootstrap.php';
if (!is_file($bootstrap)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"ok":false,"error":{"code":"APP_UNAVAILABLE","message":"The store API is temporarily unavailable."}}';
    exit;
}

try {
    /** @var Rnco\App $app */
    $app = require $bootstrap;
    $request = Request::fromGlobals();
    $app->handle($request)->send();
} catch (ApiException $exception) {
    Response::error($exception->errorCode, $exception->getMessage(), $exception->status, $exception->fields)->send();
} catch (Throwable $exception) {
    error_log('[3rnco-api-bootstrap] ' . $exception::class . ': ' . $exception->getMessage());
    if (class_exists(Response::class)) {
        Response::error('INTERNAL_ERROR', 'The server could not complete this request.', 500)->send();
    }
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"ok":false,"error":{"code":"INTERNAL_ERROR","message":"The server could not complete this request."}}';
    exit;
}
