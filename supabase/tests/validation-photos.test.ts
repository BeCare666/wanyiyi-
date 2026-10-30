import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asUser, createDb, failure, migrationFiles } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Décisions du 30 octobre 2026 : valider un dossier approuve les photos en relecture, et chaque
 * décision sur un dossier est notifiée au membre (espace et e-mail).
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

/** Membre en attente de vérification, avec un dossier complet (selfie et déclaration). */
async function pendingMember(firstName: string, photos: ("pending" | "rejected")[] = []) {
  const member = await createMember(db, { firstName, sex: "female", status: "pending_verification" });
  const { rows } = await db.query<{ id: string }>("insert into app.verifications (user_id) values ($1) returning id", [member]);
  const verification = rows[0]!.id;
  await db.query("insert into app.id_documents (verification_id, kind, part, storage_path) values ($1, 'selfie', 'face', $2)", [
    verification,
    `${member}/s.jpg`,
  ]);
  await db.query("insert into app.honor_declarations (user_id, declared_marital_status, has_children, text_version) values ($1, 'single', false, 'v1')", [
    member,
  ]);
  for (const [i, status] of photos.entries()) {
    await db.query("insert into app.photos (user_id, storage_path, review_status) values ($1, $2, $3::app.review_status)", [
      member,
      `${member}/p${i}.jpg`,
      status,
    ]);
  }
  return { member, verification };
}

type Observed = {
  error: string | null;
  photos: string[];
  audited: number;
  notifications: { kind: string; payload: Record<string, unknown>; channels: string[] }[];
  booking?: string | null;
};

/**
 * Décision de l'équipe puis lecture de l'état, dans la même transaction (asUser annule tout à la
 * fin) ; `then` permet d'enchaîner une autre étape avant la lecture.
 */
const decide = (verification: string, status: string, note: string | null, member: string, then?: (tx: Transaction) => Promise<void>, bookEvent?: string) =>
  asUser(db, admin, async (tx): Promise<Observed> => {
    const error = await failure(tx.query("select app.decide_verification($1, $2::app.verification_status, $3)", [verification, status, note]));
    let booking: string | null | undefined;
    if (bookEvent) {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: member, role: "authenticated" })]);
      booking = await failure(tx.query("select app.book_event($1)", [bookEvent]));
    }
    await tx.exec("reset role");
    if (then) await then(tx);
    const photos = (await tx.query<{ review_status: string }>("select review_status from app.photos where user_id = $1 order by storage_path", [member])).rows.map(
      (r) => r.review_status,
    );
    const audited = (
      await tx.query<{ n: number }>(
        "select count(*)::int as n from app.audit_log where action = 'photo.approved' and actor_id = $1 and target_id in (select id from app.photos where user_id = $2)",
        [admin, member],
      )
    ).rows[0]!.n;
    const notifications = (
      await tx.query<Observed["notifications"][number]>(
        `select n.kind, n.payload, coalesce(array_agg(d.channel::text) filter (where d.id is not null), '{}') as channels
         from app.notifications n left join app.notification_deliveries d on d.notification_id = n.id
         where n.user_id = $1 group by n.id order by n.created_at`,
        [member],
      )
    ).rows;
    return { error, photos, audited, notifications, ...(bookEvent ? { booking } : {}) };
  });

describe("Validation d'un dossier et photos du profil", () => {
  it("valider approuve les photos en relecture (journalisé), une photo refusée reste refusée", async () => {
    const { member, verification } = await pendingMember("Houéfa", ["pending", "pending", "rejected"]);
    const seen = await decide(verification, "approved", null, member);
    expect(seen).toMatchObject({ error: null, photos: ["approved", "approved", "rejected"], audited: 2 });
  });

  it("le membre validé avec sa photo peut réserver aussitôt", async () => {
    const event = await createEvent(db, { startsInHours: 72 });
    const { member, verification } = await pendingMember("Sènami", ["pending"]);
    expect((await decide(verification, "approved", null, member, undefined, event)).booking).toBeNull();
  });

  it("une demande de correction ne touche pas aux photos", async () => {
    const { member, verification } = await pendingMember("Ayaba", ["pending"]);
    expect(await decide(verification, "to_correct", "Selfie flou.", member)).toMatchObject({ error: null, photos: ["pending"], audited: 0 });
  });
});

describe("Notification de la décision au membre", () => {
  it("validé : notification dans l'espace et e-mail", async () => {
    const { member, verification } = await pendingMember("Kémi");
    expect((await decide(verification, "approved", null, member)).notifications).toEqual([
      { kind: "verification.approved", payload: {}, channels: ["email"] },
    ]);
  });

  it("correction demandée : le message de l'équipe est joint", async () => {
    const { member, verification } = await pendingMember("Yétondé");
    expect((await decide(verification, "to_correct", "Selfie flou.", member)).notifications).toEqual([
      { kind: "verification.to_correct", payload: { reason: "Selfie flou." }, channels: ["email"] },
    ]);
  });

  it("refusé : motif joint s'il y en a un ; sans motif, notification simple", async () => {
    const a = await pendingMember("Mahougnon");
    expect((await decide(a.verification, "rejected", "Personne différente du selfie.", a.member)).notifications).toEqual([
      { kind: "verification.rejected", payload: { reason: "Personne différente du selfie." }, channels: ["email"] },
    ]);
    const b = await pendingMember("Afiavi");
    expect((await decide(b.verification, "rejected", null, b.member)).notifications).toEqual([
      { kind: "verification.rejected", payload: {}, channels: ["email"] },
    ]);
  });

  it("e-mail désactivé dans les paramètres : notification dans l'espace seulement", async () => {
    const { member, verification } = await pendingMember("Nadège");
    await db.query("insert into app.notification_preferences (user_id, channel, enabled) values ($1, 'email', false)", [member]);
    expect((await decide(verification, "approved", null, member)).notifications).toEqual([
      { kind: "verification.approved", payload: {}, channels: [] },
    ]);
  });

  it("un nouveau dépôt après correction n'envoie rien au membre", async () => {
    const { member, verification } = await pendingMember("Codjo");
    const seen = await decide(verification, "to_correct", "Selfie flou.", member, async (tx) => {
      await tx.query("update app.verifications set status = 'pending' where id = $1", [verification]);
    });
    expect(seen.notifications.map((n) => n.kind)).toEqual(["verification.to_correct"]);
  });
});

describe("Rattrapage du 30 octobre", () => {
  it("les photos en relecture des membres déjà validés sont approuvées, pas celles des autres", async () => {
    const verified = await createMember(db, { firstName: "Bella", sex: "female" });
    const waiting = await createMember(db, { firstName: "Takpa", sex: "male", status: "pending_verification" });
    for (const m of [verified, waiting]) {
      await db.query("insert into app.photos (user_id, storage_path, review_status) values ($1, $2, 'pending')", [m, `${m}/r.jpg`]);
    }
    const sql = readFileSync(join(__dirname, "../migrations", migrationFiles().find((f) => f.includes("20261030000000"))!), "utf8");
    await db.exec(sql.slice(sql.indexOf("-- Rattrapage")));
    const { rows } = await db.query<{ user_id: string; review_status: string }>("select user_id, review_status from app.photos where user_id = any($1)", [
      [verified, waiting],
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.user_id, r.review_status]))).toEqual({ [verified]: "approved", [waiting]: "pending" });
  });
});
