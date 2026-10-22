import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createMember } from "./fixtures";

/**
 * Membres de démonstration (décision du 21 octobre 2026, 4 de plus le 22 octobre) : 12 femmes et
 * 12 hommes vérifiés, sans mot de passe ; soirée de démonstration jouée avec eux (étape 6) ;
 * le tout supprimable d'un coup sans toucher aux vrais comptes ni aux vraies soirées.
 */

const script = (name: string) => readFileSync(join(__dirname, "..", "demo", name), "utf8");

let db: PGlite;
let superAdmin: string;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

type DemoRow = { sex: string; status: string; journey_stage: string; member_number: string; encrypted_password: string; verification: string; consent: boolean };

const demoMembers = async () =>
  (
    await db.query<DemoRow>(
      `select p.sex, p.status, p.journey_stage, u.member_number, a.encrypted_password,
              v.status as verification, u.consent_at is not null as consent
       from auth.users a
       join app.users u on u.id = a.id
       join app.member_profiles p on p.user_id = a.id
       join app.verifications v on v.user_id = a.id
       where a.email like '%@demo.ifedele.invalid'`,
    )
  ).rows;

const demoAccounts = async () =>
  (await db.query<{ email: string; id: string }>("select email, id from auth.users where email like '%@demo.ifedele.invalid' order by email")).rows;

