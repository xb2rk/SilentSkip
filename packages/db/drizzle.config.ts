import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration — used only for `generate` (schema → SQL migration files).
 * No database credentials here: generation is offline, and the server applies committed
 * migrations at startup via `migrateDatabase()` (drizzle-orm migrator), never via CLI.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
