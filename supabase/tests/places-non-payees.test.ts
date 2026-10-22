import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Place réservée mais pas encore payée (question 12, réponse du 22 octobre 2026) : gardée 24 h,
 * puis libérée pour la liste d'attente si aucun paiement n'a abouti.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function pay(eventId: string, userId: string, status: "succeeded" | "pending", reference: string | null) {
  const { rows } = await db.query<{ id: string }>(
    `insert into app.payments (user_id, purpose, amount_xof, provider, provider_transaction_id, status)
     values ($1, 'evening_booking', 10000, 'feexpay', $2, $3::app.payment_status) returning id`,
    [userId, reference, status],
  );
  await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [rows[0]!.id, eventId, userId]);
}

const statusOf = async (eventId: string, userId: string) =>
  (await db.query<{ status: string }>("select status from app.event_registrations where event_id = $1 and user_id = $2", [eventId, userId])).rows[0]?.status;

describe("Places non payées (question 12)", () => {
  it("après 24 h sans paiement : place libérée et donnée au premier en attente ; les autres places sont gardées", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 2, capacityMen: 3 });
    await db.query("update app.events set price_xof = 10000 where id = $1", [event]);
    const free = await createEvent(db, { startsInHours: 120 }); // sans tarif : aucun paiement possible

    const unpaid = await createMember(db, { firstName: "Afiavi", sex: "female" });
    const unpaidConfirmed = await createMember(db, { firstName: "Sènami", sex: "female" });
    const waiting = await createMember(db, { firstName: "Ayaba", sex: "female" });
    const recent = await createMember(db, { firstName: "Koffi", sex: "male" });
    const paid = await createMember(db, { firstName: "Codjo", sex: "male" });
    const inProgress = await createMember(db, { firstName: "Mawulé", sex: "male" });
    const noPrice = await createMember(db, { firstName: "Rodrigue", sex: "male" });

    await register(db, event, unpaid, "female", "booked", 25);
    await register(db, event, unpaidConfirmed, "female", "confirmed", 30);
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [event, waiting]);
    await register(db, event, recent, "male", "booked", 23);
    await register(db, event, paid, "male", "confirmed", 30);
    await pay(event, paid, "succeeded", "ref-ok");
    await register(db, event, inProgress, "male", "booked", 30);
    await pay(event, inProgress, "pending", "ref-en-cours");
    await register(db, free, noPrice, "male", "booked", 30);

    expect(await asUser(db, unpaid, (tx) => failure(tx.query("select app.release_unpaid()")))).toMatch(/permission denied|forbidden/);

    const result = await asService(db, async (tx) => {
      const [{ n }] = (await tx.query<{ n: number }>("select app.release_unpaid() as n")).rows as [{ n: number }];
      const regs = (
        await tx.query<{ user_id: string; status: string }>(
          "select user_id, status from app.event_registrations where event_id in ($1, $2)",
          [event, free],
        )
      ).rows;
      const audit = (await tx.query<{ details: { count: number } }>("select details from app.audit_log where action = 'registrations.released_unpaid'")).rows;
      const [{ again }] = (await tx.query<{ again: number }>("select app.release_unpaid() as again")).rows as [{ again: number }];
      return { n, again, status: Object.fromEntries(regs.map((r) => [r.user_id, r.status])), audit };
    });

    expect(result.n).toBe(2);
    expect(result.again).toBe(0);
    expect(result.status).toEqual({
      [unpaid]: "released",
      [unpaidConfirmed]: "released",
      [waiting]: "booked",
      [recent]: "booked",
      [paid]: "confirmed",
      [inProgress]: "booked",
      [noPrice]: "booked",
    });
    expect(result.audit).toEqual([{ details: { count: 2 } }]);
  });

  it("la personne promue dispose à son tour de 24 h à partir de l'attribution de sa place", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 1 });
    await db.query("update app.events set price_xof = 10000 where id = $1", [event]);
    const first = await createMember(db, { firstName: "Fifamè", sex: "female" });
    const next = await createMember(db, { firstName: "Adjoavi", sex: "female" });
    await register(db, event, first, "female", "booked", 25);
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [event, next]);
    await asService(db, async (tx) => {
      await tx.query("select app.release_unpaid()");
      await tx.query("select app.release_unpaid()");
      expect((await tx.query<{ status: string }>("select status from app.event_registrations where user_id = $1", [next])).rows[0]?.status).toBe("booked");
    });
    // Hors transaction de test : rien n'a été modifié
    expect(await statusOf(event, first)).toBe("booked");
  });

  it("Mes soirées : date limite de paiement affichée tant que la place n'est pas payée", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    await db.query("update app.events set price_xof = 10000 where id = $1", [event]);
    const free = await createEvent(db, { startsInHours: 120 });
    const member = await createMember(db, { firstName: "Yétondé", sex: "female" });
    const payer = await createMember(db, { firstName: "Dossou", sex: "male" });
    await register(db, event, member, "female", "booked", 2);
    await register(db, free, member, "female", "booked", 2);
    await register(db, event, payer, "male", "confirmed", 2);
    await pay(event, payer, "succeeded", "ref-paye");
    type Row = { event_id: string; pay_by: Date | null; seated_at: Date };
    const mine = (user: string) =>
      asUser(db, user, async (tx) => (await tx.query<Row>("select b.event_id, b.pay_by from app.my_bookings() b")).rows);
    const rowsOf = await mine(member);
    const [{ seated }] = (await db.query<{ seated: Date }>("select seated_at as seated from app.event_registrations where event_id = $1 and user_id = $2", [event, member])).rows as [{ seated: Date }];
    const priced = rowsOf.find((r) => r.event_id === event)!;
    expect(new Date(priced.pay_by!).getTime() - new Date(seated).getTime()).toBe(24 * 3600 * 1000);
    expect(rowsOf.find((r) => r.event_id === free)!.pay_by).toBeNull();
    expect((await mine(payer)).find((r) => r.event_id === event)!.pay_by).toBeNull();
  });
});
