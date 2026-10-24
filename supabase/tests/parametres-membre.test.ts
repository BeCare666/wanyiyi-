import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Paramètres du membre (questions 15 à 17, réponses du 24 octobre 2026) : confidentialité (photo
 * cachée jusqu'au match, numéro partagé après un match), téléchargement de mes données, suppression
 * du compte avec un délai de 30 jours.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** Comme asUser, mais la transaction est validée (étapes successives d'un même membre). */
async function commitAs<T>(user: string, fn: (tx: Parameters<Parameters<PGlite["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

const statusOf = async (user: string) =>
  (await db.query<{ status: string }>("select status from app.member_profiles where user_id = $1", [user])).rows[0]?.status;

/** Soirée passée avec un tour : la membre vote pour son vis-à-vis. */
async function pastEveningWithVote(woman: string, man: string) {
  const event = await createEvent(db, { startsInHours: -30, status: "finished" });
  const { rows: tables } = await db.query<{ id: string }>(
    `insert into app.event_tables (event_id, table_number, qr_token, qr_valid_from, qr_valid_until)
     values ($1, 1, gen_random_uuid()::text, now() - interval '31 hours', now() - interval '27 hours') returning id`,
    [event],
  );
  const { rows: rounds } = await db.query<{ id: string }>("insert into app.rounds (event_id, round_number) values ($1, 1) returning id", [event]);
  const { rows: pairings } = await db.query<{ id: string }>(
    "insert into app.round_pairings (round_id, table_id, woman_id, man_id) values ($1, $2, $3, $4) returning id",
    [rounds[0]!.id, tables[0]!.id, woman, man],
  );
  await db.query("insert into app.votes (pairing_id, voter_id, target_id, choice) values ($1, $2, $3, 'yes')", [pairings[0]!.id, woman, man]);
  await db.query("insert into app.votes (pairing_id, voter_id, target_id, choice) values ($1, $2, $3, 'yes')", [pairings[0]!.id, man, woman]);
  return event;
}

describe("Confidentialité (question 15)", () => {
  it("par défaut : photo cachée jusqu'au match, numéro partagé ; le membre change ses réglages, pas ceux d'un autre", async () => {
    const member = await createMember(db, { firstName: "Houéfa", sex: "female" });
    const other = await createMember(db, { firstName: "Codjo", sex: "male" });
    const { rows } = await db.query<{ photo_blurred: boolean; share_phone: boolean }>(
      "select photo_blurred, share_phone from app.member_profiles where user_id = $1",
      [member],
    );
    expect(rows[0]).toEqual({ photo_blurred: true, share_phone: true });

    const result = await asUser(db, member, async (tx) => {
      await tx.query("update app.member_profiles set photo_blurred = false, share_phone = false where user_id = $1", [member]);
      const touched = await tx.query("update app.member_profiles set share_phone = false where user_id = $1", [other]);
      const own = (await tx.query<{ photo_blurred: boolean; share_phone: boolean }>("select photo_blurred, share_phone from app.member_profiles where user_id = $1", [member])).rows[0];
      return { own, touched: touched.affectedRows };
    });
    expect(result.own).toEqual({ photo_blurred: false, share_phone: false });
    expect(result.touched).toBe(0);
  });
});

describe("Mes données (question 16)", () => {
  it("profil, soirées, votes donnés, matchs annoncés, paiements et notifications du membre seulement", async () => {
    const woman = await createMember(db, { firstName: "Folake", sex: "female" });
    const man = await createMember(db, { firstName: "Sèdjro", sex: "male" });
    const event = await pastEveningWithVote(woman, man);
    await register(db, event, woman, "female", "checked_in", 31);
    const [a, b] = [woman, man].sort();
    await db.query("insert into app.matches (event_id, member_a, member_b, announced_at) values ($1, $2, $3, now() - interval '1 hour')", [event, a, b]);
    const hidden = await createEvent(db, { startsInHours: -2, status: "finished" });
    await db.query("insert into app.matches (event_id, member_a, member_b, announced_at) values ($1, $2, $3, now() + interval '10 hours')", [hidden, a, b]);
    await db.query("insert into app.payments (user_id, purpose, amount_xof, provider, status) values ($1, 'evening_booking', 10000, 'feexpay', 'succeeded')", [woman]);
    await db.query("insert into app.notifications (user_id, kind) values ($1, 'match.announced')", [woman]);
    await db.query("insert into app.notifications (user_id, kind) values ($1, 'match.announced')", [man]);

    const data = await asUser(db, woman, async (tx) => (await tx.query<{ d: Record<string, unknown> }>("select app.my_data() as d")).rows[0]!.d);
    expect(data.profile).toMatchObject({ first_name: "Folake", last_name: "Fictif", photo_hidden_until_match: true, share_phone_after_match: true });
    expect(data.evenings).toEqual([expect.objectContaining({ status: "checked_in" })]);
    expect(data.votes).toEqual([expect.objectContaining({ round: 1, partner_first_name: "Sèdjro", choice: "yes" })]);
    expect(data.matches).toEqual([expect.objectContaining({ partner_first_name: "Sèdjro" })]);
    expect(data.payments).toEqual([expect.objectContaining({ amount_xof: 10000, status: "succeeded" })]);
    expect(data.notifications).toEqual([expect.objectContaining({ kind: "match.announced" })]);
    expect(data.deletion).toBeNull();

    // Sans connexion : refusé
    expect(await asAnon(db, (tx) => failure(tx.query("select app.my_data()")))).toMatch(/permission denied/);
  });
});

describe("Suppression du compte (question 17)", () => {
  it("refusée tant qu'une soirée à venir n'est pas annulée (réservation ou liste d'attente)", async () => {
    const booked = await createMember(db, { firstName: "Ayaba", sex: "female" });
    const waiting = await createMember(db, { firstName: "Kémi", sex: "female" });
    const event = await createEvent(db, { startsInHours: 72 });
    await register(db, event, booked, "female", "confirmed", 10);
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [event, waiting]);
    for (const user of [booked, waiting]) {
      expect(await asUser(db, user, (tx) => failure(tx.query("select app.request_account_deletion()")))).toMatch(/upcoming_evening/);
    }
    // Annulée par le membre : demande acceptée
    const accepted = await asUser(db, booked, async (tx) => {
      await tx.query("select app.cancel_registration($1)", [event]);
      return failure(tx.query("select app.request_account_deletion()"));
    });
    expect(accepted).toBeNull();
  });

  it("compte masqué tout de suite, découverte clôturée et l'autre prévenu ; annulable pendant 30 jours", async () => {
    const member = await createMember(db, { firstName: "Nadège", sex: "female" });
    const partner = await createMember(db, { firstName: "Mawuli", sex: "male" });
    const event = await createEvent(db, { startsInHours: -50, status: "finished" });
    const [a, b] = [member, partner].sort();
    const { rows: m } = await db.query<{ id: string }>(
      "insert into app.matches (event_id, member_a, member_b, status, announced_at) values ($1, $2, $3, 'discovery_open', now() - interval '1 day') returning id",
      [event, a, b],
    );
    await db.query("insert into app.discoveries (match_id, ends_at) values ($1, now() + interval '13 days')", [m[0]!.id]);

    const purgeAfter = await commitAs(member, async (tx) => (await tx.query<{ d: string }>("select app.request_account_deletion() as d")).rows[0]!.d);
    const days = (new Date(purgeAfter).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(await statusOf(member)).toBe("deleted");
    const { rows: discovery } = await db.query<{ status: string }>("select status from app.discoveries where match_id = $1", [m[0]!.id]);
    expect(discovery[0]!.status).toBe("closed");
    const { rows: notes } = await db.query<{ kind: string }>("select kind from app.notifications where user_id = $1", [partner]);
    expect(notes.map((n) => n.kind)).toEqual(["discovery.partner_left"]);
    const { rows: audit } = await db.query("select 1 from app.audit_log where action = 'account.deletion_requested' and target_id = $1", [member]);
    expect(audit).toHaveLength(1);

    // Masqué : plus de réservation possible, seconde demande refusée
    const later = await createEvent(db, { startsInHours: 100 });
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.book_event($1)", [later])))).toMatch(/not_validated/);
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.request_account_deletion()")))).toMatch(/already_requested/);
    // Le membre ne pose pas lui-même l'état « deleted » ni ne le retire
    expect(await asUser(db, member, (tx) => failure(tx.query("update app.member_profiles set status = 'verified' where user_id = $1", [member])))).toMatch(/forbidden_column/);

    await commitAs(member, (tx) => tx.query("select app.cancel_account_deletion()"));
    expect(await statusOf(member)).toBe("verified");
    const { rows: left } = await db.query("select 1 from app.account_deletions where user_id = $1", [member]);
    expect(left).toHaveLength(0);
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.cancel_account_deletion()")))).toMatch(/no_request/);
  });

  it("au bout de 30 jours : données effacées, paiements et journal gardés sans nom ; tâche système seulement", async () => {
    const member = await createMember(db, { firstName: "Sènami", sex: "female" });
    const other = await createMember(db, { firstName: "Gbènou", sex: "male" });
    await pastEveningWithVote(member, other);
    await db.query("insert into app.profile_texts (user_id, field, body) values ($1, 'who_i_am', 'Texte fictif')", [member]);
    await db.query("insert into app.notifications (user_id, kind) values ($1, 'match.announced')", [member]);
    const { rows: pay } = await db.query<{ id: string }>(
      "insert into app.payments (user_id, purpose, amount_xof, provider, status) values ($1, 'evening_booking', 10000, 'feexpay', 'succeeded') returning id",
      [member],
    );
    await commitAs(member, (tx) => tx.query("select app.request_account_deletion()"));

    const purge = () => asService(db, async (tx) => (await tx.query<{ id: string }>("select app.purge_deleted_accounts() as id")).rows.map((r) => r.id));
    expect(await purge()).not.toContain(member); // délai pas encore écoulé
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.purge_deleted_accounts()")))).toMatch(/permission denied|forbidden/);

    await db.query("update app.account_deletions set purge_after = now() - interval '1 minute' where user_id = $1", [member]);
    // Délai écoulé : l'annulation n'est plus possible
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.cancel_account_deletion()")))).toMatch(/no_request/);

    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
      await tx.exec("set local role service_role");
      const { rows } = await tx.query<{ id: string }>("select app.purge_deleted_accounts() as id");
      expect(rows.map((r) => r.id)).toEqual([member]);
    });

    const count = async (sql: string) => (await db.query(sql, [member])).rows.length;
    expect(await count("select 1 from app.member_profiles where user_id = $1")).toBe(0);
    expect(await count("select 1 from app.profile_texts where user_id = $1")).toBe(0);
    expect(await count("select 1 from app.votes where voter_id = $1")).toBe(0);
    expect(await count("select 1 from app.notifications where user_id = $1")).toBe(0);
    expect(await count("select 1 from app.audit_log where actor_id = $1 or target_id = $1")).toBe(0);
    expect(await count("select 1 from app.users where id = $1 and phone is null and deleted_at is not null")).toBe(1);
    const { rows: kept } = await db.query<{ user_id: string | null; amount_xof: number }>("select user_id, amount_xof from app.payments where id = $1", [pay[0]!.id]);
    expect(kept[0]).toEqual({ user_id: null, amount_xof: 10000 });
    // Le vote reçu de l'autre membre reste dans son historique
    expect((await db.query("select 1 from app.votes where voter_id = $1", [other])).rows).toHaveLength(1);

    // L'API efface ensuite les fichiers et le compte Auth, puis le marque
    const toClean = () => asService(db, async (tx) => (await tx.query<{ id: string }>("select app.accounts_to_clean() as id")).rows.map((r) => r.id));
    expect(await toClean()).toEqual([member]);
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("select app.mark_account_cleaned($1)", [member]);
    });
    expect(await toClean()).toEqual([]);
    expect(await purge()).toEqual([]);
  });
});
