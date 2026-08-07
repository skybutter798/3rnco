<?php

declare(strict_types=1);

use Rnco\Config;
use Rnco\Database;
use Rnco\MaintenanceService;

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This maintenance command is CLI-only.\n");
    exit(2);
}

$root = dirname(__DIR__);
foreach (['Config', 'Database', 'Http', 'Security', 'Services'] as $file) {
    require_once $root . '/src/' . $file . '.php';
}

try {
    $configuredEnv = getenv('RNCO_ENV_FILE');
    $config = Config::fromEnvironment($configuredEnv !== false && $configuredEnv !== '' ? $configuredEnv : null);
    $database = Database::connect($config);
    $result = (new MaintenanceService($database))->cleanup();
    fwrite(STDOUT, sprintf("Removed %d stale session(s) and %d stale rate-limit bucket(s).\n", $result['sessions'], $result['rateLimits']));
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'Maintenance cleanup failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
