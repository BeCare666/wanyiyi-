import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Prestataires (phase 4, question 2 validée le 27 octobre 2026) : vitrine sans coordonnées,
 * coordonnées pour les couples, « J'ai contacté » compté une fois, démo masquable, administration
 * (création, contrôles, désactivation, image, catégories, liste filtrable).
 */

let db: PGlite;
const p: Record<string, string> = {};

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

async function couple(a: string, b: string, status: string) {
  const event = await createEvent(db, { startsInHours: -48, status: "finished" });
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now(), 'continued') returning id", [m.id]);
  await db.query(
    "insert into app.couples (discovery_id, member_a, member_b, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), $4::app.couple_status)",
    [d.id, a, b, status],
  );
}

const save = (user: string, args: unknown[]) =>
  as<{ id: string }>(user, "select app.admin_save_provider($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id", args).then((r) => r[0]!.id);

const description = JSON.stringify({ fr: "Cuisine béninoise pour les grandes fêtes", en: "Beninese food for large celebrations" });

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["seule", "female", "member"],
    ["admin", "female", "admin"],
    ["moderatrice", "female", "moderator"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  await couple(p.afiwa!, p.koffi!, "union_celebrated");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Prestataires (question 2)", () => {
  let traiteur: string;
  let demo: string;

  it("création par l'administration seulement, champs contrôlés", async () => {
    const args = [null, "Saveurs de Ouidah", "caterer", description, "+229 01 97 00 00 01", null, "Cotonou", "Fidjrossè", "À partir de 150 000 FCFA", false];
    expect(await failure(save(p.moderatrice!, args))).toMatch(/forbidden/);
    expect(await failure(save(p.admin!, [null, "", ...args.slice(2)]))).toMatch(/name_required/);
    expect(await failure(save(p.admin!, [null, "X", "fleuriste", ...args.slice(3)]))).toMatch(/invalid_category/);
    expect(await failure(save(p.admin!, [null, "X", "caterer", JSON.stringify({ en: "only english" }), ...args.slice(4)]))).toMatch(/description_required/);
    expect(await failure(save(p.admin!, [...args.slice(0, 4), null, null, ...args.slice(6)]))).toMatch(/contact_required/);
    expect(await failure(save(p.admin!, [...args.slice(0, 4), "abc", ...args.slice(5)]))).toMatch(/invalid_phone/);
    traiteur = await save(p.admin!, args);
    demo = await save(p.admin!, [null, "Studio démo (fictif)", "photographer", JSON.stringify({ fr: "Démo" }), null, "+22901970000", "Porto-Novo", null, null, true]);
    const [row] = await as<{ phone: string; description: Record<string, string> }>(p.admin!, "select * from app.admin_provider($1)", [traiteur]);
    expect(row!.phone).toBe("+2290197000001");
    expect(row!.description).toEqual({ fr: "Cuisine béninoise pour les grandes fêtes", en: "Beninese food for large celebrations" });
  });

  it("vitrine sans compte : sans coordonnées, démo seulement si demandée", async () => {
    const rows = await asAnon(db, async (tx) => (await tx.query<Record<string, unknown>>("select * from app.public_providers(false)")).rows);
    expect(rows.map((r) => r.name)).toEqual(["Saveurs de Ouidah"]);
    expect(Object.keys(rows[0]!)).not.toContain("phone");
    const withDemo = await asAnon(db, async (tx) => (await tx.query<{ name: string }>("select * from app.public_providers(true)")).rows);
    expect(withDemo).toHaveLength(2);
    expect(await asAnon(db, (tx) => failure(tx.query("select * from app.providers")))).toMatch(/permission denied/);
    expect(await asAnon(db, (tx) => failure(tx.query("select * from app.member_providers()")))).toMatch(/permission denied|not_in_couple/);
  });

  it("coordonnées complètes pour un couple ou une union ; « J'ai contacté » compté une fois", async () => {
    expect(await failure(as(p.seule!, "select * from app.member_providers()"))).toMatch(/not_in_couple/);
    expect(await failure(as(p.seule!, "select app.mark_provider_contacted($1)", [traiteur]))).toMatch(/not_in_couple/);
    const [row] = await as<{ phone: string; district: string; i_contacted: boolean }>(p.afiwa!, "select * from app.member_providers()");
    expect(row).toMatchObject({ phone: "+2290197000001", district: "Fidjrossè", i_contacted: false });
    await as(p.afiwa!, "select app.mark_provider_contacted($1)", [traiteur]);
    await as(p.afiwa!, "select app.mark_provider_contacted($1)", [traiteur]);
    await as(p.koffi!, "select app.mark_provider_contacted($1)", [traiteur]);
    expect((await as<{ i_contacted: boolean }>(p.afiwa!, "select * from app.member_providers()"))[0]!.i_contacted).toBe(true);
    expect((await as<{ contacts: number }>(p.admin!, "select * from app.admin_provider($1)", [traiteur]))[0]!.contacts).toBe(2);
    expect(await failure(as(p.afiwa!, "select * from app.provider_contacts"))).toBeNull();
    expect(await as(p.afiwa!, "select * from app.provider_contacts")).toEqual([]);
  });

  it("désactivé : masqué partout ; image Cloudinary seulement", async () => {
    await as(p.admin!, "select app.admin_set_provider_active($1, false)", [traiteur]);
    expect(await as(p.afiwa!, "select * from app.member_providers()")).toEqual([]);
    expect(await failure(as(p.afiwa!, "select app.mark_provider_contacted($1)", [traiteur]))).toMatch(/not_found/);
    await as(p.admin!, "select app.admin_set_provider_active($1, true)", [traiteur]);
    expect(await failure(as(p.admin!, "select app.admin_set_provider_image($1, 'x', 'https://exemple.com/x.jpg')", [traiteur]))).toMatch(/invalid_image/);
    const [first] = await as<{ old: string | null }>(p.admin!, "select app.admin_set_provider_image($1, 'ifedele/p1', 'https://res.cloudinary.com/demo/image/upload/ifedele/p1.jpg') as old", [traiteur]);
    expect(first!.old).toBeNull();
    const [second] = await as<{ old: string | null }>(p.admin!, "select app.admin_set_provider_image($1, 'ifedele/p2', 'https://res.cloudinary.com/demo/image/upload/ifedele/p2.jpg') as old", [traiteur]);
    expect(second!.old).toBe("ifedele/p1");
  });

  it("catégories modifiables par l'administration ; une catégorie inactive masque ses prestataires", async () => {
    expect(await failure(as(p.moderatrice!, "select app.admin_save_provider_category('henne', '{\"fr\": \"Henné\"}', 7, true)"))).toMatch(/forbidden/);
    expect(await failure(as(p.admin!, "select app.admin_save_provider_category('Henné', '{\"fr\": \"Henné\"}', 7, true)"))).toMatch(/invalid_key/);
    await as(p.admin!, "select app.admin_save_provider_category('henne', '{\"fr\": \"Henné\", \"en\": \"Henna\"}', 7, true)");
    await as(p.admin!, "select app.admin_save_provider_category('photographer', '{\"fr\": \"Photographes\"}', 3, false)");
    const names = await asAnon(db, async (tx) => (await tx.query<{ name: string }>("select * from app.public_providers(true)")).rows.map((r) => r.name));
    expect(names).toEqual(["Saveurs de Ouidah"]);
    expect(demo).toBeDefined();
  });

  it("liste filtrable de l'administration (providers.manage)", async () => {
    const list = (user: string, filter: unknown) =>
      as<{ row: { name: string; contacts: number } }>(user, "select r as row from app.admin_list('providers', $1, null, 50, 0) r", [JSON.stringify(filter)]);
    expect(await failure(list(p.moderatrice!, null))).toMatch(/forbidden/);
    const demoOnly = await list(p.admin!, { field: "is_demo", cmp: "is", value: true });
    expect(demoOnly.map((r) => r.row.name)).toEqual(["Studio démo (fictif)"]);
    const contacted = await list(p.admin!, { field: "contacts", cmp: "between", value: [1, null] });
    expect(contacted.map((r) => [r.row.name, r.row.contacts])).toEqual([["Saveurs de Ouidah", 2]]);
  });
});

describe("Prestataires de démonstration (question 2 e)", () => {
  const script = (name: string) => readFileSync(join(__dirname, "..", "demo", name), "utf8");

  it("8 prestataires, 2 par catégorie de la vitrine, ré-exécutable, puis supprimés seuls", async () => {
    await db.exec(script("prestataires-demo.sql"));
    await db.exec(script("prestataires-demo.sql"));
    const rows = (await db.query<{ category: string; n: number }>(
      "select category, count(*)::int as n from app.providers where is_demo and name like '%(démo)' group by category order by category",
    )).rows;
    expect(rows).toEqual([
      { category: "caterer", n: 2 },
      { category: "photographer", n: 2 },
      { category: "reception_venue", n: 2 },
      { category: "tailor", n: 2 },
    ]);
    await db.exec(script("supprimer-prestataires-demo.sql"));
    expect((await one<{ n: number }>("select count(*)::int as n from app.providers where is_demo")).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from app.providers")).n).toBe(1);
  });
});
