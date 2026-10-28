import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Parrainage et badges de confiance (phase 4, questions 4 et 5 validées le 27 octobre 2026).
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

async function asApi<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

/** Soirée à 10 000 FCFA réservée par le membre, avec un paiement (réussi ou non). */
async function bookedEvening(user: string, sex: "female" | "male", paid: boolean, status = "confirmed") {
  const event = await createEvent(db, { startsInHours: 48 });
  await db.query("update app.events set price_xof = 10000 where id = $1", [event]);
  await register(db, event, user, sex, status);
  const pay = await one<{ id: string }>(
    "insert into app.payments (user_id, purpose, amount_xof, provider, status) values ($1, 'evening_booking', 10000, 'simulated', $2::app.payment_status) returning id",
    [user, paid ? "succeeded" : "pending"],
  );
  await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [pay.id, event, user]);
  return { event, payment: pay.id };
}

const checkIn = (event: string, user: string) =>
  db.query("update app.event_registrations set status = 'checked_in', checked_in_at = now() where event_id = $1 and user_id = $2", [event, user]);

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, status, role] of [
    ["marraine", "female", "verified", "member"],
    ["filleul", "male", "pending_verification", "member"],
    ["filleule", "female", "verified", "member"],
    ["nouveau", "male", "registering", "member"],
    ["admin", "female", "verified", "admin"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, status, role });
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Parrainage (question 4)", () => {
  let code: string;

  it("code personnel pour un membre vérifié seulement, stable", async () => {
    expect(await failure(as(p.filleul!, "select app.my_referral_code()"))).toMatch(/not_verified/);
    code = (await as<{ c: string }>(p.marraine!, "select app.my_referral_code() as c"))[0]!.c;
    expect(code).toMatch(/^[0-9A-F]{8}$/);
    expect((await as<{ c: string }>(p.marraine!, "select app.my_referral_code() as c"))[0]!.c).toBe(code);
    expect((await as<{ ok: boolean }>(p.nouveau!, "select app.referral_code_valid($1) as ok", [code.toLowerCase()]))[0]!.ok).toBe(true);
  });

  it("filleul : code saisi à l'inscription, une seule fois, jamais le sien", async () => {
    expect(await failure(as(p.filleul!, "select app.set_referrer('FFFFFFFF')"))).toMatch(/invalid_referral_code/);
    expect(await failure(as(p.marraine!, "select app.set_referrer($1)", [code]))).toMatch(/own_code/);
    await as(p.filleul!, "select app.set_referrer($1)", [code]);
    expect(await failure(as(p.filleul!, "select app.set_referrer($1)", [code]))).toMatch(/already_referred/);
    await as(p.filleule!, "select app.set_referrer($1)", [code]);
    const mine = await as<{ first_name: string; acquired: boolean }>(p.marraine!, "select * from app.my_referrals()");
    expect(mine.map((r) => [r.first_name, r.acquired]).sort()).toEqual([
      ["filleul", false],
      ["filleule", false],
    ]);
  });

  it("acquis à la première soirée payée ET pointée ; réduction de 2 000 FCFA pour le parrain", async () => {
    const unpaid = await bookedEvening(p.filleul!, "male", false);
    await checkIn(unpaid.event, p.filleul!);
    expect((await one<{ n: number }>("select count(*)::int as n from app.referrals where acquired_at is not null")).n).toBe(0);

    const paid = await bookedEvening(p.filleule!, "female", true);
    await checkIn(paid.event, p.filleule!);
    const [referral] = await as<{ acquired: boolean; rewarded: boolean }>(p.marraine!, "select * from app.my_referrals() where first_name = 'filleule'");
    expect(referral).toMatchObject({ acquired: true, rewarded: true });
    expect(await as<{ amount_xof: number }>(p.marraine!, "select * from app.my_credits()")).toEqual([expect.objectContaining({ amount_xof: 2000, used_at: null })]);
    const note = await one<{ n: number }>("select count(*)::int as n from app.notifications where user_id = $1 and kind = 'referral.acquired'", [p.marraine]);
    expect(note.n).toBe(1);
  });

  it("réduction appliquée à la prochaine soirée du parrain, utilisée au paiement, rendue au remboursement", async () => {
    const event = await createEvent(db, { startsInHours: 72 });
    await db.query("update app.events set price_xof = 10000 where id = $1", [event]);
    await register(db, event, p.marraine!, "female", "confirmed");
    const [quote] = await as<{ price_xof: number; credit_xof: number; amount_xof: number; credit_id: string }>(p.marraine!, "select * from app.evening_payment_quote($1)", [event]);
    expect(quote).toMatchObject({ price_xof: 10000, credit_xof: 2000, amount_xof: 8000 });
    // Comme l'API : paiement du montant réduit, lié à la réduction
    const pay = await one<{ id: string }>(
      "insert into app.payments (user_id, purpose, amount_xof, provider, credit_id, credit_xof) values ($1, 'evening_booking', 8000, 'simulated', $2, 2000) returning id",
      [p.marraine, quote!.credit_id],
    );
    await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [pay.id, event, p.marraine]);
    // Réservée par ce paiement en attente : pas proposée une seconde fois
    const other = await createEvent(db, { startsInHours: 96 });
    await db.query("update app.events set price_xof = 10000 where id = $1", [other]);
    await register(db, other, p.marraine!, "female", "confirmed");
    expect((await as<{ credit_xof: number }>(p.marraine!, "select * from app.evening_payment_quote($1)", [other]))[0]!.credit_xof).toBe(0);
    await db.query("update app.payments set status = 'succeeded' where id = $1", [pay.id]);
    expect((await as<{ used_at: string | null }>(p.marraine!, "select * from app.my_credits()"))[0]!.used_at).not.toBeNull();
    await db.query("update app.payments set status = 'refunded' where id = $1", [pay.id]);
    expect((await as<{ used_at: string | null }>(p.marraine!, "select * from app.my_credits()"))[0]!.used_at).toBeNull();
  });

  it("plafond de 5 parrainages récompensés par an ; réglages par l'administration", async () => {
    await as(p.admin!, "select app.admin_set_referral_settings(2000, 1)");
    // Second filleul acquis au-delà du plafond (réglé à 1) : acquis, non récompensé
    const paid = await bookedEvening(p.filleul!, "male", true);
    await checkIn(paid.event, p.filleul!);
    const [referral] = await as<{ acquired: boolean; rewarded: boolean }>(p.marraine!, "select * from app.my_referrals() where first_name = 'filleul'");
    expect(referral).toMatchObject({ acquired: true, rewarded: false });
    expect(await failure(as(p.filleul!, "select app.admin_set_referral_settings(2000, 5)"))).toMatch(/forbidden/);
    await as(p.admin!, "select app.admin_set_referral_settings(2000, 5)");
  });

  it("l'équipe voit le lien parrain / filleul dans la fiche du membre", async () => {
    const rows = await as<{ role: string; first_name: string }>(p.admin!, "select * from app.admin_member_referrals($1)", [p.filleul]);
    expect(rows).toEqual([expect.objectContaining({ role: "referrer", first_name: "marraine" })]);
    expect(await failure(as(p.filleul!, "select * from app.admin_member_referrals($1)", [p.marraine]))).toMatch(/forbidden/);
  });
});

