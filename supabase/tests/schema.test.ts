import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, migrationFiles } from "./db";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Schéma", () => {
  it("toutes les migrations s'exécutent", () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it("la Row Level Security est activée et forcée sur toutes les tables du schéma app", async () => {
    const { rows } = await db.query<{ relname: string; rls: boolean; forced: boolean }>(`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r'`);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => !r.rls || !r.forced).map((r) => r.relname)).toEqual([]);
  });

  it("les paramètres par défaut de la section 9 sont présents", async () => {
    const { rows } = await db.query<{ value: number }>(
      "select value from app.settings where key = 'evenings.confirmation_hours_before'",
    );
    expect(rows[0]?.value).toBe(48);
  });
});
