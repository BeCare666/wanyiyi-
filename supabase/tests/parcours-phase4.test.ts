import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Étape 8 de la phase 4 (critère de fin) : parcours complet jusqu'à l'espace souvenir, sur des
 * données fictives, dans l'ordre où les membres le vivent. Koffi s'inscrit avec le code de sa
 * marraine Sèna ; sa première soirée payée et pointée lui vaut un parrainage acquis. Il y
 * rencontre Afiwa : découverte, couple, « Dot ou mariage » franchie à deux, cagnotte proposée et
 * acceptée, contribution d'une tante sans compte, prestataires visibles, union déclarée par les
 * deux, espace souvenir (photo de l'union), reversement fait par l'équipe, suivi post-union,
 * badges de confiance.
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
const val = async <T>(user: string, sql: string, params: unknown[] = []) => (await as<{ v: T }>(user, sql, params))[0]!.v;
const notified = async (user: string, kind: string) =>
  (await db.query("select 1 from app.notifications where user_id = $1 and kind = $2", [user, kind])).rows.length;

let event: string;
let couple: string;
let cagnotte: string;
let token: string;

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, status, role] of [
    ["sena", "female", "verified", "member"],
    ["afiwa", "female", "verified", "member"],
    ["koffi", "male", "pending_verification", "member"],
    ["admin", "female", "verified", "admin"],
    ["moderatrice", "female", "verified", "moderator"],
    ["conseillere", "female", "verified", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, status, role });
  }
  await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Mme Conseillère')", [p.conseillere]);
  await db.exec((await import("node:fs")).readFileSync(new URL("../demo/prestataires-demo.sql", import.meta.url), "utf8"));
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Parcours complet de la phase 4, jusqu'à l'espace souvenir", () => {
  it("parrainage : Koffi s'inscrit avec le code de Sèna ; acquis à sa première soirée payée et pointée", async () => {
    const code = await val<string>(p.sena!, "select app.my_referral_code() as v");
    await as(p.koffi!, "select app.set_referrer($1)", [code]);
    event = await createEvent(db, { startsInHours: -3, status: "in_progress" });
    for (const [name, sex] of [["afiwa", "female"], ["koffi", "male"]] as const) {
      await register(db, event, p[name]!, sex, "confirmed");
      const pay = await one<{ id: string }>(
        "insert into app.payments (user_id, purpose, amount_xof, provider, status) values ($1, 'evening_booking', 10000, 'simulated', 'succeeded') returning id",
        [p[name]],
      );
      await db.query("update app.event_registrations set payment_id = $1, status = 'checked_in', checked_in_at = now() where event_id = $2 and user_id = $3", [
        pay.id,
        event,
        p[name],
      ]);
    }
    expect(await notified(p.sena!, "referral.acquired")).toBe(1);
    expect(await as<{ amount_xof: number }>(p.sena!, "select * from app.my_credits()")).toEqual([expect.objectContaining({ amount_xof: 2000 })]);
  });

  it("match, découverte puis couple (phase 3) ; « Dot ou mariage » franchie à deux", async () => {
    await db.query("update app.events set status = 'finished' where id = $1", [event]);
    const match = await one<{ id: string }>(
      "insert into app.matches (event_id, member_a, member_b, announced_at) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '1 minute') returning id",
      [event, p.afiwa, p.koffi],
    );
    await asApi("select app.announce_matches()");
    // Un seul match chacun : la découverte s'ouvre d'office (phase 3, 9.4)
    if (!(await db.query("select 1 from app.discoveries where match_id = $1", [match.id])).rows.length) {
      await as(p.afiwa!, "select app.choose_match($1)", [match.id]);
    }
    const discovery = (await one<{ id: string }>("select id from app.discoveries where match_id = $1", [match.id])).id;
    await as(p.afiwa!, "select app.decide_discovery($1, true, false)", [discovery]);
    expect(await val<string>(p.koffi!, "select app.decide_discovery($1, true, false) as v", [discovery])).toBe("couple");
    couple = (await one<{ id: string }>("select id from app.couples where discovery_id = $1", [discovery])).id;
    expect(await failure(as(p.afiwa!, "select app.propose_cagnotte($1, 'Notre dot', null, current_date + 30, '+2290197000001')", [couple]))).toMatch(/too_early/);
    for (const kind of ["first_dates", "family_introduction", "dowry_or_wedding"]) {
      await as(p.afiwa!, "select app.confirm_milestone($1, $2::app.milestone_kind, 'reach')", [couple, kind]);
      await as(p.koffi!, "select app.confirm_milestone($1, $2::app.milestone_kind, 'reach')", [couple, kind]);
    }
  });

  it("cagnotte proposée par Afiwa, acceptée par Koffi ; une tante contribue sans compte", async () => {
    cagnotte = await val<string>(p.afiwa!, "select app.propose_cagnotte($1, 'Notre dot', 300000, current_date + 30, '+229 01 97 00 00 01') as v", [couple]);
    expect(await val<string>(p.koffi!, "select app.answer_cagnotte($1, true) as v", [cagnotte])).toBe("open");
    token = (await as<{ public_token: string }>(p.afiwa!, "select * from app.my_cagnotte($1)", [couple]))[0]!.public_token;
    const [page] = await asAnon(db, async (tx) => (await tx.query<{ title: string; accepting: boolean }>("select * from app.public_cagnotte($1)", [token])).rows);
    expect(page).toMatchObject({ title: "Notre dot", accepting: true });
    const payment = (await asApi<{ id: string }>("select app.create_contribution($1, 'Tante Rose', false, 'Tous nos vœux', 50000, false, 'simulated') as id", [token]))[0]!.id;
    await db.query("update app.payments set status = 'succeeded' where id = $1", [payment]);
    expect(await notified(p.koffi!, "cagnotte.contribution")).toBe(1);
  });

  it("prestataires : coordonnées visibles pour le couple, « J'ai contacté » compté", async () => {
    const providers = await as<{ id: string; phone: string | null; whatsapp: string | null }>(p.afiwa!, "select * from app.member_providers(true)");
    expect(providers).toHaveLength(8);
    expect(providers.every((r) => r.phone !== null || r.whatsapp !== null)).toBe(true);
    await as(p.afiwa!, "select app.mark_provider_contacted($1)", [providers[0]!.id]);
  });

  it("union déclarée par les deux : espace souvenir, conversation en lecture seule, cagnotte toujours ouverte", async () => {
    await as(p.afiwa!, "select app.couple_decide($1, 'union')", [couple]);
    await as(p.koffi!, "select app.couple_decide($1, 'union')", [couple]);
    const c = await one<{ status: string; memory_space: boolean }>("select status, memory_space from app.couples where id = $1", [couple]);
    expect(c).toEqual({ status: "union_celebrated", memory_space: true });
    expect((await as<{ status: string }>(p.koffi!, "select * from app.my_cagnotte($1)", [couple]))[0]!.status).toBe("open");
  });

  it("espace souvenir : photo de l'union déposée par Afiwa, relue, vue par Koffi seulement", async () => {
    const path = `${p.afiwa}/union-jour-j.jpg`;
    await as(p.afiwa!, "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [path]);
    const photo = await val<string>(p.afiwa!, "select app.add_union_photo($1, $2) as v", [couple, path]);
    await as(p.moderatrice!, "select app.review_union_photo($1, true)", [photo]);
    expect(await val<boolean>(p.koffi!, "select app.can_view_union_photo($1) as v", [photo])).toBe(true);
    expect(await val<boolean>(p.sena!, "select app.can_view_union_photo($1) as v", [photo])).toBe(false);
  });

  it("reversement demandé par les deux et fait par l'équipe ; suivi post-union par la conseillère", async () => {
    await as(p.afiwa!, "select app.cagnotte_decide($1, 'payout')", [cagnotte]);
    await as(p.koffi!, "select app.cagnotte_decide($1, 'payout')", [cagnotte]);
    const payout = (await one<{ id: string }>("select id from app.cagnotte_payouts where cagnotte_id = $1", [cagnotte])).id;
    await as(p.admin!, "select app.admin_mark_payout_paid($1, 49000, 'MP-REF-1')", [payout]);
    expect(await notified(p.afiwa!, "cagnotte.paid_out")).toBe(1);

    const access = await val<string>(p.koffi!, "select app.request_counselor_access($1, false) as v", [couple]);
    await as(p.afiwa!, "select app.answer_counselor_access($1, true, false)", [access]);
    await as(p.admin!, "select app.admin_assign_counselor($1, $2)", [access, p.conseillere]);
    const session = await val<string>(p.conseillere!, "select app.propose_session($1, now() + interval '7 days', 'online', null) as v", [couple]);
    await as(p.afiwa!, "select app.accept_session($1)", [session]);
    expect(await val<string>(p.koffi!, "select app.accept_session($1) as v", [session])).toBe("confirmed");
  });

  it("badges de confiance de la tâche quotidienne, visibles du conjoint et de la conseillère", async () => {
    await db.query("insert into app.verifications (user_id, status) values ($1, 'approved')", [p.afiwa]);
    await asApi("select app.refresh_trust_badges()");
    expect(await val<string[]>(p.koffi!, "select app.badges_of($1) as v", [p.afiwa])).toEqual(["identity_verified"]);
    expect(await val<string[]>(p.conseillere!, "select app.badges_of($1) as v", [p.afiwa])).toEqual(["identity_verified"]);
    expect(await val<string[]>(p.sena!, "select app.badges_of($1) as v", [p.sena])).toEqual(["sponsor"]);
    const [indicators] = await as<{ open_cagnottes: number; pending_payouts: number; referrals_this_month: number; provider_contacts_this_month: number }>(
      p.admin!,
      "select * from app.admin_phase4_indicators()",
    );
    expect(indicators).toMatchObject({ open_cagnottes: 1, pending_payouts: 0, referrals_this_month: 1, provider_contacts_this_month: 1 });
  });
});
