import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Photos (10.2, question 10 de la phase 3) : dossier du membre, 3 au plus, relecture par
 * l'équipe avec motif, aucune photo visible avant un match, flou choisi par le membre,
 * consultation de l'équipe journalisée, aucune écriture directe.
 */

let db: PGlite;
const p: Record<string, string> = {};
let event: string;

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Dépôt du fichier par l'API avec le jeton du membre, puis enregistrement. */
async function upload(user: string, name: string): Promise<string | null> {
  const path = `${user}/${name}.jpg`;
  const stored = await failure(as(user, "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [path]));
  if (stored) return stored;
  const [{ id }] = await as<{ id: string }>(user, "select app.add_photo($1) as id", [path]);
  return id;
}

const sees = async (user: string, photo: string) =>
  (await as<{ id: string }>(user, "select id from app.photos where id = $1", [photo])).length === 1 &&
  (await as<{ ok: boolean }>(user, "select app.can_view_photo($1) as ok", [photo]))[0]!.ok;

beforeAll(async () => {
  db = await createDb();
  p.afiwa = await createMember(db, { firstName: "Afiwa", sex: "female" });
  p.koffi = await createMember(db, { firstName: "Koffi", sex: "male" });
  p.dossou = await createMember(db, { firstName: "Dossou", sex: "male" });
  p.moderatrice = await createMember(db, { firstName: "Sèna", sex: "female", role: "moderator" });
  event = await createEvent(db, { startsInHours: -24, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Photos des membres (10.2, question 10)", () => {
  let photo: string;

  it("dépôt dans son propre dossier seulement ; 3 photos au plus", async () => {
    expect(await failure(as(p.afiwa!, "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [`${p.koffi}/x.jpg`]))).toMatch(
      /row-level security/,
    );
    expect(await failure(as(p.afiwa!, "select app.add_photo($1)", [`${p.koffi}/x.jpg`]))).toMatch(/invalid_photo/);
    expect(await failure(as(p.afiwa!, "select app.add_photo($1)", [`${p.afiwa}/absente.jpg`]))).toMatch(/invalid_photo/);
    photo = (await upload(p.afiwa!, "1"))!;
    await upload(p.afiwa!, "2");
    await upload(p.afiwa!, "3");
    const fourth = `${p.afiwa}/4.jpg`;
    await as(p.afiwa!, "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [fourth]);
    expect(await failure(as(p.afiwa!, "select app.add_photo($1)", [fourth]))).toMatch(/too_many_photos/);
    const mine = await as<{ review_status: string; photo_position: number }>(p.afiwa!, "select * from app.my_photos()");
    expect(mine.map((r) => [r.photo_position, r.review_status])).toEqual([
      [0, "pending"],
      [1, "pending"],
      [2, "pending"],
    ]);
  });

  it("aucune écriture directe dans la table des photos", async () => {
    expect(await failure(as(p.afiwa!, "insert into app.photos (user_id, storage_path) values ($1, 'x')", [p.afiwa]))).toMatch(/row-level security/);
    await as(p.afiwa!, "update app.photos set review_status = 'approved' where user_id = $1", [p.afiwa]);
    const { rows } = await db.query("select 1 from app.photos where user_id = $1 and review_status = 'approved'", [p.afiwa]);
    expect(rows).toEqual([]);
  });

  it("relecture : motif obligatoire pour un refus, notifié ; une photo refusée libère une place", async () => {
    const [, second] = (await as<{ photo_id: string }>(p.afiwa!, "select photo_id from app.my_photos()")).map((r) => r.photo_id);
    expect(await failure(as(p.koffi!, "select app.review_photo($1, true)", [photo]))).toMatch(/forbidden/);
    expect(await failure(as(p.moderatrice!, "select app.review_photo($1, false, ' ')", [second]))).toMatch(/note_required/);
    expect(await failure(as(p.moderatrice!, "select app.review_photo($1, false, 'Visage non visible')", [second]))).toBeNull();
    expect(await failure(as(p.moderatrice!, "select app.review_photo($1, true)", [second]))).toMatch(/already_reviewed/);
    expect(await failure(as(p.moderatrice!, "select app.review_photo($1, true)", [photo]))).toBeNull();
    const { rows } = await db.query<{ payload: { note: string } }>("select payload from app.notifications where user_id = $1 and kind = 'profile.photo_rejected'", [p.afiwa]);
    expect(rows[0]?.payload.note).toBe("Visage non visible");
    const queue = await as<{ photo_id: string }>(p.moderatrice!, "select * from app.photo_moderation_queue()");
    expect(queue).toHaveLength(1);
    expect(await upload(p.afiwa!, "5")).not.toBeNull();
  });

  it("aucune photo visible avant un match ; visible pendant l'attente et la découverte ; plus après la fin", async () => {
    expect(await sees(p.afiwa!, photo)).toBe(true);
    expect(await sees(p.koffi!, photo)).toBe(false);
    const { rows } = await db.query<{ id: string }>(
      "insert into app.matches (event_id, member_a, member_b, announced_at) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '1 hour') returning id",
      [event, p.afiwa, p.koffi],
    );
    const match = rows[0]!.id;
    expect(await sees(p.koffi!, photo)).toBe(false); // annoncé mais pas encore notifié
    await db.query("update app.matches set notified_at = now() where id = $1", [match]);
    expect(await sees(p.koffi!, photo)).toBe(true);
    expect(await sees(p.dossou!, photo)).toBe(false);
    const [pending] = await as<{ photo_id: string; review_status: string }>(p.afiwa!, "select * from app.my_photos() where review_status = 'pending'");
    expect(await sees(p.koffi!, pending!.photo_id)).toBe(false); // pas encore approuvée
    await db.query("update app.matches set status = 'discovery_open' where id = $1", [match]);
    expect(await sees(p.koffi!, photo)).toBe(true);
    await db.query("update app.matches set status = 'closed' where id = $1", [match]);
    expect(await sees(p.koffi!, photo)).toBe(false);
    await db.query("update app.matches set status = 'discovery_open' where id = $1", [match]);
  });

  it("affichage : flou si le membre l'a choisi, jamais pour lui-même ; filigrane au nom de celui qui regarde", async () => {
    const view = async (user: string) =>
      (await as<{ blurred: boolean; viewer_first_name: string; viewer_number: string }>(user, "select * from app.photo_for_view($1)", [photo]))[0]!;
    expect((await view(p.koffi!)).blurred).toBe(false);
    await db.query("update app.member_profiles set keep_photo_blurred = true where user_id = $1", [p.afiwa]);
    expect((await view(p.koffi!)).blurred).toBe(true);
    expect((await view(p.afiwa!)).blurred).toBe(false);
    expect((await view(p.koffi!)).viewer_first_name).toBe("Koffi");
    expect(await failure(as(p.dossou!, "select * from app.photo_for_view($1)", [photo]))).toMatch(/forbidden/);
  });

  it("stockage : le fichier n'est lisible que par qui peut voir la photo ; consultation de l'équipe journalisée", async () => {
    const path = `${p.afiwa}/1.jpg`;
    const read = async (user: string) => (await as(user, "select name from storage.objects where bucket_id = 'member-photos' and name = $1", [path])).length;
    expect(await read(p.koffi!)).toBe(1);
    expect(await read(p.dossou!)).toBe(0);
    await as(p.moderatrice!, "select * from app.photo_for_view($1)", [photo]);
    const { rows } = await db.query("select 1 from app.audit_log where action = 'photo.viewed' and actor_id = $1", [p.moderatrice]);
    expect(rows).toHaveLength(1);
  });

  it("retrait de sa propre photo seulement", async () => {
    expect(await failure(as(p.koffi!, "select app.remove_photo($1)", [photo]))).toMatch(/not_found/);
    const [{ path }] = await as<{ path: string }>(p.afiwa!, "select app.remove_photo($1) as path", [photo]);
    expect(path).toBe(`${p.afiwa}/1.jpg`);
  });
});