describe("Membres de démonstration", () => {
  it("création : 12 femmes et 12 hommes vérifiés, sans mot de passe, journalisés ; refusée une seconde fois", async () => {
    await db.exec(script("membres-demo.sql"));
    const rows = await demoMembers();
    expect(rows.filter((r) => r.sex === "female")).toHaveLength(12);
    expect(rows.filter((r) => r.sex === "male")).toHaveLength(12);
    for (const r of rows) {
      expect(r).toMatchObject({ status: "verified", journey_stage: "evenings", encrypted_password: "", verification: "approved", consent: true });
      expect(r.member_number).toMatch(/^W\d{6}$/);
    }
    const audited = await db.query("select 1 from app.audit_log where action = 'member.demo_created'");
    expect(audited.rows).toHaveLength(24);

    expect(await failure(db.exec(script("membres-demo.sql")))).toMatch(/déjà présents/);
    await db.exec("rollback");
    expect(await demoMembers()).toHaveLength(24);
  });

  it("base déjà dotée des 20 premiers : une nouvelle exécution n'ajoute que les 4 manquants", async () => {
    const extra = ["demo-f11", "demo-f12", "demo-h11", "demo-h12"].map((h) => `${h}@demo.ifedele.invalid`);
    const before = await demoAccounts();
    await db.query("delete from auth.users where email = any($1)", [extra]);
    expect(await demoMembers()).toHaveLength(20);
    await db.exec(script("membres-demo.sql"));
    const after = await demoAccounts();
    expect(after).toHaveLength(24);
    // Les 20 comptes existants sont gardés tels quels
    const kept = (list: Array<{ email: string; id: string }>) => list.filter((u) => !extra.includes(u.email));
    expect(kept(after)).toEqual(kept(before));
  });

  it("soirée de démonstration : 10 × 10 jouée de bout en bout, liste d'attente, 200 votes, matchs le lendemain à 8 h", async () => {
    expect(await failure(db.exec(script("soiree-demo.sql")))).toMatch(/super administrateur/);
    await db.exec("rollback");
    superAdmin = await createMember(db, { firstName: "Équipe", sex: "female", role: "super_admin" });

    await db.exec(script("soiree-demo.sql"));
    const [event] = (
      await db.query<{ id: string; status: string; price_xof: number; announce: Date }>(
        `select e.id, e.status, e.price_xof, app.match_announcement_at(e.starts_at) as announce
         from app.events e join app.venues v on v.id = e.venue_id where v.name = 'Lieu de démonstration (fictif)'`,
      )
    ).rows;
    expect(event).toMatchObject({ status: "finished", price_xof: 10000 });
    const count = async (sql: string) => (await db.query<{ n: number }>(sql, [event!.id])).rows[0]!.n;
    expect(await count("select count(*)::int as n from app.event_registrations where event_id = $1 and status = 'checked_in'")).toBe(20);
    expect(await count("select count(*)::int as n from app.event_registrations where event_id = $1 and status = 'cancelled'")).toBe(2);
    expect(await count("select count(*)::int as n from app.waitlist_entries where event_id = $1")).toBe(2);
    expect(
      await count(
        "select count(*)::int as n from app.payments p join app.event_registrations r on r.payment_id = p.id where r.event_id = $1 and p.status = 'succeeded' and p.provider = 'simulated'",
      ),
    ).toBe(20);
    expect(
      await count("select count(*)::int as n from app.votes v join app.round_pairings p on p.id = v.pairing_id join app.rounds r on r.id = p.round_id where r.event_id = $1"),
    ).toBe(200);

    // Matchs attendus selon la règle du script, parmi les présents : femmes n° 1 à 11 sauf la n° 4
    // (annulation, place donnée à la n° 11), hommes n° 1 à 11 sauf le n° 6
    const present = (k: number, cancelled: number) => k !== cancelled && k <= 11;
    let expected = 0;
    for (let i = 1; i <= 12; i++) for (let j = 1; j <= 12; j++) if (present(i, 4) && present(j, 6) && (i + j) % 4 === 0) expected += 1;
    const matches = (await db.query<{ announced_at: Date }>("select announced_at from app.matches where event_id = $1", [event!.id])).rows;
    expect(matches).toHaveLength(expected);
    expect(matches.every((m) => new Date(m.announced_at).getTime() === new Date(event!.announce).getTime())).toBe(true);
    expect(new Date(event!.announce).getTime()).toBeGreaterThan(Date.now());
    // Actions de l'équipe journalisées au nom du super administrateur
    expect((await db.query("select 1 from app.audit_log where actor_id = $1", [superAdmin])).rows.length).toBeGreaterThan(0);

    expect(await failure(db.exec(script("soiree-demo.sql")))).toMatch(/déjà présente/);
    await db.exec("rollback");
  });

  it("suppression : seuls les membres et la soirée de démonstration disparaissent, liens nettoyés, journal conservé", async () => {
    const real = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, $2)", [real, `${real}@exemple.test`]);
    const [demo] = (await db.query<{ id: string }>("select id from auth.users where email = 'demo-f01@demo.ifedele.invalid'")).rows;
    // Liens sans suppression en cascade : signalements dans les deux sens, action journalisée
    await db.query("insert into app.reports (reporter_id, reported_user_id, reason) values ($1, $2, 'test'), ($2, $1, 'test')", [real, demo!.id]);
    await db.query("insert into app.audit_log (actor_id, action) values ($1, 'test.demo_actor')", [demo!.id]);

    await db.exec(script("supprimer-membres-demo.sql"));

    expect(await demoMembers()).toHaveLength(0);
    expect((await db.query("select 1 from app.users where id = $1", [real])).rows).toHaveLength(1);
    expect((await db.query("select 1 from app.users where id = $1", [superAdmin])).rows).toHaveLength(1);
    expect((await db.query("select 1 from app.venues where name = 'Lieu de démonstration (fictif)'")).rows).toHaveLength(0);
    expect((await db.query("select 1 from app.events")).rows).toHaveLength(0);
    expect((await db.query("select 1 from app.matches")).rows).toHaveLength(0);
    expect((await db.query("select 1 from app.payments")).rows).toHaveLength(0);
    expect((await db.query("select 1 from app.reports")).rows).toHaveLength(0);
    expect((await db.query<{ actor_id: string | null }>("select actor_id from app.audit_log where action = 'test.demo_actor'")).rows).toEqual([{ actor_id: null }]);
    // 24 créations, puis 4 recréations dans le deuxième test
    expect((await db.query("select 1 from app.audit_log where action = 'member.demo_created'")).rows).toHaveLength(28);
    const [deleted] = (await db.query<{ details: { count: number } }>("select details from app.audit_log where action = 'member.demo_deleted'")).rows;
    expect(deleted?.details.count).toBe(24);
  });
});
