import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Participants d'une soirée visibles avant de réserver (décision du 29 octobre 2026) : inscrits
 * de l'autre sexe, prénom, âge, ville, secteur, religion, textes approuvés, copie floutée de la
 * photo ; réglage pour ne pas apparaître.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

type Participant = { user_id: string; first_name: string; age: number; city: string; sector: string | null; religion: string | null; texts: { field: string; body: string }[]; photo_id: string | null };

const participants = (viewer: string, event: string) =>
  asUser(db, viewer, async (tx) => (await tx.query<Participant>("select * from app.evening_participants($1)", [event])).rows);

async function storedFile(path: string) {
  await db.query("insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [path]);
}

/** Photo approuvée avec sa copie floutée, comme après un dépôt par l'API. */
async function photoWithPreview(userId: string) {
  await storedFile(`${userId}/p.jpg`);
  await storedFile(`${userId}/apercu-p.jpg`);
  const { rows } = await db.query<{ id: string }>(
    "insert into app.photos (user_id, storage_path, review_status, preview_path) values ($1, $2, 'approved', $3) returning id",
    [userId, `${userId}/p.jpg`, `${userId}/apercu-p.jpg`],
  );
  return rows[0]!.id;
}

async function setting() {
  const event = await createEvent(db, { startsInHours: 96 });
  const viewer = await createMember(db, { firstName: "Koffi", sex: "male" });
  const afiwa = await createMember(db, { firstName: "Afiwa", sex: "female", religion: "catholic", sector: "health", birthDate: "1994-01-10" });
  const photo = await photoWithPreview(afiwa);
  await db.query("insert into app.profile_texts (user_id, field, body, review_status) values ($1, 'who_i_am', 'Infirmière, j''aime lire.', 'approved'), ($1, 'what_matters', 'Texte en relecture', 'pending')", [afiwa]);
  await register(db, event, afiwa, "female", "booked");
  return { event, viewer, afiwa, photo };
}

describe("Participants d'une soirée avant de réserver", () => {
  it("un membre vérifié voit les inscrits de l'autre sexe : prénom, âge, ville, secteur, religion, textes approuvés, photo floutée", async () => {
    const { event, viewer, afiwa, photo } = await setting();
    const sameSex = await createMember(db, { firstName: "Dossou", sex: "male" });
    await register(db, event, sameSex, "male", "booked");
    const list = await participants(viewer, event);
    expect(list).toEqual([
      { user_id: afiwa, first_name: "Afiwa", age: expect.any(Number), city: "Cotonou", sector: "health", religion: "catholic", texts: [{ field: "who_i_am", body: "Infirmière, j'aime lire." }], photo_id: photo },
    ]);
    expect(list[0]!.age).toBeGreaterThanOrEqual(32);
  });

  it("ni nom de famille ni photo nette : seule la copie floutée est lisible", async () => {
    const { event, viewer, afiwa, photo } = await setting();
    const view = await asUser(db, viewer, async (tx) => ({
      preview: (await tx.query<{ storage_path: string }>("select * from app.evening_preview_for_view($1, $2)", [event, photo])).rows[0]?.storage_path,
      original: (await tx.query<{ v: boolean }>("select app.can_view_photo_path($1) as v", [`${afiwa}/p.jpg`])).rows[0]!.v,
      previewFile: (await tx.query<{ v: boolean }>("select app.can_view_preview_path($1) as v", [`${afiwa}/apercu-p.jpg`])).rows[0]!.v,
      originalAsPreview: (await tx.query<{ v: boolean }>("select app.can_view_preview_path($1) as v", [`${afiwa}/p.jpg`])).rows[0]!.v,
    }));
    expect(view).toEqual({ preview: `${afiwa}/apercu-p.jpg`, original: false, previewFile: true, originalAsPreview: false });
  });

  it("réglage « ne pas apparaître » : absent des listes, voit quand même les autres", async () => {
    const { event, viewer, afiwa, photo } = await setting();
    await asUser(db, afiwa, (tx) => tx.query("update app.member_profiles set show_in_evening_previews = false where user_id = $1", [afiwa]));
    await db.query("update app.member_profiles set show_in_evening_previews = false where user_id = $1", [afiwa]);
    expect(await participants(viewer, event)).toEqual([]);
    expect(await asUser(db, viewer, async (tx) => (await tx.query("select * from app.evening_preview_for_view($1, $2)", [event, photo])).rows)).toEqual([]);
    await register(db, event, viewer, "male", "booked");
    expect((await participants(afiwa, event)).map((p) => p.first_name)).toEqual(["Koffi"]);
  });

  it("membre non vérifié, soirée passée ou brouillon, liste d'attente et inscription annulée : rien", async () => {
    const { event, afiwa } = await setting();
    const pending = await createMember(db, { firstName: "Codjo", sex: "male", status: "pending_verification" });
    expect(await asUser(db, pending, (tx) => failure(tx.query("select * from app.evening_participants($1)", [event])))).toMatch(/not_validated/);
    const viewer = await createMember(db, { firstName: "Sèna", sex: "male" });
    const past = await createEvent(db, { startsInHours: -2 });
    expect(await asUser(db, viewer, (tx) => failure(tx.query("select * from app.evening_participants($1)", [past])))).toMatch(/evening_closed/);
    const draft = await createEvent(db, { startsInHours: 96, status: "draft" });
    expect(await asUser(db, viewer, (tx) => failure(tx.query("select * from app.evening_participants($1)", [draft])))).toMatch(/evening_closed/);
    await db.query("update app.event_registrations set status = 'cancelled' where event_id = $1 and user_id = $2", [event, afiwa]);
    expect(await participants(viewer, event)).toEqual([]);
  });

  it("copie floutée : déposée par le membre pour sa propre photo ; tâche système pour les anciennes photos", async () => {
    const member = await createMember(db, { firstName: "Mariam", sex: "female" });
    await storedFile(`${member}/q.jpg`);
    const { rows } = await db.query<{ id: string }>("insert into app.photos (user_id, storage_path) values ($1, $2) returning id", [member, `${member}/q.jpg`]);
    const photo = rows[0]!.id;
    const other = await createMember(db, { firstName: "Kémi", sex: "female" });
    await storedFile(`${member}/apercu-q.jpg`);
    expect(await asUser(db, other, (tx) => failure(tx.query("select app.set_photo_preview($1, $2)", [photo, `${member}/apercu-q.jpg`])))).toMatch(/invalid_photo/);
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.set_photo_preview($1, $2)", [photo, `${member}/absent.jpg`])))).toMatch(/invalid_photo/);
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.set_photo_preview($1, $2)", [photo, `${member}/apercu-q.jpg`])))).toBeNull();
    // Tâche système : liste des photos sans copie, puis marquage ; refusé aux membres
    const todo = await asService(db, async (tx) => (await tx.query<{ photo_id: string }>("select * from app.photos_without_preview(500)")).rows.map((r) => r.photo_id));
    expect(todo).toContain(photo);
    expect(await asUser(db, member, (tx) => failure(tx.query("select * from app.photos_without_preview(10)")))).toMatch(/permission denied/);
  });
});
