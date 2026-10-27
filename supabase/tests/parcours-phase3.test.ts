import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Étape 8 de la phase 3 (critère de fin) : parcours de bout en bout des règles 9.4 à 9.6 sur des
 * données fictives, dans l'ordre où un membre les vit. Afiwa a trois matchs après une soirée : elle
 * ouvre deux découvertes, continue avec Koffi, le couple invite une conseillère, fait une séance,
 * partage ses numéros, puis se sépare.
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

async function asSystem<T>(sql: string): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql)).rows;
  });
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const val = async <T>(user: string, sql: string, params: unknown[] = []) => (await as<{ v: T }>(user, sql, params))[0]!.v;
const notified = async (user: string, kind: string) =>
  (await db.query("select 1 from app.notifications where user_id = $1 and kind = $2", [user, kind])).rows.length;
const readable = async (user: string, chat: string) => (await as(user, "select id from app.messages where conversation_id = $1", [chat])).length;

const m: Record<string, string> = {};
const d: Record<string, string> = {};
const chat: Record<string, string> = {};
let couple: string;
let coupleChat: string;

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["dossou", "male", "member"],
    ["yao", "male", "member"],
    ["admin", "female", "admin"],
    ["conseillere", "female", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Mme Conseillère')", [p.conseillere]);
  event = await createEvent(db, { startsInHours: -14, status: "finished" });
  // Photos approuvées de Koffi (révélées au match)
  await db.query("insert into app.photos (user_id, storage_path, review_status) values ($1, 'k.jpg', 'approved')", [p.koffi]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Parcours complet de la phase 3 (règles 9.4 à 9.6)", () => {
  it("9.4 : trois matchs annoncés à 8 h ; deux places ; Afiwa choisit, les autres sont choisis d'office", async () => {
    for (const man of ["koffi", "dossou", "yao"]) {
      m[man] = (
        await one<{ id: string }>(
          "insert into app.matches (event_id, member_a, member_b, announced_at) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '1 minute') returning id",
          [event, p.afiwa, p[man]],
        )
      ).id;
    }
    await asSystem("select app.announce_matches()");
    expect(await notified(p.afiwa!, "match.announced")).toBe(3);
    // Trois matchs pour deux places : rien d'office pour Afiwa
    expect(await as(p.afiwa!, "select * from app.discoveries")).toEqual([]);
    for (const man of ["koffi", "dossou"]) await as(p.afiwa!, "select app.choose_match($1)", [m[man]]);
    expect(await failure(as(p.afiwa!, "select app.choose_match($1)", [m.yao]))).toMatch(/no_free_slot/);
    const rows = await as<{ discovery_id: string; partner_first_name: string; discovery_status: string }>(p.afiwa!, "select * from app.my_discoveries()");
    for (const r of rows.filter((x) => x.discovery_status === "active")) {
      const man = r.partner_first_name;
      d[man] = r.discovery_id;
      chat[man] = (await one<{ id: string }>("select id from app.conversations where discovery_id = $1", [r.discovery_id])).id;
    }
    expect(Object.keys(d).sort()).toEqual(["dossou", "koffi"]);
  });

  it("9.4 : conversation sans coordonnées, photos révélées, rendez-vous déclaré et « Bien rentré(e) ? »", async () => {
    expect(await failure(as(p.koffi!, "select app.send_message($1, 'Mon numéro : 97 00 00 00')", [chat.koffi]))).toMatch(/contact_blocked/);
    await as(p.koffi!, "select app.send_message($1, 'Bonjour Afiwa')", [chat.koffi]);
    await as(p.afiwa!, "select app.send_message($1, 'Bonjour Koffi')", [chat.koffi]);
    const photo = (await one<{ id: string }>("select id from app.photos where user_id = $1", [p.koffi])).id;
    expect(await val<boolean>(p.afiwa!, "select app.can_view_photo($1) as v", [photo])).toBe(true);
    expect(await as(p.afiwa!, "select * from app.first_date_venues()")).toEqual([]);
    const date = await val<string>(p.afiwa!, "select app.declare_discovery_date($1, now() - interval '3 hours 5 minutes') as v", [d.koffi]);
    await asSystem("select app.process_date_checkins()");
    expect(await notified(p.koffi!, "date.checkin")).toBe(1);
    await as(p.afiwa!, "select app.answer_checkin($1, 'ok')", [date]);
    expect(await as(p.afiwa!, "select * from app.my_pending_checkins()")).toEqual([]);
  });

  it("9.4 : prolongation seulement les 4 derniers jours, une fois, si les deux la demandent", async () => {
    expect(await failure(as(p.afiwa!, "select app.decide_discovery($1, false, true)", [d.koffi]))).toMatch(/extension_too_early/);
    await db.query("update app.discoveries set ends_at = now() + interval '2 days' where id = $1", [d.koffi]);
    await as(p.afiwa!, "select app.decide_discovery($1, false, true)", [d.koffi]);
    expect(await val<string>(p.koffi!, "select app.decide_discovery($1, false, true) as v", [d.koffi])).toBe("extended");
  });

  it("9.4 et 9.5 : « Je veux continuer » des deux : couple ; autres découvertes et matchs en attente terminés", async () => {
    await as(p.afiwa!, "select app.decide_discovery($1, true, false)", [d.koffi]);
    expect(await val<string>(p.koffi!, "select app.decide_discovery($1, true, false) as v", [d.koffi])).toBe("couple");
    couple = (await one<{ id: string }>("select id from app.couples where discovery_id = $1", [d.koffi])).id;
    coupleChat = (await one<{ id: string }>("select id from app.conversations where couple_id = $1 and kind = 'couple'", [couple])).id;
    // Découverte avec Dossou fermée, message neutre, conversation plus lisible (question 14)
    expect(await notified(p.dossou!, "discovery.closed")).toBe(1);
    expect(await readable(p.dossou!, chat.dossou!)).toBe(0);
    // Match en attente avec Yao expiré tout de suite (question 13)
    expect((await one<{ status: string }>("select status from app.matches where id = $1", [m.yao])).status).toBe("expired");
    expect(await notified(p.yao!, "match.expired")).toBe(1);
    // Conversation de découverte relisible depuis le couple
    expect(await readable(p.koffi!, chat.koffi!)).toBe(2);
    // Exclusivité : plus de soirées
    const soon = await createEvent(db, { startsInHours: 96 });
    expect(await failure(as(p.afiwa!, "select app.book_event($1)", [soon]))).toMatch(/couple_exclusivity/);
  });

  it("9.6 : conseillère invitée par l'un, acceptée par l'autre, attribuée par l'équipe ; historique si les deux l'acceptent", async () => {
    await as(p.afiwa!, "select app.send_message($1, 'Avant la conseillère')", [coupleChat]);
    const access = await val<string>(p.afiwa!, "select app.request_counselor_access($1, true) as v", [couple]);
    expect(await readable(p.conseillere!, coupleChat)).toBe(0);
    await as(p.koffi!, "select app.answer_counselor_access($1, true, true)", [access]);
    expect(await readable(p.conseillere!, coupleChat)).toBe(0); // pas encore attribuée
    await as(p.admin!, "select app.admin_assign_counselor($1, $2)", [access, p.conseillere]);
    expect(await readable(p.conseillere!, coupleChat)).toBeGreaterThan(0);
    const texts = (await as<{ body: string }>(p.conseillere!, "select body from app.messages where conversation_id = $1 and not is_system", [coupleChat])).map((r) => r.body);
    expect(texts).toContain("Avant la conseillère");
    await as(p.conseillere!, "select app.send_message($1, 'Bonjour à vous deux')", [coupleChat]);
  });

  it("9.5 et 9.6 : séance acceptée par les deux puis faite (étape franchie), étape confirmée à deux, numéros partagés", async () => {
    const session = await val<string>(p.conseillere!, "select app.propose_session($1, now() + interval '1 day', 'online', null) as v", [couple]);
    await as(p.afiwa!, "select app.accept_session($1)", [session]);
    expect(await val<string>(p.koffi!, "select app.accept_session($1) as v", [session])).toBe("confirmed");
    await db.query("update app.sessions set scheduled_at = now() - interval '1 hour' where id = $1", [session]);
    await as(p.conseillere!, "select app.complete_session($1)", [session]);
    await as(p.afiwa!, "select app.confirm_milestone($1, 'first_dates', 'reach')", [couple]);
    await as(p.koffi!, "select app.confirm_milestone($1, 'first_dates', 'reach')", [couple]);
    const reached = await as<{ kind: string; reached_at: Date | null }>(p.afiwa!, "select kind, reached_at from app.my_milestones($1)", [couple]);
    expect(reached.filter((r) => r.reached_at !== null).map((r) => r.kind).sort()).toEqual(["counselor_sessions", "first_dates"]);
    await as(p.afiwa!, "select app.share_my_phone($1)", [couple]);
    expect((await as<{ partner_phone: string | null }>(p.afiwa!, "select * from app.my_couple_phone($1)", [couple]))[0]!.partner_phone).toBeNull();
    await as(p.koffi!, "select app.share_my_phone($1)", [couple]);
    expect((await as<{ partner_phone: string | null }>(p.afiwa!, "select * from app.my_couple_phone($1)", [couple]))[0]!.partner_phone).toMatch(/^\+229/);
  });

  it("9.6 : canal privé de Koffi lu par la conseillère seule ; retrait par l'un : accès coupé tout de suite", async () => {
    const privateChat = await val<string>(p.koffi!, "select app.open_private_channel($1) as v", [couple]);
    await as(p.koffi!, "select app.send_message($1, 'Une question entre nous')", [privateChat]);
    expect(await readable(p.afiwa!, privateChat)).toBe(0);
    expect(await readable(p.conseillere!, privateChat)).toBe(1);
    const access = (await one<{ id: string }>("select id from app.counselor_access where couple_id = $1 and status = 'granted'", [couple])).id;
    await as(p.afiwa!, "select app.revoke_counselor_access($1)", [access]);
    expect(await readable(p.conseillere!, coupleChat)).toBe(0);
    expect(await readable(p.conseillere!, privateChat)).toBe(0);
    expect(await as(p.conseillere!, "select * from app.counselor_couples()")).toEqual([]);
    expect(await failure(as(p.conseillere!, "select app.send_message($1, 'Encore là')", [coupleChat]))).toMatch(/not_member/);
  });

  it("9.5 : séparation décidée par les deux : conversation fermée et illisible, photos masquées, un mois sans soirées", async () => {
    await as(p.afiwa!, "select app.couple_decide($1, 'separation')", [couple]);
    expect(await val<string>(p.koffi!, "select app.couple_decide($1, 'separation') as v", [couple])).toBe("done");
    expect(await readable(p.afiwa!, coupleChat)).toBe(0);
    const photo = (await one<{ id: string }>("select id from app.photos where user_id = $1", [p.koffi])).id;
    expect(await val<boolean>(p.afiwa!, "select app.can_view_photo($1) as v", [photo])).toBe(false);
    expect((await as<{ partner_phone: string | null }>(p.afiwa!, "select * from app.my_couple_phone($1)", [couple]))[0]!.partner_phone).toBeNull();
    const soon = await createEvent(db, { startsInHours: 120 });
    expect(await failure(as(p.koffi!, "select app.book_event($1)", [soon]))).toMatch(/blocked_until/);
    // Effacement 90 jours plus tard par la tâche planifiée
    await db.query("update app.conversations set delete_after = now() - interval '1 minute' where id = $1", [coupleChat]);
    await asSystem("select app.purge_conversations()");
    expect((await db.query("select 1 from app.messages where conversation_id = $1", [coupleChat])).rows).toEqual([]);
  });
});
