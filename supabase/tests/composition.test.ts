import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/** Composition assistée : alerte sur les critères non négociables incompatibles (section 11.2-5). */

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function answer(user: string, side: "self" | "seeking", category: string, values: string[]) {
  await db.query('insert into app.profile_answers (user_id, side, category, "values") values ($1, $2, $3, $4)', [user, side, category, values]);
}

type Alert = { holder_first_name: string; other_first_name: string; category: string; kind: string };

describe("Composition assistée", () => {
  it("incompatible ou inconnu, dans chaque sens ; recherche compatible, « Indifférent » ou liste d'attente : rien", async () => {
    const admin = await createMember(db, { firstName: "Sèna", sex: "male", role: "admin" });
    const event = await createEvent(db, { startsInHours: 72 });
    const afi = await createMember(db, { firstName: "Afiwa", sex: "female" });
    const kemi = await createMember(db, { firstName: "Kémi", sex: "female" });
    const codjo = await createMember(db, { firstName: "Codjo", sex: "male" });
    const yao = await createMember(db, { firstName: "Yao", sex: "male" });
    const waiting = await createMember(db, { firstName: "Mawuli", sex: "male" });
    await register(db, event, afi, "female", "confirmed");
    await register(db, event, kemi, "female", "booked");
    await register(db, event, codjo, "male", "checked_in");
    await register(db, event, yao, "male", "confirmed");
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'male', 1)", [event, waiting]);

    // Afiwa : non-fumeur exigé. Codjo fume parfois (incompatible), Yao n'a pas répondu (inconnu).
    await answer(afi, "seeking", "tobacco", ["no"]);
    await db.query("insert into app.dealbreakers (user_id, category) values ($1, 'tobacco')", [afi]);
    await answer(codjo, "self", "tobacco", ["sometimes"]);
    await answer(waiting, "self", "tobacco", ["yes"]);
    // Codjo : musulmane exigée ; Afiwa l'est (compatible), Kémi est catholique (incompatible).
    await answer(codjo, "seeking", "religion", ["muslim"]);
    await db.query("insert into app.dealbreakers (user_id, category) values ($1, 'religion')", [codjo]);
    await answer(afi, "self", "religion", ["muslim"]);
    await answer(kemi, "self", "religion", ["catholic"]);
    // Kémi : lieu de vie Cotonou exigé ; Yao « Indifférent » (compatible), Codjo à l'étranger (incompatible).
    await answer(kemi, "seeking", "desired_location", ["cotonou"]);
    await db.query("insert into app.dealbreakers (user_id, category) values ($1, 'desired_location')", [kemi]);
    await answer(yao, "self", "desired_location", ["indifferent"]);
    await answer(codjo, "self", "desired_location", ["abroad"]);
    // Yao : critère sur une recherche « Indifférent » : ignoré
    await answer(yao, "seeking", "alcohol", ["indifferent"]);
    await db.query("insert into app.dealbreakers (user_id, category) values ($1, 'alcohol')", [yao]);

    const alerts = await asUser(db, admin, async (tx) => (await tx.query<Alert>("select * from app.event_composition_alerts($1)", [event])).rows);
    expect(alerts.map((a) => [a.holder_first_name, a.other_first_name, a.category, a.kind])).toEqual([
      ["Afiwa", "Codjo", "tobacco", "incompatible"],
      ["Codjo", "Kémi", "religion", "incompatible"],
      ["Kémi", "Codjo", "desired_location", "incompatible"],
      ["Afiwa", "Yao", "tobacco", "unknown"],
    ]);

    expect(await asUser(db, afi, (tx) => failure(tx.query("select * from app.event_composition_alerts($1)", [event])))).toMatch(/forbidden/);
  });
});
