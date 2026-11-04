import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, failure } from "./db";
import { createMember } from "./fixtures";

/**
 * Notifications sur le téléphone (décisions du 04/11/2026) : le membre abonne lui-même son
 * appareil ; chaque nouvelle notification part sur chacun de ses appareils ; un appareil
 * disparu (404/410) est retiré ; un compte supprimé n'a plus d'appareil.
 */

let db: PGlite;
let afiwa: string;
let codjo: string;

const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/appareil-${n}`;

beforeAll(async () => {
  db = await createDb();
  afiwa = await createMember(db, { firstName: "Afiwa", sex: "female" });
  codjo = await createMember(db, { firstName: "Codjo", sex: "male" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** Abonnement validé (hors transaction annulée) au nom du membre. */
async function subscribe(user: string, n: number) {
  await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    await tx.query("select app.save_push_subscription($1, 'cle-p256dh', 'cle-auth', 'Android')", [endpoint(n)]);
  });
}

const notify = (user: string, kind: string) => db.query("select app.notify_with_deliveries($1, $2, '{}'::jsonb)", [user, kind]);

const pending = () =>
  asService(db, async (tx) => (await tx.query<{ delivery_id: string; endpoint: string; locale: string }>("select * from app.pending_push_deliveries(100)")).rows);

describe("Notifications sur le téléphone", () => {
  it("sans appareil abonné : aucun envoi sur le téléphone", async () => {
    await notify(afiwa, "registration.completed");
    expect(await pending()).toHaveLength(0);
  });

  it("le membre abonne ses appareils ; il ne voit que les siens, et ne peut pas écrire directement", async () => {
    await subscribe(afiwa, 1);
    await subscribe(afiwa, 2);
    await subscribe(codjo, 3);
    const mine = await asUser(db, afiwa, async (tx) => (await tx.query<{ endpoint: string }>("select endpoint from app.push_subscriptions order by endpoint")).rows);
    expect(mine.map((r) => r.endpoint)).toEqual([endpoint(1), endpoint(2)]);
    const direct = await asUser(db, afiwa, (tx) =>
      failure(tx.query("insert into app.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'a', 'b')", [codjo, endpoint(9)])),
    );
    expect(direct).toMatch(/permission denied/);
    const insecure = await asUser(db, afiwa, (tx) => failure(tx.query("select app.save_push_subscription($1, 'a', 'b')", ["http://pas-https"])));
    expect(insecure).toMatch(/check constraint/);
  });

  it("chaque nouvelle notification part sur chaque appareil du membre, dans sa langue", async () => {
    await notify(afiwa, "verification.submitted");
    const rows = await pending();
    expect(rows.map((r) => r.endpoint).sort()).toEqual([endpoint(1), endpoint(2)]);
    expect(rows.every((r) => r.locale === "fr")).toBe(true);
  });

  it("envoi réussi, puis appareil disparu (410) : abonnement retiré avec ses envois", async () => {
    const [first, second] = await pending();
    await db.exec("set role service_role");
    await db.query("select app.mark_push_delivery($1, true)", [first!.delivery_id]);
    await db.query("select app.mark_push_delivery($1, false, 'Gone', true)", [second!.delivery_id]);
    await db.exec("reset role");
    expect(await pending()).toHaveLength(0);
    const left = (await db.query<{ endpoint: string }>("select endpoint from app.push_subscriptions where user_id = $1", [afiwa])).rows;
    expect(left).toHaveLength(1);
  });

  it("échec passager : retenté, puis abandonné après 5 essais", async () => {
    await notify(codjo, "registration.completed");
    const [delivery] = await pending();
    await db.exec("set role service_role");
    for (let i = 0; i < 5; i++) await db.query("select app.mark_push_delivery($1, false, 'Erreur réseau')", [delivery!.delivery_id]);
    await db.exec("reset role");
    expect(await pending()).toHaveLength(0);
    const status = (await db.query<{ status: string; attempts: number }>("select status, attempts from app.push_deliveries where id = $1", [delivery!.delivery_id])).rows[0];
    expect(status).toEqual({ status: "failed", attempts: 5 });
  });

  it("les envois ne sont lisibles ni par les membres, ni appelables par eux", async () => {
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select * from app.push_deliveries")))).toMatch(/permission denied/);
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select * from app.pending_push_deliveries(10)")))).toMatch(/permission denied/);
  });

  it("désabonnement : seulement son propre appareil", async () => {
    await asUser(db, afiwa, (tx) => tx.query("select app.remove_push_subscription($1)", [endpoint(3)]));
    expect((await db.query("select 1 from app.push_subscriptions where endpoint = $1", [endpoint(3)])).rows).toHaveLength(1);
  });

  it("compte supprimé : plus aucun appareil abonné", async () => {
    await db.query("update app.users set deleted_at = now() where id = $1", [codjo]);
    expect((await db.query("select 1 from app.push_subscriptions where user_id = $1", [codjo])).rows).toHaveLength(0);
  });

  it("migration rejouable sans risque (fichier à exécuter dans Supabase)", async () => {
    const sql = readFileSync(join(__dirname, "..", "migrations", "20261104000000_notifications_telephone.sql"), "utf8");
    await db.exec(sql);
    expect((await db.query("select 1 from app.push_subscriptions")).rows.length).toBeGreaterThan(0);
  });
});
