<?php

declare(strict_types=1);

use Rnco\Config;
use Rnco\Database;
use Rnco\NotificationService;

require_once dirname(__DIR__) . '/src/Config.php';
require_once dirname(__DIR__) . '/src/Database.php';
require_once dirname(__DIR__) . '/src/Security.php';
require_once dirname(__DIR__) . '/src/Notifications.php';

$configuredEnv = getenv('RNCO_ENV_FILE');
$config = Config::fromEnvironment($configuredEnv !== false && $configuredEnv !== '' ? $configuredEnv : null);
$database = Database::connect($config);
$notifications = new NotificationService($config, $database);

if (($argv[1] ?? '') === '--test') {
    $eventKey = $notifications->sendSystemTest();
    fwrite(STDOUT, "Queued {$eventKey}\n");
    exit(0);
}

$processed = $notifications->flushPending(25);
fwrite(STDOUT, "Processed {$processed} notification(s).\n");