describe("Badges de confiance (question 5)", () => {
  const refresh = () => asApi<{ n: number }>("select app.refresh_trust_badges() as n").then((r) => r[0]!.n);
  const badges = (viewer: string, user: string) => as<{ b: string[] }>(viewer, "select app.badges_of($1) as b", [user]).then((r) => r[0]!.b);

  it("attribués automatiquement selon les conditions, retirés quand elles ne le sont plus", async () => {
    await db.query("insert into app.verifications (user_id, status) values ($1, 'approved')", [p.marraine]);
    const second = await bookedEvening(p.marraine!, "female", true);
    await checkIn(second.event, p.marraine!);
    const third = await bookedEvening(p.marraine!, "female", true);
    await checkIn(third.event, p.marraine!);
    expect(await refresh()).toBeGreaterThan(0);
    expect(await badges(p.marraine!, p.marraine!)).toEqual(["evenings_attended", "identity_verified", "sponsor"]);
    expect(await failure(as(p.marraine!, "select app.earned_badges($1)", [p.marraine]))).toMatch(/permission denied/);
    expect(await failure(as(p.marraine!, "insert into app.trust_badges (user_id, badge) values ($1, 'profile_complete')", [p.marraine]))).toMatch(
      /permission denied|row-level security/,
    );
  });

  it("aucun badge pendant une suspension, rendus à la fin", async () => {
    await db.query("update app.member_profiles set status = 'suspended' where user_id = $1", [p.marraine]);
    await refresh();
    expect(await badges(p.marraine!, p.marraine!)).toEqual([]);
    await db.query("update app.member_profiles set status = 'verified' where user_id = $1", [p.marraine]);
    await refresh();
    expect(await badges(p.marraine!, p.marraine!)).toHaveLength(3);
  });

  it("visibles du membre, de ses matchs, de l'équipe ; de personne d'autre", async () => {
    expect(await badges(p.filleul!, p.marraine!)).toEqual([]);
    const event = await createEvent(db, { startsInHours: -24, status: "finished" });
    await db.query(
      "insert into app.matches (event_id, member_a, member_b, announced_at, notified_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), now(), 'pending_choice')",
      [event, p.marraine, p.filleul],
    );
    expect(await badges(p.filleul!, p.marraine!)).toHaveLength(3);
    expect(await badges(p.admin!, p.marraine!)).toHaveLength(3);
    expect(await badges(p.nouveau!, p.marraine!)).toEqual([]);
  });
});
