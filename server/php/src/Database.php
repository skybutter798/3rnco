<?php

declare(strict_types=1);

namespace Rnco;

use PDO;
use PDOException;
use Throwable;

final class Database
{
    private bool $manualSqliteTransaction = false;

    public function __construct(
        private readonly PDO $pdo,
        private readonly string $driver,
    ) {
    }

    public static function connect(Config $config): self
    {
        $driver = $config->string('db.driver');
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ];

        if ($driver === 'sqlite') {
            $database = $config->string('db.database');
            if ($database !== ':memory:') {
                $directory = dirname($database);
                if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {
                    throw new PDOException('Unable to create the SQLite database directory.');
                }
            }
            $pdo = new PDO('sqlite:' . $database, null, null, $options);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 5000');

            return new self($pdo, $driver);
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $config->string('db.host'),
            $config->int('db.port'),
            $config->string('db.database'),
        );
        if (defined('PDO::MYSQL_ATTR_INIT_COMMAND')) {
            $options[PDO::MYSQL_ATTR_INIT_COMMAND] = 'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci';
        }
        $pdo = new PDO($dsn, $config->string('db.username'), $config->string('db.password'), $options);
        $pdo->exec("SET time_zone = '+00:00'");

        return new self($pdo, $driver);
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }

    public function driver(): string
    {
        return $this->driver;
    }

    public function isMysql(): bool
    {
        return $this->driver === 'mysql';
    }

    /** @param array<string|int, mixed> $params */
    public function fetchOne(string $sql, array $params = []): ?array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /** @param array<string|int, mixed> $params @return list<array<string, mixed>> */
    public function fetchAll(string $sql, array $params = []): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return $statement->fetchAll();
    }

    /** @param array<string|int, mixed> $params */
    public function execute(string $sql, array $params = []): int
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return $statement->rowCount();
    }

    public function lastInsertId(): int
    {
        return (int) $this->pdo->lastInsertId();
    }

    public function beginImmediate(): void
    {
        if ($this->driver === 'sqlite') {
            if ($this->manualSqliteTransaction) {
                throw new PDOException('Nested SQLite transactions are not supported.');
            }
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->manualSqliteTransaction = true;
            return;
        }
        $this->pdo->beginTransaction();
    }

    /** @template T @param callable(self):T $callback @return T */
    public function transaction(callable $callback): mixed
    {
        $this->beginImmediate();
        try {
            $result = $callback($this);
            if ($this->driver === 'sqlite') {
                $this->pdo->exec('COMMIT');
                $this->manualSqliteTransaction = false;
            } else {
                $this->pdo->commit();
            }

            return $result;
        } catch (Throwable $exception) {
            if ($this->driver === 'sqlite' && $this->manualSqliteTransaction) {
                try {
                    $this->pdo->exec('ROLLBACK');
                } finally {
                    $this->manualSqliteTransaction = false;
                }
            } elseif ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }
}
