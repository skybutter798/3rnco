import migrationSql from "../drizzle/0000_rare_kabuki.sql?raw";
import authRateLimitMigration from "../drizzle/0001_regular_lionheart.sql?raw";
import atomicCommerceMigration from "../drizzle/0002_atomic_commerce.sql?raw";
import staffManualPaymentsMigration from "../drizzle/0003_staff_manual_payments.sql?raw";
import atomicCommerceTriggers from "./atomic-commerce-triggers.sql?raw";
import { seedProductionDatabase } from "./seed";

const SCHEMA_VERSION = "4";
const COMMERCE_TRIGGER_VERSION = "1";
const RESERVATION_TTL_SECONDS = 24 * 60 * 60;
const initializationByDatabase = new WeakMap<object, Promise<void>>();
const lastMaintenanceByDatabase = new WeakMap<object, number>();

function idempotentMigrationStatement(statement: string): string {
  return statement
    .replace(/^CREATE TABLE(?!\s+IF\s+NOT\s+EXISTS)\s+/iu, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE UNIQUE INDEX(?!\s+IF\s+NOT\s+EXISTS)\s+/iu, "CREATE UNIQUE INDEX IF NOT EXISTS ")
    .replace(/^CREATE INDEX(?!\s+IF\s+NOT\s+EXISTS)\s+/iu, "CREATE INDEX IF NOT EXISTS ")
    .replace(/^CREATE TRIGGER(?!\s+IF\s+NOT\s+EXISTS)\s+/iu, "CREATE TRIGGER IF NOT EXISTS ");
}

function splitMigrationSql(...sources: string[]): string[] {
  return sources.join("\n--> statement-breakpoint\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map(idempotentMigrationStatement);
}

export function getMigrationStatements(): string[] {
  return splitMigrationSql(migrationSql, authRateLimitMigration, atomicCommerceMigration, staffManualPaymentsMigration);
}

export function getTriggerStatements(): string[] {
  return splitMigrationSql(atomicCommerceTriggers);
}

async function initializeDatabase(db: D1Database): Promise<void> {
  const schemaVersion = await db.prepare(
    "SELECT value FROM app_state WHERE key = 'schema_version'",
  ).first<{ value: string }>().catch(() => null);

  if (schemaVersion?.value !== SCHEMA_VERSION) {
    const statements = getMigrationStatements().map((statement) => db.prepare(statement));
    for (let offset = 0; offset < statements.length; offset += 50) {
      await db.batch(statements.slice(offset, offset + 50));
    }
    await db.prepare(`INSERT INTO app_state (key, value, updated_at)
      VALUES ('schema_version', ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`)
      .bind(SCHEMA_VERSION).run();
  }

  const triggerVersion = await db.prepare(
    "SELECT value FROM app_state WHERE key = 'commerce_trigger_version'",
  ).first<{ value: string }>();
  if (triggerVersion?.value !== COMMERCE_TRIGGER_VERSION) {
    await db.batch([
      ...getTriggerStatements().map((statement) => db.prepare(statement)),
      db.prepare(`INSERT INTO app_state (key, value, updated_at)
        VALUES ('commerce_trigger_version', ?, unixepoch())
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`)
        .bind(COMMERCE_TRIGGER_VERSION),
    ]);
  }

  await seedProductionDatabase(db);
}

export async function ensureDatabase(db: D1Database): Promise<void> {
  let initialization = initializationByDatabase.get(db as object);
  if (!initialization) {
    initialization = initializeDatabase(db);
    initializationByDatabase.set(db as object, initialization);
    initialization.catch(() => initializationByDatabase.delete(db as object));
  }
  await initialization;
}

export async function runDatabaseMaintenance(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const lastRun = lastMaintenanceByDatabase.get(db as object) ?? 0;
  if (now - lastRun < 60) return;
  lastMaintenanceByDatabase.set(db as object, now);
  try {
    await db.batch([
      db.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = unixepoch()
        WHERE status = 'PENDING_PAYMENT' AND payment_status = 'PENDING'
          AND placed_at <= ?`).bind(now - RESERVATION_TTL_SECONDS),
      db.prepare("DELETE FROM idempotency_keys WHERE expires_at <= ?").bind(now),
      db.prepare("DELETE FROM auth_rate_limits WHERE updated_at <= ? AND COALESCE(blocked_until, 0) <= ?")
        .bind(now - 24 * 60 * 60, now),
      db.prepare(`DELETE FROM user_sessions
        WHERE (revoked_at IS NOT NULL AND revoked_at <= ?)
           OR absolute_expires_at <= ?`).bind(now - 30 * 24 * 60 * 60, now - 7 * 24 * 60 * 60),
    ]);
  } catch (error) {
    lastMaintenanceByDatabase.delete(db as object);
    throw error;
  }
}

export async function allRows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function batchInChunks(
  db: D1Database,
  statements: D1PreparedStatement[],
  chunkSize = 75,
): Promise<D1Result<unknown>[]> {
  const results: D1Result<unknown>[] = [];
  for (let offset = 0; offset < statements.length; offset += chunkSize) {
    results.push(...await db.batch(statements.slice(offset, offset + chunkSize)));
  }
  return results;
}
