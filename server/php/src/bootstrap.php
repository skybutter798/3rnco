<?php

declare(strict_types=1);

use Rnco\App;
use Rnco\Config;
use Rnco\Database;

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Http.php';
require_once __DIR__ . '/Security.php';
require_once __DIR__ . '/Migrator.php';
require_once __DIR__ . '/Seeder.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Notifications.php';
require_once __DIR__ . '/Services.php';
require_once __DIR__ . '/Controllers.php';
require_once __DIR__ . '/App.php';

$configuredEnvFile = getenv('RNCO_ENV_FILE');
$config = Config::fromEnvironment($configuredEnvFile !== false && $configuredEnvFile !== '' ? $configuredEnvFile : null);
$database = Database::connect($config);

return new App($config, $database);
