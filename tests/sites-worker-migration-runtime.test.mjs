import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Miniflare } from "miniflare";
import { readMigrationFiles } from "drizzle-orm/migrator";

const migrationFiles = [
  new URL("../drizzle/0000_rare_kabuki.sql", import.meta.url),
  new URL("../drizzle/0001_regular_lionheart.sql", import.meta.url),
  new URL("../drizzle/0002_atomic_commerce.sql", import.meta.url),
];

function idempotentMigrationStatement(statement) {
  return statement
    .replace(/^CREATE TABLE\s+/iu, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE UNIQUE INDEX\s+/iu, "CREATE UNIQUE INDEX IF NOT EXISTS ")
    .replace(/^CREATE INDEX\s+/iu, "CREATE INDEX IF NOT EXISTS ")
    .replace(/^CREATE TRIGGER\s+/iu, "CREATE TRIGGER IF NOT EXISTS ");
}

async function runtimeStatements() {
  const sources = await Promise.all(migrationFiles.map((file) => readFile(file, "utf8")));
  return sources.join("\n--> statement-breakpoint\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map(idempotentMigrationStatement);
}

test("runtime migration splitter produces complete SQLite statements", async () => {
  const statements = await runtimeStatements();
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const [index, statement] of statements.entries()) {
    assert.doesNotThrow(
      () => db.prepare(statement).run(),
      `migration statement ${index} must compile: ${statement.slice(0, 120)}`,
    );
  }
  db.close();
});

test("packaged Drizzle migrations contain no empty statements", () => {
  const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
  for (const [migrationIndex, migration] of migrations.entries()) {
    for (const [statementIndex, statement] of migration.sql.entries()) {
      assert.notEqual(
        statement.trim(),
        "",
        `migration ${migrationIndex} statement ${statementIndex} must not be empty`,
      );
    }
  }
});

test("runtime migration statements execute through the D1 prepared-statement API", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "migration-runtime-test" },
  });
  try {
    const db = await miniflare.getD1Database("DB");
    for (const [index, statement] of (await runtimeStatements()).entries()) {
      await assert.doesNotReject(
        db.prepare(statement).run(),
        `D1 migration statement ${index} must compile: ${statement.slice(0, 120)}`,
      );
    }
  } finally {
    await miniflare.dispose();
  }
});
