import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Photo exigée pour réserver (question 10 c de PHASE3.txt, décision du 29 octobre 2026) :
 * une photo approuvée par l'équipe, comptes de démonstration dispensés, inscriptions
 * déjà enregistrées conservées.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const book = (userId: string, eventId: string) =>
  asUser(db, userId, (tx) => failure(tx.query("select app.book_event($1)", [eventId])));

async function addPhoto(userId: string, status: "pending" | "approved" | "rejected") {
  await db.query("insert into app.photos (user_id, storage_path, review_status) values ($1, $2, $3::app.review_status)", [
    userId,
    `${userId}/${status}.jpg`,
    status,
  ]);
}

describe("Photo approuvée pour réserver (question 10 c)", () => {
  it("sans photo, ou avec une photo en relecture ou refusée : réservation refusée ; approuvée : place réservée", async () => {
    const event = await createEvent(db, { startsInHours: 72 });
    const member = await createMember(db, { firstName: "Sènami", sex: "female" });
    expect(await book(member, event)).toMatch(/photo_required/);
    await addPhoto(member, "pending");
    await addPhoto(member, "rejected");
    expect(await book(member, event)).toMatch(/photo_required/);
    await db.query("update app.photos set review_status = 'approved' where storage_path = $1", [`${member}/pending.jpg`]);
    expect(await book(member, event)).toBeNull();
  });

  it("la liste d'attente demande aussi une photo approuvée", async () => {
    const event = await createEvent(db, { startsInHours: 72, capacityMen: 1 });
    const seated = await createMember(db, { firstName: "Codjo", sex: "male" });
    await register(db, event, seated, "male", "booked");
    const member = await createMember(db, { firstName: "Mahougnon", sex: "male" });
    expect(await book(member, event)).toMatch(/photo_required/);
    await addPhoto(member, "approved");
    const outcome = await asUser(db, member, async (tx) => (await tx.query<{ r: string }>("select app.book_event($1) as r", [event])).rows[0]!.r);
    expect(outcome).toBe("waitlist");
  });

  it("compte de démonstration (@demo.ifedele.invalid) : dispensé de photo", async () => {
    const event = await createEvent(db, { startsInHours: 72 });
    const demo = await createMember(db, { firstName: "Afiavi", sex: "female" });
    await db.query("update auth.users set email = 'demo-f99@demo.ifedele.invalid' where id = $1", [demo]);
    expect(await book(demo, event)).toBeNull();
    // Une adresse qui ressemble seulement au domaine de démonstration n'est pas dispensée
    const other = await createMember(db, { firstName: "Ayaba", sex: "female" });
    await db.query("update auth.users set email = 'ayaba@demo.ifedele.invalid.example.com' where id = $1", [other]);
    expect(await book(other, event)).toMatch(/photo_required/);
  });

  it("une inscription déjà enregistrée sans photo est conservée et se confirme normalement", async () => {
    const event = await createEvent(db, { startsInHours: 72 });
    const member = await createMember(db, { firstName: "Yétondé", sex: "female" });
    await register(db, event, member, "female", "booked");
    const result = await asUser(db, member, async (tx) => {
      const confirm = await failure(tx.query("select app.confirm_registration($1)", [event]));
      const { rows } = await tx.query<{ status: string }>("select status from app.event_registrations where event_id = $1 and user_id = $2", [event, member]);
      return { confirm, status: rows[0]?.status };
    });
    expect(result).toEqual({ confirm: null, status: "confirmed" });
  });

  it("la fonction de contrôle n'est pas appelable directement par un membre", async () => {
    const member = await createMember(db, { firstName: "Kémi", sex: "female" });
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.has_booking_photo($1)", [member])))).toMatch(/permission denied/);
  });
});
