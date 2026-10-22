import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createMember } from "./fixtures";

/**
 * Modération des textes de profil (question 22, réponses du 22 octobre 2026) : motif écrit
 * obligatoire pour un refus, membre notifié avec le motif, texte refusé masqué jusqu'à sa
 * réécriture (qui repasse en relecture), visible des autres seulement une fois approuvé.
 */

let db: PGlite;
let moderator: string;
let member: string;
let other: string;

beforeAll(async () => {
  db = await createDb();
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
  member = await createMember(db, { firstName: "Kémi", sex: "female" });
  other = await createMember(db, { firstName: "Codjo", sex: "male" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function write(user: string, field: string, body: string) {
  await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    await tx.query(
      "insert into app.profile_texts (user_id, field, body) values ($1, $2, $3) on conflict (user_id, field) do update set body = excluded.body",
      [user, field, body],
    );
  });
}

const textOf = async (user: string, field: string) =>
  (
    await db.query<{ id: string; review_status: string; review_note: string | null; reviewed_by: string | null }>(
      "select id, review_status, review_note, reviewed_by from app.profile_texts where user_id = $1 and field = $2",
      [user, field],
    )
  ).rows[0]!;

describe("Modération des textes de profil (question 22)", () => {
  it("file de relecture réservée à l'équipe de modération ; textes en attente, les plus anciens d'abord", async () => {
    await write(member, "who_i_am", "Je suis enseignante à Porto-Novo.");
    await write(member, "what_matters", "La famille et la foi.");
    expect(await asUser(db, other, (tx) => failure(tx.query("select * from app.moderation_queue()")))).toMatch(/forbidden/);
    const queue = await asUser(db, moderator, async (tx) => (await tx.query<{ first_name: string; field: string; body: string }>("select first_name, field, body from app.moderation_queue()")).rows);
    expect(queue).toEqual([
      { first_name: "Kémi", field: "who_i_am", body: "Je suis enseignante à Porto-Novo." },
      { first_name: "Kémi", field: "what_matters", body: "La famille et la foi." },
    ]);
  });

  it("refus : motif obligatoire, membre notifié avec le motif, journalisé ; une seule décision", async () => {
    const text = await textOf(member, "what_matters");
    const decide = (user: string, status: string, note: string | null) =>
      asUser(db, user, (tx) => failure(tx.query("select app.review_profile_text($1, $2::app.review_status, $3)", [text.id, status, note])));
    expect(await decide(other, "rejected", "Motif")).toMatch(/forbidden/);
    expect(await decide(moderator, "rejected", "   ")).toMatch(/note_required/);
    expect(await decide(moderator, "pending", null)).toMatch(/invalid_status/);

    // Décision validée (hors transaction annulée) au nom du modérateur
    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: moderator, role: "authenticated" })]);
      await tx.exec("set local role authenticated");
      await tx.query("select app.review_profile_text($1, 'rejected', $2)", [text.id, "  Merci de ne pas citer votre lieu de culte.  "]);
    });
    expect(await textOf(member, "what_matters")).toMatchObject({ review_status: "rejected", review_note: "Merci de ne pas citer votre lieu de culte.", reviewed_by: moderator });
    const notifications = (await db.query<{ kind: string; payload: { reason: string; field: string } }>("select kind, payload from app.notifications where user_id = $1", [member])).rows;
    expect(notifications).toEqual([{ kind: "profile.text_rejected", payload: { reason: "Merci de ne pas citer votre lieu de culte.", field: "what_matters" } }]);
    const audit = (await db.query<{ actor_id: string }>("select actor_id from app.audit_log where action = 'profile_text.rejected' and target_id = $1", [text.id])).rows;
    expect(audit).toEqual([{ actor_id: moderator }]);
    expect(await decide(moderator, "approved", null)).toMatch(/already_reviewed/);
  });

  it("le texte refusé reste masqué ; réécrit par le membre, il repasse en relecture sans l'ancien motif", async () => {
    // Le membre relit son propre texte et son motif ; un autre membre ne voit aucun texte
    const own = await asUser(db, member, async (tx) => (await tx.query("select field, review_status, review_note from app.profile_texts where field = 'what_matters'")).rows);
    expect(own).toEqual([{ field: "what_matters", review_status: "rejected", review_note: "Merci de ne pas citer votre lieu de culte." }]);
    expect(await asUser(db, other, async (tx) => (await tx.query("select 1 from app.profile_texts where user_id = $1", [member])).rows)).toEqual([]);

    await write(member, "what_matters", "La famille, la foi et le respect.");
    expect(await textOf(member, "what_matters")).toMatchObject({ review_status: "pending", review_note: null, reviewed_by: null });
  });

  it("approbation sans motif ; le texte approuvé n'apparaît plus dans la file", async () => {
    const text = await textOf(member, "who_i_am");
    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: moderator, role: "authenticated" })]);
      await tx.exec("set local role authenticated");
      await tx.query("select app.review_profile_text($1, 'approved')", [text.id]);
    });
    expect(await textOf(member, "who_i_am")).toMatchObject({ review_status: "approved", review_note: null, reviewed_by: moderator });
    const queue = await asUser(db, moderator, async (tx) => (await tx.query<{ field: string }>("select field from app.moderation_queue()")).rows);
    expect(queue.map((q) => q.field)).toEqual(["what_matters"]);
    // Aucune notification pour une approbation
    expect((await db.query("select 1 from app.notifications where user_id = $1", [member])).rows).toHaveLength(1);
  });
});
