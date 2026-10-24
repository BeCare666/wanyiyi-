import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createMember } from "./fixtures";

/** Thèmes des soirées (questions 4 et 21, choix du 24 octobre 2026). */

let db: PGlite;
let admin: string;
let member: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Sèna", sex: "male", role: "admin" });
  member = await createMember(db, { firstName: "Kémi", sex: "female" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const save = (user: string, id: string | null, name: object, min: number | null, max: number | null, religions: string[] | null, sectors: string[] | null) =>
  asUser(db, user, async (tx) => {
    const { rows } = await tx.query<{ id: string }>("select app.save_theme($1, $2, $3::smallint, $4::smallint, $5, $6) as id", [
      id,
      JSON.stringify(name),
      min,
      max,
      religions,
      sectors,
    ]);
    await tx.exec("reset role"); // lecture de contrôle (journal réservé à la super administration)
    const theme = (await tx.query("select key, name, min_age, max_age, required_religions, sectors from app.themes where id = $1", [rows[0]!.id])).rows[0];
    const audit = (await tx.query("select action from app.audit_log where target_id = $1", [rows[0]!.id])).rows;
    return { theme, audit };
  });

describe("Thèmes des soirées", () => {
  it("thèmes de départ repris de la vitrine : âges, foi chrétienne, foi musulmane", async () => {
    const { rows } = await db.query<{ key: string; required_religions: string[] | null }>("select key, required_religions from app.themes order by key");
    expect(rows).toEqual([
      { key: "age-25-35", required_religions: null },
      { key: "age-35-45", required_religions: null },
      { key: "age-45-plus", required_religions: null },
      { key: "faith-christian", required_religions: ["catholic", "protestant_evangelical"] },
      { key: "faith-muslim", required_religions: ["muslim"] },
    ]);
  });

  it("création par l'équipe : nom repris en anglais et yoruba s'ils manquent, journalisée", async () => {
    const result = await save(admin, null, { fr: "Univers de la santé", en: "" }, null, null, null, ["health", "health"]);
    expect(result.theme).toMatchObject({
      name: { fr: "Univers de la santé", en: "Univers de la santé", yo: "Univers de la santé" },
      sectors: ["health"],
      required_religions: null,
    });
    expect((result.theme as { key: string }).key).toMatch(/^theme-/);
    expect(result.audit).toEqual([{ action: "theme.created" }]);
  });

  it("refuse un nom vide, un âge sous 18 ans ou inversé, un thème sans critère, et un membre", async () => {
    const attempt = (user: string, name: object, min: number | null, max: number | null, sectors: string[] | null = null) =>
      failure(save(user, null, name, min, max, null, sectors));
    expect(await attempt(admin, { fr: " " }, 25, 35)).toMatch(/name_required/);
    expect(await attempt(admin, { fr: "Jeunes" }, 16, 25)).toMatch(/invalid_age/);
    expect(await attempt(admin, { fr: "Inversé" }, 40, 30)).toMatch(/invalid_age/);
    expect(await attempt(admin, { fr: "Vide" }, null, null)).toMatch(/criteria_required/);
    expect(await attempt(member, { fr: "Membre" }, 25, 35)).toMatch(/forbidden/);
    // Plus d'écriture directe sur la table
    expect(await asUser(db, admin, (tx) => failure(tx.query("insert into app.themes (key) values ('direct')")))).toMatch(/row-level security|permission denied/);
  });

  it("suppression d'un thème inutilisé seulement", async () => {
    const { rows } = await db.query<{ id: string }>("select id from app.themes where key = 'age-45-plus'");
    const used = rows[0]!.id;
    await db.query("insert into app.events (starts_at, theme_id) values (now() + interval '10 days', $1)", [used]);
    const inUse = await asUser(db, admin, (tx) => failure(tx.query("select app.delete_theme($1)", [used])));
    const { rows: free } = await db.query<{ id: string }>("select id from app.themes where key = 'age-25-35'");
    const deleted = await asUser(db, admin, (tx) => failure(tx.query("select app.delete_theme($1)", [free[0]!.id])));
    const result = { inUse, deleted };
    expect(result.inUse).toMatch(/theme_in_use/);
    expect(result.deleted).toBeNull();
  });
});
