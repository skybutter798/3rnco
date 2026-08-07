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
const triggerFile = new URL("../worker/atomic-commerce-triggers.sql", import.meta.url);

function idempotentMigrationStatement(statement) {
  return statement
    .replace(/^CREATE TABLE(?!\s+IF\s+NOT\s+EXISTS)\s+/iu, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE UNIQUE INDEX(?!\s+IF\s+NOT\s+EXISTS)\s+/iu, "CREATE UNIQUE INDEX IF NOT EXISTS ")
    .replace(/^CREATE INDEX(?!\s+IF\s+NOT\s+EXISTS)\s+/iu, "CREATE INDEX IF NOT EXISTS ")
    .replace(/^CREATE TRIGGER(?!\s+IF\s+NOT\s+EXISTS)\s+/iu, "CREATE TRIGGER IF NOT EXISTS ");
}

function splitStatements(sources) {
  return sources.join("\n--> statement-breakpoint\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map(idempotentMigrationStatement);
}

async function runtimeStatements() {
  return splitStatements(await Promise.all(migrationFiles.map((file) => readFile(file, "utf8"))));
}

async function runtimeTriggerStatements() {
  return splitStatements([await readFile(triggerFile, "utf8")]);
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

test("packaged Drizzle migrations contain only single-statement schema SQL", () => {
  const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
  for (const [migrationIndex, migration] of migrations.entries()) {
    for (const [statementIndex, statement] of migration.sql.entries()) {
      assert.notEqual(
        statement.trim(),
        "",
        `migration ${migrationIndex} statement ${statementIndex} must not be empty`,
      );
      assert.doesNotMatch(statement, /CREATE\s+TRIGGER/iu);
      assert.ok(
        (statement.match(/;/gu) ?? []).length <= 1,
        `migration ${migrationIndex} statement ${statementIndex} must contain one SQL statement`,
      );
    }
  }
});

test("packaged schema and runtime-only triggers execute through D1 prepared statements", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "migration-runtime-test" },
  });
  try {
    const db = await miniflare.getD1Database("DB");
    const packagedMigrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
    const schemaStatements = packagedMigrations.flatMap((migration) => migration.sql);
    for (let offset = 0; offset < schemaStatements.length; offset += 50) {
      await assert.doesNotReject(
        db.batch(schemaStatements.slice(offset, offset + 50).map((statement) => db.prepare(statement))),
        `D1 schema batch at offset ${offset} must execute`,
      );
    }
    await assert.doesNotReject(
      db.batch(packagedMigrations.at(-1).sql.map((statement) => db.prepare(statement))),
      "the last schema migration must be safe to retry after a partial deployment",
    );
    const triggerStatements = await runtimeTriggerStatements();
    await assert.doesNotReject(
      db.batch(triggerStatements.map((statement) => db.prepare(statement))),
      "D1 runtime trigger batch must execute atomically",
    );
  } finally {
    await miniflare.dispose();
  }
});
