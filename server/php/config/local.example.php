<?php

declare(strict_types=1);

use Rnco\Config;

require_once dirname(__DIR__) . '/src/Config.php';

return Config::forTesting([
    'app.env' => 'local',
    'app.debug' => true,
    'app.origin' => 'http://127.0.0.1:8080',
    'db.database' => dirname(__DIR__) . '/runtime/local.sqlite',
    'session.secure' => false,
    'upload.dir' => dirname(__DIR__) . '/var/uploads',
    'backup.dir' => dirname(__DIR__) . '/var/backups',
]);
