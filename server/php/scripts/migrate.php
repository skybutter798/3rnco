<?php

declare(strict_types=1);

use Rnco\Config;
use Rnco\Database;
use Rnco\Migrator;
use Rnco\Seeder;

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This migration command is CLI-only.\n");
    exit(2);
}

require_once dirname(__DIR__) . '/src/Config.php';
require_once dirname(__DIR__) . '/src/Database.php';
require_once dirname(__DIR__) . '/src/Http.php';
require_once dirname(__DIR__) . '/src/Security.php';
require_once dirname(__DIR__) . '/src/Migrator.php';
require_once dirname(__DIR__) . '/src/Seeder.php';

try {
    $configuredEnv = getenv('RNCO_ENV_FILE');
    $config = Config::fromEnvironment($configuredEnv !== false && $configuredEnv !== '' ? $configuredEnv : null);
    $database = Database::connect($config);
    $migrator = new Migrator($database, dirname(__DIR__) . '/database/migrations');
    $applied = $migrator->migrate();
    fwrite(STDOUT, $applied === [] ? "Database already current.\n" : 'Applied: ' . implode(', ', $applied) . "\n");
    if (in_array('--seed', $argv, true)) {
        $counts = (new Seeder($database))->seed();
        fwrite(STDOUT, 'Seeded missing records: ' . json_encode($counts, JSON_THROW_ON_ERROR) . "\n");
    }
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'Migration failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
