import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Règles validées le 27 octobre 2026 (questions 3, 13, 14, 15, 17, 18) : prolongation pendant les
 * 4 derniers jours, matchs en attente expirés quand un couple se forme, découverte terminée
 * illisible et effacée après 90 jours, photos après la fin, retrait du partage des numéros, notes
 * du conseiller effacées après 90 jours.
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

/** Match annoncé entre deux membres. */
const matchOf = async (a: string, b: string, status = "pending_choice") =>
  (
    await one<{ id: string }>(
      "insert into app.matches (event_id, member_a, member_b, announced_at, notified_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), now(), $4) returning id",
      [event, a, b, status],
    )
  ).id;

/** Découverte ouverte (avec sa conversation) se terminant dans `days` jours. */
async function discovery(a: string, b: string, days: number) {
  const m = await matchOf(a, b, "discovery_open");
  const d = await one<{ id: string }>(
    "insert into app.discoveries (match_id, opened_at, ends_at) values ($1, now() - interval '1 day', now() + make_interval(days => $2)) returning id",
    [m, days],
  );
  const chat = await one<{ id: string }>("insert into app.conversations (kind, discovery_id) values ('discovery', $1) returning id", [d.id]);
  return { match: m, id: d.id, chat: chat.id };
}

async function couple(a: string, b: string) {
  const d = await discovery(a, b, 5);
  await db.query("update app.discoveries set status = 'continued', closed_at = now() where id = $1", [d.id]);
  const c = await one<{ id: string }>(
    "insert into app.couples (discovery_id, member_a, member_b) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid)) returning id",
    [d.id, a, b],
  );
  const chat = await one<{ id: string }>("insert into app.conversations (kind, couple_id) values ('couple', $1) returning id", [c.id]);
  return { id: c.id, chat: chat.id, discovery: d };
}

const decide = (user: string, d: string, cont: boolean, ext: boolean) =>
  failure(as(user, "select app.decide_discovery($1, $2, $3)", [d, cont, ext]));
