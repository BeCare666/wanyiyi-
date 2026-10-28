import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { it } from "vitest";
import { migrationFiles } from "./db";

const D = "C:/Users/PC/AppData/Local/Temp/claude/C--Users-PC-desktop-wanyiyi/1e6be83d-cb80-4ba1-8a88-5f2d7830e8c3/scratchpad/db";
const read = (f: string) => readFileSync(f, "utf8");
const shape = read(`${D}/shape.sql`);
const missing = read(`${D}/missing.txt`).trim().split(/\s+/);
const expected = JSON.parse(read(`${D}/expected.json`)).lines as string[];
const diff = (a: string[], b: string[]) => ({ missing: a.filter((x) => !b.includes(x)), extra: b.filter((x) => !a.includes(x)) });

async function scenario(prepare: (db: PGlite) => Promise<void>) {
  const db = await PGlite.create({ extensions: { citext, pgcrypto } });
  await db.exec(read(join(__dirname, "supabase-stub.sql")));
  await prepare(db);
  const now = async () => (await db.query<{ x: string }>(shape)).rows.map((r) => r.x);
  const out: Record<string, unknown> = {};
  const fix = read(`${D}/fix.sql`);
  for (const run of ["run1", "run2"]) {
    try { await db.exec(fix); out[run] = diff(expected, await now()); } catch (e) { out[run] = String(e); await db.exec("rollback").catch(() => {}); }
  }
  await db.close();
  return out;
}
const mig = (f: string) => read(join(__dirname, "..", "migrations", f));

it("rattrapage : trois états de départ", async () => {
  const report = {
    complet: await scenario(async (db) => { for (const f of migrationFiles()) await db.exec(mig(f)); }),
    au22: await scenario(async (db) => { for (const f of migrationFiles().filter((f) => f < "20261022000400")) await db.exec(mig(f)); }),
    // Comme la base : migrations manquantes sautées, celles qui échouent alors aussi
    melange: await scenario(async (db) => {
      for (const f of migrationFiles().filter((f) => !missing.includes(f))) await db.exec(mig(f)).catch(() => db.exec("rollback").catch(() => {}));
    }),
  };
  writeFileSync(`${D}/report.json`, JSON.stringify(report, null, 1));
}, 1_500_000);
