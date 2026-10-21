import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";

/**
 * Membres de démonstration (décision du 21 octobre 2026) : 10 femmes et 10 hommes vérifiés,
 * sans mot de passe, supprimables d'un coup sans toucher aux vrais comptes.
 */

const script = (name: string) => readFileSync(join(__dirname, "..", "demo", name), "utf8");

let db: PGlite;

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

describe("Membres de démonstration", () => {
  it("création : 10 femmes et 10 hommes vérifiés, sans mot de passe, journalisés ; refusée une seconde fois", async () => {
    await db.exec(script("membres-demo.sql"));
    const rows = await demoMembers();
    expect(rows.filter((r) => r.sex === "female")).toHaveLength(10);
    expect(rows.filter((r) => r.sex === "male")).toHaveLength(10);
    for (const r of rows) {
      expect(r).toMatchObject({ status: "verified", journey_stage: "evenings", encrypted_password: "", verification: "approved", consent: true });
      expect(r.member_number).toMatch(/^W\d{6}$/);
    }
    const audited = await db.query("select 1 from app.audit_log where action = 'member.demo_created'");
    expect(audited.rows).toHaveLength(20);

    expect(await failure(db.exec(script("membres-demo.sql")))).toMatch(/déjà présents/);
    await db.exec("rollback");
    expect(await demoMembers()).toHaveLength(20);
  });

  it("suppression : seuls les membres de démonstration disparaissent, liens nettoyés, journal conservé", async () => {
    const real = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, $2)", [real, `${real}@exemple.test`]);
    const [demo] = (await db.query<{ id: string }>("select id from auth.users where email = 'demo-f01@demo.ifedele.invalid'")).rows;
    // Liens sans suppression en cascade : signalements dans les deux sens, action journalisée
    await db.query("insert into app.reports (reporter_id, reported_user_id, reason) values ($1, $2, 'test'), ($2, $1, 'test')", [real, demo!.id]);
    await db.query("insert into app.audit_log (actor_id, action) values ($1, 'test.demo_actor')", [demo!.id]);

    await db.exec(script("supprimer-membres-demo.sql"));

    expect(await demoMembers()).toHaveLength(0);
    expect((await db.query("select 1 from app.users where id = $1", [real])).rows).toHaveLength(1);
    expect((await db.query("select 1 from app.reports")).rows).toHaveLength(0);
    expect((await db.query<{ actor_id: string | null }>("select actor_id from app.audit_log where action = 'test.demo_actor'")).rows).toEqual([{ actor_id: null }]);
    expect((await db.query("select 1 from app.audit_log where action = 'member.demo_created'")).rows).toHaveLength(20);
    const [deleted] = (await db.query<{ details: { count: number } }>("select details from app.audit_log where action = 'member.demo_deleted'")).rows;
    expect(deleted?.details.count).toBe(20);
  });
});