const notified = async (user: string, kind: string) =>
  (await db.query("select 1 from app.notifications where user_id = $1 and kind = $2", [user, kind])).rows.length;

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["ablavi", "female", "member"],
    ["yao", "male", "member"],
    ["mariam", "female", "member"],
    ["kodjo", "male", "member"],
    ["admin", "female", "admin"],
    ["conseillere", "female", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Mme Conseillère')", [p.conseillere]);
  event = await createEvent(db, { startsInHours: -48, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Question 3 : prolongation pendant les 4 derniers jours", () => {
  it("refusée avant, acceptée pendant ; « continuer » reste possible à tout moment", async () => {
    const early = await discovery(p.afiwa!, p.koffi!, 10);
    expect(await decide(p.afiwa!, early.id, false, true)).toMatch(/extension_too_early/);
    expect(await decide(p.afiwa!, early.id, true, false)).toBeNull();
    const late = await discovery(p.sena!, p.dossou!, 3);
    expect(await decide(p.sena!, late.id, false, true)).toBeNull();
    // Garder sa demande en changeant « continuer » ne la refait pas : pas d'erreur
    expect(await decide(p.sena!, late.id, true, true)).toBeNull();
    expect(await decide(p.dossou!, late.id, false, true)).toBeNull();
    expect((await one<{ extended: boolean }>("select extended from app.discoveries where id = $1", [late.id])).extended).toBe(true);
  });
});

describe("Question 13 : matchs en attente expirés quand un couple se forme", () => {
  it("les deux personnes de chaque match reçoivent le message neutre", async () => {
    const pending = await matchOf(p.ablavi!, p.kodjo!);
    const other = await matchOf(p.mariam!, p.yao!);
    const d = await discovery(p.ablavi!, p.yao!, 3);
    await as(p.ablavi!, "select app.decide_discovery($1, true, false)", [d.id]);
    await as(p.yao!, "select app.decide_discovery($1, true, false)", [d.id]);
    const status = async (id: string) => (await one<{ status: string }>("select status from app.matches where id = $1", [id])).status;
    expect(await status(pending)).toBe("expired");
    expect(await status(other)).toBe("expired");
    expect(await notified(p.kodjo!, "match.expired")).toBe(1);
    expect(await notified(p.mariam!, "match.expired")).toBe(1);
  });
});

describe("Question 14 : découverte terminée", () => {
  it("conversation illisible, gardée 90 jours puis effacée ; celle devenue couple reste lisible", async () => {
    const d = await discovery(p.mariam!, p.dossou!, 3);
    await as(p.mariam!, "select app.send_message($1, 'Bonjour')", [d.chat]);
    await asSystem(`select app.close_discovery('${d.id}', 'expired')`);
    expect(await as(p.mariam!, "select id from app.messages where conversation_id = $1", [d.chat])).toEqual([]);
    const { delete_after } = await one<{ delete_after: Date }>("select delete_after from app.conversations where id = $1", [d.chat]);
    expect(Math.round((delete_after.getTime() - Date.now()) / 86_400_000)).toBe(90);
    // Découverte devenue couple : relisible
    const c = await couple(p.afiwa!, p.dossou!);
    await db.query("insert into app.messages (conversation_id, sender_id, body) values ($1, $2, 'Avant le couple')", [c.discovery.chat, p.afiwa]);
    expect(await as(p.dossou!, "select id from app.messages where conversation_id = $1", [c.discovery.chat])).toHaveLength(1);
  });
});

describe("Question 15 : photos après la fin", () => {
  it("visibles en couple et après l'union ; plus après une séparation, même par le match d'origine", async () => {
    const c = await couple(p.sena!, p.kodjo!);
    const photo = await one<{ id: string }>(
      "insert into app.photos (user_id, storage_path, review_status) values ($1, 'x.jpg', 'approved') returning id",
      [p.kodjo],
    );
    const sees = async () => (await as<{ v: boolean }>(p.sena!, "select app.can_view_photo($1) as v", [photo.id]))[0]!.v;
    expect(await sees()).toBe(true);
    await db.query("update app.couples set status = 'union_celebrated' where id = $1", [c.id]);
    expect(await sees()).toBe(true);
    await db.query("update app.couples set status = 'separated' where id = $1", [c.id]);
    expect(await sees()).toBe(false);
  });
});

describe("Question 17 : partage des numéros", () => {
  it("retrait possible ; numéros affichés après l'union", async () => {
    const c = await couple(p.ablavi!, p.koffi!);
    await as(p.ablavi!, "select app.share_my_phone($1)", [c.id]);
    await as(p.koffi!, "select app.share_my_phone($1)", [c.id]);
    const phone = async () => (await as<{ partner_phone: string | null }>(p.ablavi!, "select * from app.my_couple_phone($1)", [c.id]))[0]!.partner_phone;
    expect(await phone()).not.toBeNull();
    await db.query("update app.couples set status = 'union_celebrated' where id = $1", [c.id]);
    expect(await phone()).not.toBeNull();
    await as(p.koffi!, "select app.unshare_my_phone($1)", [c.id]);
    expect(await phone()).toBeNull();
    expect(await failure(as(p.sena!, "select app.unshare_my_phone($1)", [c.id]))).toMatch(/not_member/);
  });
});

describe("Question 18 : notes du conseiller", () => {
  it("effacées 90 jours après le retrait ; lisibles par l'administration, lecture journalisée", async () => {
    const c = await couple(p.mariam!, p.kodjo!);
    await db.query(
      "insert into app.counselor_access (couple_id, counselor_id, requested_by, status, accepted_at, granted_at, price_xof) values ($1, $2, $3, 'granted', now(), now(), 0)",
      [c.id, p.conseillere, p.mariam],
    );
    await as(p.conseillere!, "select app.add_counselor_note($1, 'Échange serein')", [c.id]);
    const notes = await as<{ body: string }>(p.admin!, "select * from app.admin_counselor_notes($1)", [c.id]);
    expect(notes.map((n) => n.body)).toEqual(["Échange serein"]);
    expect((await db.query("select 1 from app.audit_log where action = 'counselor_notes.read'")).rows.length).toBe(1);
    expect(await failure(as(p.mariam!, "select * from app.admin_counselor_notes($1)", [c.id]))).toMatch(/forbidden/);
    const count = async () => (await one<{ n: number }>("select count(*)::int as n from app.counselor_notes where couple_id = $1", [c.id])).n;
    // Retrait récent : notes gardées
    await db.query("update app.counselor_access set status = 'revoked', revoked_at = now() - interval '10 days' where couple_id = $1", [c.id]);
    await asSystem("select app.purge_conversations()");
    expect(await count()).toBe(1);
    // 90 jours après le retrait : effacées
    await db.query("update app.counselor_access set revoked_at = now() - interval '91 days' where couple_id = $1", [c.id]);
    await asSystem("select app.purge_conversations()");
    expect(await count()).toBe(0);
  });
});
