<?php

declare(strict_types=1);

namespace Rnco;

use RuntimeException;

final class Migrator
{
    public function __construct(
        private readonly Database $database,
        private readonly string $migrationRoot,
    ) {
    }

    /** @return list<string> applied migration versions */
    public function migrate(): array
    {
        $this->ensureMigrationTable();
        $directory = $this->migrationRoot . DIRECTORY_SEPARATOR . $this->database->driver();
        $files = glob($directory . DIRECTORY_SEPARATOR . '*.sql') ?: [];
        sort($files, SORT_STRING);
        $appliedNow = [];

        foreach ($files as $file) {
            $version = basename($file, '.sql');
            if ($this->database->fetchOne('SELECT version FROM schema_migrations WHERE version = ?', [$version]) !== null) {
                continue;
            }
            $sql = file_get_contents($file);
            if ($sql === false) {
                throw new RuntimeException('Unable to read migration ' . $version . '.');
            }
            foreach ($this->statements($sql) as $statement) {
                $this->database->pdo()->exec($statement);
            }
            $this->database->execute(
                'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
                [$version, Security::now()],
            );
            $appliedNow[] = $version;
        }

        if ($this->database->driver() === 'sqlite') {
            $this->database->pdo()->exec('PRAGMA optimize');
        }

        return $appliedNow;
    }

    private function ensureMigrationTable(): void
    {
        if ($this->database->isMysql()) {
            $this->database->pdo()->exec(
                'CREATE TABLE IF NOT EXISTS schema_migrations (' .
                'version VARCHAR(128) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL' .
                ') ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
            );
            return;
        }

        $this->database->pdo()->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    }

    /** @return list<string> */
    private function statements(string $sql): array
    {
        $sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;
        $parts = preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [];

        return array_values(array_filter(array_map('trim', $parts), static fn (string $part): bool => $part !== ''));
    }
}
