import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Audit UX du 03/11/2026 : le paiement d'une soirée confirme la place, et chaque étape du
 * parcours est notifiée au membre (espace et e-mail).
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

/** Comme asUser, mais la transaction est validée (étapes successives). */
async function commitAs<T>(user: string, fn: (tx: Parameters<Parameters<PGlite["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

const kinds = async (userId: string) =>
  (
    await db.query<{ kind: string; channels: string[] }>(
      `select n.kind, coalesce(array_agg(d.channel::text) filter (where d.id is not null), '{}') as channels
         from app.notifications n left join app.notification_deliveries d on d.notification_id = n.id
        where n.user_id = $1 group by n.id order by n.created_at, n.kind`,
      [userId],
    )
  ).rows;

const statusOf = async (eventId: string, userId: string) =>
  (await db.query<{ status: string }>("select status from app.event_registrations where event_id = $1 and user_id = $2", [eventId, userId])).rows[0]?.status;

describe("Paiement = place confirmée", () => {
  it("le paiement abouti confirme la place réservée, une seule notification de confirmation", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    await db.query("update app.events set price_xof = 10000 where id = $1", [event]);
    const member = await createMember(db, { firstName: "Afiavi", sex: "female", photo: true });

    await commitAs(member, (tx) => tx.query("select app.book_event($1)", [event]));
    expect(await statusOf(event, member)).toBe("booked");

    const { rows } = await db.query<{ id: string }>(
      "insert into app.payments (user_id, purpose, amount_xof, provider, status) values ($1, 'evening_booking', 10000, 'feexpay', 'pending') returning id",
      [member],
    );
    await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [rows[0]!.id, event, member]);
    await db.query("update app.payments set status = 'succeeded' where id = $1", [rows[0]!.id]);

    expect(await statusOf(event, member)).toBe("confirmed");
    const notes = await kinds(member);
    expect(notes.map((n) => n.kind)).toEqual(["evening.booked", "evening.confirmed"]);
    expect(notes.every((n) => n.channels.includes("email"))).toBe(true);
    const payload = (
      await db.query<{ payload: Record<string, unknown> }>("select payload from app.notifications where user_id = $1 and kind = 'evening.confirmed'", [member])
    ).rows[0]!.payload;
    expect(payload.by_payment).toBe(true);
  });

  it("un autre paiement (conseiller) ou une place déjà confirmée ne change rien", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    const member = await createMember(db, { firstName: "Sènami", sex: "female", photo: true });
    await db.query("insert into app.event_registrations (event_id, user_id, sex, status) values ($1, $2, 'female', 'booked')", [event, member]);
    const { rows } = await db.query<{ id: string }>(
      "insert into app.payments (user_id, purpose, amount_xof, provider, status) values ($1, 'registration_fee', 5000, 'feexpay', 'pending') returning id",
      [member],
    );
    await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [rows[0]!.id, event, member]);
    await db.query("update app.payments set status = 'succeeded' where id = $1", [rows[0]!.id]);
    expect(await statusOf(event, member)).toBe("booked");
  });
});

describe("Une notification à chaque étape", () => {
  it("réserver, confirmer, annuler, soirée complète : chaque action du membre est notifiée", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 1 });
    const next = await createEvent(db, { startsInHours: 240 });
    const first = await createMember(db, { firstName: "Ayaba", sex: "female", photo: true });
    const second = await createMember(db, { firstName: "Mawulé", sex: "female", photo: true });

    await commitAs(first, (tx) => tx.query("select app.book_event($1)", [event]));
    await commitAs(second, (tx) => tx.query("select app.book_event($1)", [event]));
    await commitAs(first, (tx) => tx.query("select app.confirm_registration($1)", [event]));
    await commitAs(first, (tx) => tx.query("select app.cancel_registration($1)", [event]));

    expect((await kinds(first)).map((n) => n.kind)).toEqual(["evening.booked", "evening.confirmed", "evening.registration_cancelled"]);
    // La seconde trouve la soirée complète : inscrite d'office à la suivante, une seule alerte (06/11/2026)
    expect((await kinds(second)).map((n) => n.kind)).toEqual(["evening.moved_to_next"]);
    const { rows } = await db.query<{ event_id: string }>("select event_id from app.event_registrations where user_id = $1", [second]);
    expect(rows).toEqual([{ event_id: next }]);
  });

  it("dossier envoyé, photo approuvée hors dossier : notifiés ; photo approuvée avec le dossier : pas de doublon", async () => {
    const member = await createMember(db, { firstName: "Codjo", sex: "male", status: "registering" });
    await db.query("update app.member_profiles set status = 'pending_verification' where user_id = $1", [member]);
    // Le changement de statut fait par l'administrateur de la base (sans membre connecté) est notifié aussi
    expect((await kinds(member)).map((n) => n.kind)).toEqual(["verification.submitted"]);

    const { rows } = await db.query<{ id: string }>(
      "insert into app.photos (user_id, storage_path, review_status) values ($1, $2, 'pending') returning id",
      [member, `${member}/p.jpg`],
    );
    await commitAs(admin, (tx) => tx.query("select app.review_photo($1, true)", [rows[0]!.id]));
    expect((await kinds(member)).map((n) => n.kind)).toEqual(["verification.submitted", "profile.photo_approved"]);
  });
});
