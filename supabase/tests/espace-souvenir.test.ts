import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Espace souvenir (phase 4, question 1 validée le 27 octobre 2026) : photos de l'union (3 par
 * membre, relues, visibles des deux seulement), espace gardé après la suppression du compte de
 * l'autre sans son prénom ni ses photos, suivi post-union par le conseiller.
 */

let db: PGlite;
const p: Record<string, string> = {};

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

async function couple(a: string, b: string, status: string, counselor: string | null = null) {
  const event = await createEvent(db, { startsInHours: -48, status: "finished" });
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now(), 'continued') returning id", [m.id]);
  const c = await one<{ id: string }>(
    "insert into app.couples (discovery_id, member_a, member_b, status, memory_space, counselor_id) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), $4::app.couple_status, $4::text = 'union_celebrated', $5) returning id",
    [d.id, a, b, status, counselor],
  );
  await db.query("insert into app.conversations (kind, couple_id, read_only) values ('couple', $1, $2::text = 'union_celebrated')", [c.id, status]);
  return c.id;
}

/** Dépôt du fichier par l'API avec le jeton du membre, puis enregistrement. */
async function upload(user: string, coupleId: string, name: string): Promise<string> {
  const path = `${user}/union-${name}.jpg`;
  await as(user, "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [path]);
  const [{ id }] = await as<{ id: string }>(user, "select app.add_union_photo($1, $2) as id", [coupleId, path]);
  return id;
}

const sees = async (user: string, photo: string) => (await as<{ ok: boolean }>(user, "select app.can_view_union_photo($1) as ok", [photo]))[0]!.ok;

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["moderatrice", "female", "moderator"],
    ["conseillere", "female", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  await db.query("insert into app.counselors (user_id, display_name, max_couples) values ($1, 'Mme Conseillère', 1)", [p.conseillere]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Photos de l'union (question 1 a)", () => {
  let union: string;
  let photo: string;

  it("seulement après l'union, dans son dossier, 3 par membre", async () => {
    const live = await couple(p.sena!, p.dossou!, "active");
    await as(p.sena!, "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [`${p.sena}/union-x.jpg`]);
    expect(await failure(as(p.sena!, "select app.add_union_photo($1, $2)", [live, `${p.sena}/union-x.jpg`]))).toMatch(/not_union/);

    union = await couple(p.afiwa!, p.koffi!, "union_celebrated");
    expect(await failure(as(p.afiwa!, "select app.add_union_photo($1, $2)", [union, `${p.koffi}/x.jpg`]))).toMatch(/invalid_photo/);
    expect(await failure(as(p.sena!, "select app.add_union_photo($1, $2)", [union, `${p.sena}/union-x.jpg`]))).toMatch(/not_member/);
    photo = await upload(p.afiwa!, union, "1");
    await upload(p.afiwa!, union, "2");
    await upload(p.afiwa!, union, "3");
    await as(p.afiwa!, "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [`${p.afiwa}/union-4.jpg`]);
    expect(await failure(as(p.afiwa!, "select app.add_union_photo($1, $2)", [union, `${p.afiwa}/union-4.jpg`]))).toMatch(/too_many_photos/);
    // L'autre membre a ses propres 3 photos
    await upload(p.koffi!, union, "1");
    expect(await failure(as(p.afiwa!, "insert into app.union_photos (couple_id, user_id, storage_path) values ($1, $2, 'x')", [union, p.afiwa]))).toMatch(
      /permission denied|row-level security/,
    );
  });

  it("relues par la modération ; visibles de l'autre une fois approuvées, de personne d'autre", async () => {
    expect(await sees(p.koffi!, photo)).toBe(false);
    expect(await sees(p.afiwa!, photo)).toBe(true);
    const queue = await as<{ photo_id: string }>(p.moderatrice!, "select * from app.union_photo_moderation_queue()");
    expect(queue.map((r) => r.photo_id)).toContain(photo);
    expect(await failure(as(p.afiwa!, "select * from app.union_photo_moderation_queue()"))).toMatch(/forbidden/);
    await as(p.moderatrice!, "select app.review_union_photo($1, true)", [photo]);
    expect(await sees(p.koffi!, photo)).toBe(true);
    expect(await sees(p.sena!, photo)).toBe(false);
    const path = `${p.afiwa}/union-1.jpg`;
    expect(await as(p.koffi!, "select name from storage.objects where name = $1", [path])).toHaveLength(1);
    expect(await as(p.sena!, "select name from storage.objects where name = $1", [path])).toHaveLength(0);
    const [view] = await as<{ storage_path: string; blurred: boolean; viewer_first_name: string }>(p.koffi!, "select * from app.union_photo_for_view($1)", [photo]);
    expect(view).toMatchObject({ storage_path: path, blurred: false, viewer_first_name: "koffi" });
  });

  it("refus avec motif, notifié ; l'autre ne voit que les photos approuvées", async () => {
    const [second] = await as<{ photo_id: string }>(p.afiwa!, "select photo_id from app.memory_space_photos($1) where mine and review_status = 'pending' limit 1", [union]);
    expect(await failure(as(p.moderatrice!, "select app.review_union_photo($1, false)", [second!.photo_id]))).toMatch(/note_required/);
    await as(p.moderatrice!, "select app.review_union_photo($1, false, 'Visage d''un enfant')", [second!.photo_id]);
    const mine = await as<{ photo_id: string; review_note: string | null }>(p.afiwa!, "select * from app.memory_space_photos($1)", [union]);
    expect(mine.find((r) => r.photo_id === second!.photo_id)!.review_note).toBe("Visage d'un enfant");
    const notes = await one<{ n: number }>("select count(*)::int as n from app.notifications where user_id = $1 and kind = 'couple.union_photo_rejected'", [p.afiwa]);
    expect(notes.n).toBe(1);
    const partner = await as<{ photo_id: string; mine: boolean }>(p.koffi!, "select * from app.memory_space_photos($1)", [union]);
    expect(partner.filter((r) => !r.mine).map((r) => r.photo_id)).toEqual([photo]);
    // Retrait par son auteur seulement
    expect(await failure(as(p.koffi!, "select app.remove_union_photo($1)", [photo]))).toMatch(/not_found/);
  });

  it("compte supprimé : espace gardé pour l'autre, sans prénom ni photos ; photos effacées à la purge", async () => {
    await db.query("update app.member_profiles set status = 'deleted' where user_id = $1", [p.afiwa]);
    const [row] = await as<{ couple_id: string; partner_first_name: string | null; status: string }>(p.koffi!, "select * from app.my_couple()");
    expect(row).toMatchObject({ couple_id: union, partner_first_name: null, status: "union_celebrated" });
    expect(await sees(p.koffi!, photo)).toBe(false);
    expect(await as(p.koffi!, "select * from app.memory_space_photos($1) where not mine", [union])).toEqual([]);

    // Effacement réel (tâche de l'API), délai de 30 jours écoulé
    await db.query(
      "insert into app.account_deletions (user_id, requested_at, purge_after, previous_status) values ($1, now(), now() - interval '1 minute', 'verified')",
      [p.afiwa],
    );
    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
      await tx.exec("set local role service_role");
      await tx.query("select app.purge_deleted_accounts()");
    });
    expect((await one<{ n: number }>("select count(*)::int as n from app.member_profiles where user_id = $1", [p.afiwa])).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from app.union_photos where user_id = $1", [p.afiwa])).n).toBe(0);
    const [after] = await as<{ couple_id: string; partner_first_name: string | null }>(p.koffi!, "select * from app.my_couple()");
    expect(after).toMatchObject({ couple_id: union, partner_first_name: null });
    expect(await as(p.koffi!, "select * from app.memory_space_photos($1) where mine", [union])).toHaveLength(1);
  });
});

describe("Suivi post-union (question 1 d)", () => {
  it("demandé et accepté par les deux, attribué (ancien conseiller proposé), séances possibles", async () => {
    const c = await couple(p.sena!, p.dossou!, "union_celebrated", p.conseillere);
    await db.query("insert into app.settings (key, value) values ('counselor.access_price_xof', '0') on conflict (key) do update set value = '0'");
    const [{ id: access }] = await as<{ id: string }>(p.sena!, "select app.request_counselor_access($1, false) as id", [c]);
    await as(p.dossou!, "select app.answer_counselor_access($1, true, false)", [access]);
    const admin = await createMember(db, { firstName: "admin", sex: "female", role: "super_admin" });
    const list = await as<{ access_id: string; couple_status: string; previous_counselor_name: string | null }>(admin, "select * from app.admin_counselor_requests()");
    expect(list.find((r) => r.access_id === access)).toMatchObject({ couple_status: "union_celebrated", previous_counselor_name: "Mme Conseillère" });
    await as(admin, "select app.admin_assign_counselor($1, $2)", [access, p.conseillere]);
    expect((await as<{ n: number }>(admin, "select app.counselor_load($1) as n", [p.conseillere]))[0]!.n).toBe(1);

    const [{ id: session }] = await as<{ id: string }>(p.conseillere!, "select app.propose_session($1, now() + interval '3 days', 'online', null) as id", [c]);
    await as(p.sena!, "select app.accept_session($1)", [session]);
    expect((await as<{ r: string }>(p.dossou!, "select app.accept_session($1) as r", [session]))[0]!.r).toBe("confirmed");

    // Arrêt par l'un ou l'autre à tout moment
    await as(p.dossou!, "select app.revoke_counselor_access($1)", [access]);
    expect(await failure(as(p.conseillere!, "select app.propose_session($1, now() + interval '4 days', 'online', null)", [c]))).toMatch(/not_counselor/);
  });

  it("séparés : toujours pas de conseiller", async () => {
    const c = await couple(p.koffi!, p.dossou!, "separated");
    expect(await failure(as(p.koffi!, "select app.request_counselor_access($1, false)", [c]))).toMatch(/couple_closed/);
  });
});
