import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Place donnée moins de 48 h avant la soirée (question 9, réponses du 22 octobre 2026) :
 * promotion depuis la liste d'attente ou réservation directe tardive, 2 heures pour confirmer
 * et payer ; sinon la place passe au suivant.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function priced(startsInHours: number, capacityWomen = 1) {
  const event = await createEvent(db, { startsInHours, capacityWomen });
  await db.query("update app.events set price_xof = 10000 where id = $1", [event]);
  return event;
}

async function pay(eventId: string, userId: string, status: "succeeded" | "pending", reference: string | null) {
  const { rows } = await db.query<{ id: string }>(
    `insert into app.payments (user_id, purpose, amount_xof, provider, provider_transaction_id, status)
     values ($1, 'evening_booking', 10000, 'feexpay', $2, $3::app.payment_status) returning id`,
    [userId, reference, status],
  );
  await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [rows[0]!.id, eventId, userId]);
}

describe("Place donnée moins de 48 h avant (question 9)", () => {
  it("confirmation dans les 2 heures après l'attribution, refusée ensuite ; place attribuée avant la limite : règle des 48 h", async () => {
    const event = await priced(30, 3);
    const late = await createMember(db, { photo: true, firstName: "Houéfa", sex: "female" });
    const tooLate = await createMember(db, { photo: true, firstName: "Mariam", sex: "female" });
    const early = await createMember(db, { photo: true, firstName: "Folake", sex: "female" });
    await register(db, event, late, "female", "booked", 1); // attribuée il y a 1 h, après la limite (il y a 18 h)
    await register(db, event, tooLate, "female", "booked", 3); // il y a 3 h : délai de 2 h dépassé
    await register(db, event, early, "female", "booked", 20); // avant la limite : confirmation close
    const confirm = (user: string) => asUser(db, user, (tx) => failure(tx.query("select app.confirm_registration($1)", [event])));
    expect(await confirm(late)).toBeNull();
    expect(await confirm(tooLate)).toMatch(/confirmation_closed/);
    expect(await confirm(early)).toMatch(/confirmation_closed/);
  });

  it("au bout de 2 heures sans confirmation ou sans paiement : place libérée et donnée au suivant", async () => {
    const event = await priced(30, 4);
    const unconfirmed = await createMember(db, { photo: true, firstName: "Ayaba", sex: "female" });
    const unpaid = await createMember(db, { photo: true, firstName: "Kémi", sex: "female" });
    const paid = await createMember(db, { photo: true, firstName: "Nadège", sex: "female" });
    const inProgress = await createMember(db, { photo: true, firstName: "Sènami", sex: "female" });
    const recent = await createMember(db, { photo: true, firstName: "Yétondé", sex: "male" });
    const next = await createMember(db, { photo: true, firstName: "Afiavi", sex: "female" });
    await register(db, event, unconfirmed, "female", "booked", 2.5);
    await register(db, event, unpaid, "female", "confirmed", 2.5);
    await register(db, event, paid, "female", "confirmed", 2.5);
    await pay(event, paid, "succeeded", "ref-paye");
    await register(db, event, inProgress, "female", "confirmed", 2.5);
    await pay(event, inProgress, "pending", "ref-en-cours");
    await register(db, event, recent, "male", "booked", 1);
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [event, next]);

    expect(await asUser(db, next, (tx) => failure(tx.query("select app.release_late_promotions()")))).toMatch(/permission denied|forbidden/);
    const result = await asService(db, async (tx) => {
      const [{ n }] = (await tx.query<{ n: number }>("select app.release_late_promotions() as n")).rows as [{ n: number }];
      const regs = (await tx.query<{ user_id: string; status: string }>("select user_id, status from app.event_registrations where event_id = $1", [event])).rows;
      const audit = (await tx.query<{ details: { count: number } }>("select details from app.audit_log where action = 'registrations.released_late'")).rows;
      return { n, status: Object.fromEntries(regs.map((r) => [r.user_id, r.status])), audit };
    });
    // 2 places de cette soirée, plus la place « délai dépassé » du test précédent (autre soirée)
    expect(result.n).toBe(3);
    expect(result.status).toEqual({
      [unconfirmed]: "released",
      [unpaid]: "released",
      [paid]: "confirmed",
      [inProgress]: "confirmed",
      [recent]: "booked",
      [next]: "booked",
    });
    expect(result.audit).toEqual([{ details: { count: 3 } }]);
  });

  it("réservation directe tardive : même règle ; Mes soirées affiche les limites de 2 heures", async () => {
    const event = await priced(30, 2);
    const member = await createMember(db, { photo: true, firstName: "Adjoavi", sex: "female" });
    const result = await asUser(db, member, async (tx) => {
      await tx.query("select app.book_event($1)", [event]);
      const [row] = (await tx.query<{ confirm_by: Date; pay_by: Date }>("select confirm_by, pay_by from app.my_bookings() where event_id = $1", [event])).rows;
      const [{ seated }] = (await tx.query<{ seated: Date }>("select seated_at as seated from app.event_registrations where event_id = $1 and user_id = $2", [event, member])).rows as [{ seated: Date }];
      return { row, seated };
    });
    const twoHours = 2 * 3600 * 1000;
    expect(new Date(result.row!.confirm_by).getTime() - new Date(result.seated).getTime()).toBe(twoHours);
    expect(new Date(result.row!.pay_by).getTime() - new Date(result.seated).getTime()).toBe(twoHours);
  });
});
