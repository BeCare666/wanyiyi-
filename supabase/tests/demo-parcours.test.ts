import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./db";

/**
 * Parcours de démonstration des phases 3 et 4 (parcours-demo.sql) après la soirée de
 * démonstration, puis suppression complète par supprimer-membres-demo.sql : aucun reste, aucun
 * autre compte touché.
 */

const script = (name: string) => readFileSync(join(__dirname, "..", "demo", name), "utf8");
let db: PGlite;
const realMember = "00000000-0000-0000-0000-0000000000bb";

const count = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;

beforeAll(async () => {
  db = await createDb();
  const admin = "00000000-0000-0000-0000-0000000000aa";
  await db.query("insert into auth.users (id, phone) values ($1, '+22901970999998')", [admin]);
  await db.query("update app.users set role = 'super_admin' where id = $1", [admin]);
  await db.query("insert into auth.users (id, phone) values ($1, '+22901970999997')", [realMember]);
  for (const f of ["membres-demo.sql", "soiree-demo.sql", "prestataires-demo.sql"]) await db.exec(script(f));
  // Annonce des matchs du lendemain, 8 h (tâche de l'API)
  await db.query("update app.matches set announced_at = now() - interval '1 minute'");
  await db.exec("set role service_role; select app.announce_matches(); reset role;");
}, 300_000);

afterAll(async () => {
  await db?.close();
});

describe("Parcours de démonstration (phases 3 et 4)", () => {
  it("couple, étapes, cagnotte ouverte, prestataire contacté, union, photo de l'union approuvée", async () => {
    const [w] = (await db.query<{ id: string }>(
      "select m.member_a as id from app.matches m where m.status = 'pending_choice' order by m.announced_at, m.id limit 1",
    )).rows;
    expect(w).toBeDefined();
    // Fichier de la photo déposé avant (comme par l'API de stockage)
    const { rows } = await db.query<{ woman: string }>(
      `select p.user_id as woman from app.matches m join app.member_profiles p on p.user_id in (m.member_a, m.member_b) and p.sex = 'female'
        where m.status = 'pending_choice' and m.notified_at is not null order by m.announced_at, m.id limit 1`,
    );
    await db.query("insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [`${rows[0]!.woman}/union-demo.jpg`]);
    await db.exec(script("parcours-demo.sql"));
    expect(await count("select count(*)::int as n from app.couples where status = 'union_celebrated' and memory_space")).toBe(1);
    expect(await count("select count(*)::int as n from app.cagnottes where status = 'open' and title = 'Notre mariage (démo)'")).toBe(1);
    expect(await count("select count(*)::int as n from app.union_photos where review_status = 'approved'")).toBe(1);
    expect(await count("select count(*)::int as n from app.provider_contacts")).toBe(1);
    expect(await count("select count(*)::int as n from app.payments where purpose = 'contribution'")).toBe(0);
    // Rejoué : refusé, rien de doublé
    await expect(db.exec(script("parcours-demo.sql"))).rejects.toThrow(/déjà joué/);
    await db.exec("rollback");
  });

  it("suppression : plus aucune donnée de démonstration, les autres comptes intacts", async () => {
    // Une contribution en attente (comme une contribution commencée sur la page publique)
    await db.query(
      `with p as (insert into app.payments (user_id, purpose, amount_xof, provider) values (null, 'contribution', 5000, 'feexpay') returning id)
       insert into app.contributions (cagnotte_id, contributor_name, amount_xof, payment_id) select g.id, 'Essai', 5000, p.id from app.cagnottes g, p`,
    );
    await db.exec(script("supprimer-membres-demo.sql"));
    expect(await count("select count(*)::int as n from auth.users where email like '%@demo.ifedele.invalid'")).toBe(0);
    for (const table of ["couples", "cagnottes", "contributions", "union_photos", "discoveries", "matches", "conversations", "provider_contacts"]) {
      expect(await count(`select count(*)::int as n from app.${table}`), table).toBe(0);
    }
    expect(await count("select count(*)::int as n from app.payments where purpose = 'contribution'")).toBe(0);
    expect(await count(`select count(*)::int as n from app.users where id = '${realMember}'`)).toBe(1);
    expect(await count("select count(*)::int as n from app.providers where is_demo")).toBe(8);
  });
});
