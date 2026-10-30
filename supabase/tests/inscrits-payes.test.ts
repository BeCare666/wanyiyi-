import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Fiche d'une soirée (décision du 30 octobre 2026) : payée ou non, montant encaissé et limite
 * de paiement de chaque inscrit.
 */

let db: PGlite;
let admin: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

type Row = { first_name: string; paid: boolean; paid_xof: number; pay_by: string | null };

async function pay(eventId: string, userId: string, status: string, amount = 10000, refunded = 0) {
  const { rows } = await db.query<{ id: string }>(
    `insert into app.payments (user_id, purpose, amount_xof, provider, status, refunded_amount_xof)
     values ($1, 'evening_booking', $2, 'simulated', $3::app.payment_status, $4) returning id`,
    [userId, amount, status, refunded],
  );
  await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [rows[0]!.id, eventId, userId]);
}

describe("Inscrits payés ou non", () => {
  it("paiement réussi : payée avec le montant ; en attente ou échoué : non payée avec la limite de 24 h ; liste d'attente : rien", async () => {
    const event = await createEvent(db, { startsInHours: 24 * 7, capacityWomen: 3, capacityMen: 1 });
    await db.query("update app.events set price_xof = 10000 where id = $1", [event]);
    const [ayaba, kemi, sena, codjo, comlan] = await Promise.all([
      createMember(db, { firstName: "Ayaba", sex: "female" }),
      createMember(db, { firstName: "Kémi", sex: "female" }),
      createMember(db, { firstName: "Sèna", sex: "female" }),
      createMember(db, { firstName: "Codjo", sex: "male" }),
      createMember(db, { firstName: "Comlan", sex: "male" }),
    ]);
    await register(db, event, ayaba!, "female", "confirmed", 2);
    await register(db, event, kemi!, "female", "booked", 2);
    await register(db, event, sena!, "female", "booked", 2);
    await register(db, event, codjo!, "male", "booked", 2);
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'male', 1)", [event, comlan]);
    await pay(event, ayaba!, "succeeded", 10000, 2000);
    await pay(event, kemi!, "pending");
    await pay(event, sena!, "refunded");

    const rows = await asUser(db, admin, async (tx) =>
      (await tx.query<Row>("select first_name, paid, paid_xof, pay_by from app.event_participants($1)", [event])).rows,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.first_name, r]));
    expect(byName.Ayaba).toMatchObject({ paid: true, paid_xof: 8000, pay_by: null });
    for (const name of ["Kémi", "Sèna", "Codjo"]) {
      expect(byName[name]).toMatchObject({ paid: false, paid_xof: 0 });
      // Place attribuée il y a 2 h : 22 h restantes
      const left = (new Date(byName[name]!.pay_by!).getTime() - Date.now()) / 3_600_000;
      expect(left).toBeGreaterThan(21.9);
      expect(left).toBeLessThan(22.1);
    }
    expect(byName.Comlan).toMatchObject({ paid: false, paid_xof: 0, pay_by: null });
  });

  it("soirée sans tarif : aucune limite de paiement", async () => {
    const event = await createEvent(db, { startsInHours: 24 * 7 });
    const member = await createMember(db, { firstName: "Houéfa", sex: "female" });
    await register(db, event, member, "female", "booked");
    const rows = await asUser(db, admin, async (tx) => (await tx.query<Row>("select first_name, paid, paid_xof, pay_by from app.event_participants($1)", [event])).rows);
    expect(rows).toEqual([{ first_name: "Houéfa", paid: false, paid_xof: 0, pay_by: null }]);
  });
});
