import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Recherche globale de l'administration (section 11.1) : un seul champ, des résultats
 * limités à ce que la permission de chacun autorise.
 */

let db: PGlite;
let admin: string;
let moderator: string;
let member: string;
let target: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
  member = await createMember(db, { firstName: "Afiwa", sex: "female" });
  target = await createMember(db, { firstName: "Mahougnon", sex: "female", status: "pending_verification" });
  await db.query("insert into app.verifications (user_id) values ($1)", [target]);
  await createEvent(db, { startsInHours: 72 }); // lieu « Maison Akpakpa (lieu fictif) »
  await db.query(
    "insert into app.payments (user_id, purpose, amount_xof, provider, provider_transaction_id, status) values ($1, 'evening_booking', 5000, 'simulated', 'sim_akpa42', 'succeeded')",
    [target],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

type Hit = { kind: string; id: string; title: string | null; detail: string | null };
const search = (userId: string, q: string) =>
  asUser(db, userId, async (tx) => (await tx.query<Hit>("select kind, id, title, detail from app.admin_search($1)", [q])).rows);

describe("Recherche globale (11.1)", () => {
  it("membre : refusée", async () => {
    const error = await asUser(db, member, (tx) => failure(tx.query("select * from app.admin_search('mahou')")));
    expect(error).toMatch(/forbidden/);
  });

  it("administration : membres, dossiers, soirées, lieux et paiements", async () => {
    const byName = await search(admin, "mahou");
    expect(byName.map((h) => h.kind).sort()).toEqual(["member", "verification"]);
    expect(byName.find((h) => h.kind === "member")).toMatchObject({ id: target, title: "Mahougnon Fictif" });
    expect(byName.find((h) => h.kind === "verification")?.detail).toBe("pending");

    const byPlace = await search(admin, "akpa");
    expect(byPlace.map((h) => h.kind).sort()).toEqual(["evening", "payment", "venue"]);
    expect(byPlace.find((h) => h.kind === "payment")?.title).toBe("sim_akpa42");
  });

  it("modération : aucun module de ces types, aucun résultat ; moins de 2 caractères : rien", async () => {
    expect(await search(moderator, "mahou")).toEqual([]);
    expect(await search(admin, "m")).toEqual([]);
    expect(await search(admin, "   ")).toEqual([]);
  });
});
