import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Fiches de l'administration (décisions du 29 octobre 2026) : détail d'un membre pour décider
 * (e-mail, réponses, textes, photos) et suppression immédiate par la super administration.
 */

let db: PGlite;
let admin: string;
let superAdmin: string;
let moderator: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  superAdmin = await createMember(db, { firstName: "Gbènakpon", sex: "male", role: "super_admin" });
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

type Details = {
  email: string | null;
  answers: { side: string; category: string; values: string[] }[];
  dealbreakers: string[];
  texts: { field: string; body: string; review_status: string; review_note: string | null }[];
  photos: { photo_id: string; review_status: string; review_note: string | null }[];
};

const details = (viewer: string, member: string) =>
  asUser(db, viewer, async (tx) => (await tx.query<{ d: Details }>("select app.admin_member_details($1) as d", [member])).rows[0]!.d);

async function fullMember(firstName: string) {
  const id = await createMember(db, { firstName, sex: "female", religion: "catholic" });
  await db.query("update auth.users set email = $2 where id = $1", [id, `${firstName.toLowerCase()}@exemple.invalid`]);
  await db.query(`insert into app.profile_answers (user_id, side, category, "values") values ($1, 'seeking', 'religion', '{catholic,protestant_evangelical}')`, [id]);
  await db.query("insert into app.dealbreakers (user_id, category) values ($1, 'religion')", [id]);
  await db.query("insert into app.profile_texts (user_id, field, body) values ($1, 'who_i_am', 'Je suis infirmière à Cotonou.')", [id]);
  await db.query("insert into app.photos (user_id, storage_path, review_status, review_note) values ($1, $2, 'rejected', 'Visage caché')", [id, `${id}/a.jpg`]);
  return id;
}

describe("Détail d'un membre", () => {
  it("administration et super administration : e-mail, réponses, critères, textes et photos avec leur état", async () => {
    const member = await fullMember("Afiwa");
    for (const viewer of [admin, superAdmin]) {
      const d = await details(viewer, member);
      expect(d.email).toBe("afiwa@exemple.invalid");
      expect(d.answers).toEqual([
        { side: "self", category: "religion", values: ["catholic"] },
        { side: "seeking", category: "religion", values: ["catholic", "protestant_evangelical"] },
      ]);
      expect(d.dealbreakers).toEqual(["religion"]);
      expect(d.texts).toEqual([{ field: "who_i_am", body: "Je suis infirmière à Cotonou.", review_status: "pending", review_note: null }]);
      expect(d.photos).toMatchObject([{ review_status: "rejected", review_note: "Visage caché" }]);
    }
  });

  it("ni un membre ni la modération ne lisent ce détail", async () => {
    const member = await fullMember("Ablavi");
    const other = await createMember(db, { firstName: "Codjo", sex: "male" });
    for (const viewer of [other, moderator]) {
      expect(await asUser(db, viewer, (tx) => failure(tx.query("select app.admin_member_details($1)", [member])))).toMatch(/forbidden/);
    }
  });
});

describe("Suppression immédiate par la super administration", () => {
  const remove = (actor: string, member: string, reason = "Faux profil signalé") =>
    asUser(db, actor, (tx) => failure(tx.query("select app.admin_delete_account($1, $2)", [member, reason])));

  it("réservée à la super administration, motif obligatoire, jamais son propre compte ni un compte de l'équipe", async () => {
    const member = await fullMember("Houéfa");
    expect(await remove(admin, member)).toMatch(/forbidden/);
    expect(await remove(moderator, member)).toMatch(/forbidden/);
    expect(await remove(superAdmin, member, "  ")).toMatch(/reason_required/);
    expect(await remove(superAdmin, superAdmin)).toMatch(/self_action/);
    expect(await remove(superAdmin, admin)).toMatch(/staff_account/);
  });

  it("soirée à venir : l'inscription est annulée d'abord", async () => {
    const member = await fullMember("Mariam");
    const event = await createEvent(db, { startsInHours: 72 });
    await register(db, event, member, "female", "confirmed");
    expect(await remove(superAdmin, member)).toMatch(/upcoming_evening/);
  });

  it("effacement immédiat en base, journal avec le motif, fichiers et compte Auth à nettoyer par l'API", async () => {
    const member = await fullMember("Folake");
    await db.query("update app.users set member_number = 'IF-DEL-001' where id = $1", [member]);
    // La transaction de asUser est annulée : la suppression est rejouée et validée ici
    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: superAdmin, role: "authenticated" })]);
      await tx.exec("set local role authenticated");
      await tx.query("select app.admin_delete_account($1, $2)", [member, "Faux profil signalé"]);
    });
    const count = async (table: string, column = "user_id") =>
      (await db.query<{ n: number }>(`select count(*)::int as n from app.${table} where ${column} = $1`, [member])).rows[0]!.n;
    for (const table of ["member_profiles", "profile_answers", "dealbreakers", "profile_texts", "photos"]) expect(await count(table), table).toBe(0);
    const user = (await db.query<{ deleted_at: Date | null; phone: string | null }>("select deleted_at, phone from app.users where id = $1", [member])).rows[0]!;
    expect(user.deleted_at).not.toBeNull();
    expect(user.phone).toBeNull();
    const audit = (await db.query<{ actor_id: string; target_id: string | null; details: Record<string, string> }>(
      "select actor_id, target_id, details from app.audit_log where action = 'account.deleted_by_admin' order by created_at desc limit 1",
    )).rows[0]!;
    expect(audit).toMatchObject({ actor_id: superAdmin, target_id: null, details: { reason: "Faux profil signalé", member_number: "IF-DEL-001" } });
    const toClean = await asService(db, async (tx) => (await tx.query<{ id: string }>("select app.accounts_to_clean() as id")).rows.map((r) => r.id));
    expect(toClean).toContain(member);
    // Déjà supprimé : introuvable
    expect(await remove(superAdmin, member)).toMatch(/not_found/);
  });
});
