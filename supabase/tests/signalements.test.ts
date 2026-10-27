import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Signalements (question 11, validée le 27 octobre 2026) : motifs, file de l'administration,
 * messages signalés seuls lisibles et consultation journalisée, personne signalée jamais prévenue
 * du signalement, décision notifiée avec un motif neutre, « menace » : lecture seule immédiate.
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

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const notified = async (user: string, kind: string) =>
  (await db.query("select 1 from app.notifications where user_id = $1 and kind = $2", [user, kind])).rows.length;

/** Découverte ouverte avec sa conversation. */
async function discovery(a: string, b: string) {
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, notified_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, opened_at, ends_at) values ($1, now(), now() + interval '14 days') returning id", [m.id]);
  return (await one<{ id: string }>("insert into app.conversations (kind, discovery_id) values ('discovery', $1) returning id", [d.id])).id;
}

const send = async (user: string, chat: string, body: string) =>
  (await as<{ id: string }>(user, "select app.send_message($1, $2) as id", [chat, body]))[0]!.id;
const report = (user: string, chat: string, message: string | null, reason: string, details: string | null = null) =>
  as<{ id: string }>(user, "select app.report_conversation($1, $2, $3, $4) as id", [chat, message, reason, details]).then((r) => r[0]!.id);

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["admin", "female", "admin"],
    ["moderatrice", "female", "moderator"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  event = await createEvent(db, { startsInHours: -48, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Signaler (question 11 a, c, d)", () => {
  it("un message : la personne signalée n'est pas prévenue ; l'équipe l'est", async () => {
    const chat = await discovery(p.afiwa!, p.koffi!);
    const mine = await send(p.afiwa!, chat, "Bonjour");
    const his = await send(p.koffi!, chat, "Envoie-moi de l'argent");
    expect(await failure(as(p.afiwa!, "select app.report_conversation($1, $2, 'money', null)", [chat, mine]))).toMatch(/invalid_message/);
    const id = await report(p.afiwa!, chat, his, "money");
    expect((await one<{ reported_user_id: string }>("select reported_user_id from app.reports where id = $1", [id])).reported_user_id).toBe(p.koffi);
    expect(await notified(p.admin!, "report.received")).toBe(1);
    expect((await db.query("select 1 from app.notifications where user_id = $1", [p.koffi])).rows).toEqual([]);
    expect(await as(p.koffi!, "select * from app.reports")).toEqual([]);
    expect(await as(p.afiwa!, "select id from app.reports")).toHaveLength(1);
    // Conversation toujours ouverte (pas de fermeture automatique)
    expect((await one<{ read_only: boolean }>("select read_only from app.conversations where id = $1", [chat])).read_only).toBe(false);
  });

  it("motif « autre » : texte obligatoire ; personne hors de la conversation : refus", async () => {
    const chat = await discovery(p.sena!, p.dossou!);
    expect(await failure(as(p.sena!, "select app.report_conversation($1, null, 'other', '  ')", [chat]))).toMatch(/details_required/);
    expect(await failure(as(p.sena!, "select app.report_conversation($1, null, 'inconnu', null)", [chat]))).toMatch(/invalid_reason/);
    expect(await failure(as(p.afiwa!, "select app.report_conversation($1, null, 'disrespect', null)", [chat]))).toMatch(/not_member/);
  });

  it("« menace ou danger » sur une conversation : lecture seule tout de suite ; seuls les messages de l'autre sont joints", async () => {
    const chat = await discovery(p.afiwa!, p.dossou!);
    await send(p.afiwa!, chat, "Je préfère arrêter");
    await send(p.dossou!, chat, "Tu vas le regretter");
    const id = await report(p.afiwa!, chat, null, "threat");
    expect((await one<{ read_only: boolean }>("select read_only from app.conversations where id = $1", [chat])).read_only).toBe(true);
    const msgs = await as<{ body: string }>(p.moderatrice!, "select * from app.admin_reported_messages($1)", [id]);
    expect(msgs.map((m) => m.body)).toEqual(["Tu vas le regretter"]);
  });
});

describe("File de l'administration (question 11 b, c)", () => {
  it("lecture par la modération journalisée ; décision par l'administration, motif neutre notifié", async () => {
    const open = await as<{ id: string; reason: string; reported_first_name: string; status: string }>(p.moderatrice!, "select * from app.admin_reports()");
    expect(open.length).toBe(2);
    const money = open.find((r) => r.reason === "money")!;
    expect(money.reported_first_name).toBe("koffi");
    expect(await failure(as(p.afiwa!, "select * from app.admin_reports()"))).toMatch(/forbidden/);
    await as(p.moderatrice!, "select * from app.admin_reported_messages($1)", [money.id]);
    expect((await db.query("select 1 from app.audit_log where action = 'reported_message.viewed' and actor_id = $1", [p.moderatrice])).rows.length).toBe(2);
    expect((await one<{ status: string }>("select status from app.reports where id = $1", [money.id])).status).toBe("in_review");
    // La modération ne décide pas
    expect(await failure(as(p.moderatrice!, "select app.admin_resolve_report($1, 'warning', 'Rappel du règlement')", [money.id]))).toMatch(/forbidden/);
    expect(await failure(as(p.admin!, "select app.admin_resolve_report($1, 'suspension', ' ')", [money.id]))).toMatch(/reason_required/);
    await as(p.admin!, "select app.admin_resolve_report($1, 'suspension', 'Manquement au règlement de la communauté.')", [money.id]);
    expect((await one<{ status: string }>("select status from app.member_profiles where user_id = $1", [p.koffi])).status).toBe("suspended");
    const { rows } = await db.query<{ payload: { reason: string } }>("select payload from app.notifications where user_id = $1 and kind = 'member.suspended'", [p.koffi]);
    expect(rows[0]!.payload.reason).toBe("Manquement au règlement de la communauté.");
    expect((await one<{ report_id: string }>("select report_id from app.sanctions where user_id = $1 and kind = 'suspension'", [p.koffi])).report_id).toBe(money.id);
    expect(await failure(as(p.admin!, "select app.admin_resolve_report($1, 'dismissed', null)", [money.id]))).toMatch(/already_resolved/);
    expect(await as(p.admin!, "select * from app.admin_reports()")).toHaveLength(1);
  });

  it("avertissement : notifié avec son motif ; classement sans suite : rien n'est envoyé", async () => {
    const [threat] = await as<{ id: string }>(p.admin!, "select * from app.admin_reports()");
    await as(p.admin!, "select app.admin_resolve_report($1, 'warning', 'Merci de rester courtois.')", [threat!.id]);
    expect(await notified(p.dossou!, "member.warned")).toBe(1);
    const chat = await discovery(p.sena!, p.koffi!);
    const id = await report(p.sena!, chat, null, "fake_profile");
    await as(p.admin!, "select app.admin_resolve_report($1, 'dismissed', null)", [id]);
    expect((await one<{ status: string }>("select status from app.reports where id = $1", [id])).status).toBe("dismissed");
  });
});
