<?php

declare(strict_types=1);

use Rnco\Config;
use Rnco\Database;
use Rnco\OrderService;
use Rnco\ReferralService;
use Rnco\StoreRepository;

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This reservation-release command is CLI-only.\n");
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
    $limit = 100;
    foreach ($argv as $argument) {
        if (str_starts_with($argument, '--limit=')) {
            $value = substr($argument, 8);
            if (!ctype_digit($value) || (int) $value < 1 || (int) $value > 1000) {
                throw new InvalidArgumentException('--limit must be an integer between 1 and 1000.');
            }
            $limit = (int) $value;
        }
    }
    $released = (new OrderService($database, new StoreRepository($database), $config, new ReferralService($database)))->releaseExpiredReservations($limit);
    fwrite(STDOUT, sprintf("Released %d expired order reservation(s).\n", $released));
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'Reservation release failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
