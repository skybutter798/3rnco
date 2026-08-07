<?php

declare(strict_types=1);

use Rnco\Config;

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This backup command is CLI-only.\n");
    exit(2);
}

require_once dirname(__DIR__) . '/src/Config.php';

/** @param list<string> $command */
function runToGzip(array $command, string $target, string $stderrPath): void
{
    $descriptors = [
        0 => ['file', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null', 'r'],
        1 => ['pipe', 'w'],
        2 => ['file', $stderrPath, 'a'],
    ];
    $process = proc_open($command, $descriptors, $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($process)) {
        throw new RuntimeException('Unable to start mysqldump.');
    }
    $gzip = gzopen($target, 'wb9');
    if ($gzip === false) {
        proc_terminate($process);
        proc_close($process);
        throw new RuntimeException('Unable to create the compressed database backup.');
    }
    try {
        while (!feof($pipes[1])) {
            $chunk = fread($pipes[1], 1048576);
            if ($chunk === false) {
                throw new RuntimeException('Unable to read mysqldump output.');
            }
            if ($chunk !== '' && gzwrite($gzip, $chunk) === false) {
                throw new RuntimeException('Unable to write the compressed database backup.');
            }
        }
        fclose($pipes[1]);
        gzclose($gzip);
        $exitCode = proc_close($process);
        if ($exitCode !== 0) {
            $error = is_file($stderrPath) ? trim((string) file_get_contents($stderrPath)) : '';
            throw new RuntimeException('mysqldump exited with code ' . $exitCode . ($error !== '' ? ': ' . mb_substr($error, 0, 1000) : ''));
        }
    } catch (Throwable $exception) {
        if (is_resource($pipes[1] ?? null)) {
            fclose($pipes[1]);
        }
        if (is_resource($gzip)) {
            gzclose($gzip);
        }
        if (is_resource($process)) {
            proc_terminate($process);
            proc_close($process);
        }
        throw $exception;
    }
    if (!is_file($target) || filesize($target) < 32) {
        throw new RuntimeException('The compressed database backup is unexpectedly empty.');
    }
}

/** @param list<string> $command */
function runCommand(array $command, string $stderrPath): void
{
    $descriptors = [
        0 => ['file', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null', 'r'],
        1 => ['file', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null', 'w'],
        2 => ['file', $stderrPath, 'a'],
    ];
    $process = proc_open($command, $descriptors, $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($process)) {
        throw new RuntimeException('Unable to start the archive command.');
    }
    $exitCode = proc_close($process);
    if ($exitCode !== 0) {
        $error = is_file($stderrPath) ? trim((string) file_get_contents($stderrPath)) : '';
        throw new RuntimeException('Archive command exited with code ' . $exitCode . ($error !== '' ? ': ' . mb_substr($error, 0, 1000) : ''));
    }
}

function optionValue(string $value): string
{
    if (str_contains($value, "\n") || str_contains($value, "\r")) {
        throw new RuntimeException('Database credentials may not contain newline characters.');
    }
    return '"' . addcslashes($value, "\\\"") . '"';
}

/** @return array<string,array{database:string,uploads:string,manifest:string}> */
function backupSets(string $directory): array
{
    $sets = [];
    foreach (glob($directory . DIRECTORY_SEPARATOR . '3rnco-*-database.sql.gz') ?: [] as $databaseFile) {
        if (!preg_match('/3rnco-(\d{8}T\d{6}Z)-database\.sql\.gz$/', basename($databaseFile), $match)) {
            continue;
        }
        $timestamp = $match[1];
        $prefix = $directory . DIRECTORY_SEPARATOR . '3rnco-' . $timestamp;
        $sets[$timestamp] = [
            'database' => $databaseFile,
            'uploads' => $prefix . '-uploads.tar.gz',
            'manifest' => $prefix . '-manifest.json',
        ];
    }
    krsort($sets, SORT_STRING);
    return $sets;
}

function enforceRetention(string $directory): void
{
    $sets = backupSets($directory);
    $keep = [];
    $days = [];
    $weeks = [];
    foreach ($sets as $timestamp => $files) {
        $date = DateTimeImmutable::createFromFormat('!Ymd\THis\Z', $timestamp, new DateTimeZone('UTC'));
        if ($date === false) {
            continue;
        }
        $dayKey = $date->format('Y-m-d');
        if (count($days) < 7 && !isset($days[$dayKey])) {
            $days[$dayKey] = true;
            $keep[$timestamp] = true;
        }
        $weekKey = $date->format('o-W');
        if (count($weeks) < 4 && !isset($weeks[$weekKey])) {
            $weeks[$weekKey] = true;
            $keep[$timestamp] = true;
        }
    }
    foreach ($sets as $timestamp => $files) {
        if (isset($keep[$timestamp])) {
            continue;
        }
        foreach ($files as $file) {
            if (is_file($file) && !unlink($file)) {
                throw new RuntimeException('Unable to remove expired backup ' . basename($file) . '.');
            }
        }
    }
}

$created = [];
$credentialsFile = null;
$stderrFile = null;
$lockHandle = null;

try {
    $configuredEnv = getenv('RNCO_ENV_FILE');
    $config = Config::fromEnvironment($configuredEnv !== false && $configuredEnv !== '' ? $configuredEnv : null);
    if ($config->string('db.driver') !== 'mysql') {
        throw new RuntimeException('Production backup requires DB_DRIVER=mysql.');
    }
    $backupDirectory = $config->string('backup.dir');
    $publicRoot = rtrim($config->string('app.public_root'), DIRECTORY_SEPARATOR);
    if ($backupDirectory === $publicRoot || str_starts_with($backupDirectory . DIRECTORY_SEPARATOR, $publicRoot . DIRECTORY_SEPARATOR)) {
        throw new RuntimeException('BACKUP_DIR must be outside the public document root.');
    }
    if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0700, true) && !is_dir($backupDirectory)) {
        throw new RuntimeException('Unable to create the private backup directory.');
    }
    chmod($backupDirectory, 0700);
    $lockHandle = fopen($backupDirectory . DIRECTORY_SEPARATOR . '.backup.lock', 'c');
    if ($lockHandle === false || !flock($lockHandle, LOCK_EX | LOCK_NB)) {
        throw new RuntimeException('Another backup is already running.');
    }

    $credentialsFile = tempnam(sys_get_temp_dir(), 'rnco-mysql-');
    $stderrFile = tempnam(sys_get_temp_dir(), 'rnco-backup-');
    if ($credentialsFile === false || $stderrFile === false) {
        throw new RuntimeException('Unable to create protected temporary files.');
    }
    $credentials = "[client]\n" .
        'host=' . optionValue($config->string('db.host')) . "\n" .
        'port=' . $config->int('db.port') . "\n" .
        'user=' . optionValue($config->string('db.username')) . "\n" .
        'password=' . optionValue($config->string('db.password')) . "\n" .
        "default-character-set=utf8mb4\n";
    if (file_put_contents($credentialsFile, $credentials, LOCK_EX) === false) {
        throw new RuntimeException('Unable to write protected MySQL credentials.');
    }
    chmod($credentialsFile, 0600);

    $timestamp = gmdate('Ymd\THis\Z');
    $prefix = $backupDirectory . DIRECTORY_SEPARATOR . '3rnco-' . $timestamp;
    $databaseBackup = $prefix . '-database.sql.gz';
    $uploadsBackup = $prefix . '-uploads.tar.gz';
    $manifestFile = $prefix . '-manifest.json';
    $created = [$databaseBackup, $uploadsBackup, $manifestFile];

    runToGzip([
        $config->string('backup.mysqldump'), '--defaults-extra-file=' . $credentialsFile, '--single-transaction', '--quick',
        '--skip-lock-tables', '--skip-triggers', '--hex-blob', '--default-character-set=utf8mb4', '--databases', $config->string('db.database'),
    ], $databaseBackup, $stderrFile);

    $uploadDirectory = $config->string('backup.upload_dir');
    if (!is_dir($uploadDirectory)) {
        throw new RuntimeException('Configured upload directory does not exist.');
    }
    runCommand([
        $config->string('backup.tar'), '-C', dirname($uploadDirectory), '-czf', $uploadsBackup, basename($uploadDirectory),
    ], $stderrFile);
    if (!is_file($uploadsBackup) || filesize($uploadsBackup) < 32) {
        throw new RuntimeException('The uploads archive is unexpectedly empty.');
    }

    $manifest = [
        'createdAt' => gmdate('c'),
        'database' => ['file' => basename($databaseBackup), 'bytes' => filesize($databaseBackup), 'sha256' => hash_file('sha256', $databaseBackup)],
        'uploads' => ['file' => basename($uploadsBackup), 'bytes' => filesize($uploadsBackup), 'sha256' => hash_file('sha256', $uploadsBackup)],
    ];
    if (file_put_contents($manifestFile, json_encode($manifest, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n", LOCK_EX) === false) {
        throw new RuntimeException('Unable to write the backup manifest.');
    }
    chmod($databaseBackup, 0600);
    chmod($uploadsBackup, 0600);
    chmod($manifestFile, 0600);
    enforceRetention($backupDirectory);

    fwrite(STDOUT, 'Backup completed: ' . basename($manifestFile) . "\n");
    exit(0);
} catch (Throwable $exception) {
    foreach ($created as $file) {
        if (is_file($file)) {
            @unlink($file);
        }
    }
    fwrite(STDERR, 'Backup failed: ' . $exception->getMessage() . "\n");
    exit(1);
} finally {
    if (is_string($credentialsFile) && is_file($credentialsFile)) {
        @unlink($credentialsFile);
    }
    if (is_string($stderrFile) && is_file($stderrFile)) {
        @unlink($stderrFile);
    }
    if (is_resource($lockHandle)) {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}
