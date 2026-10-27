import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * « Bien rentré(e) ? » (question 5, validée le 27 octobre 2026) : envoi 3 heures après le
 * rendez-vous aux deux, rappel à 12 heures, alerte à l'équipe sans réponse à 24 heures ou
 * immédiatement si le membre demande de l'aide ; l'autre ne voit jamais la réponse.
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
const notified = async (user: string, kind: string) =>
  (await db.query("select 1 from app.notifications where user_id = $1 and kind = $2", [user, kind])).rows.length;
const process = () => asSystem("select app.process_date_checkins()");

async function discovery(a: string, b: string) {
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, notified_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  return (await one<{ id: string }>("insert into app.discoveries (match_id, opened_at, ends_at) values ($1, now(), now() + interval '14 days') returning id", [m.id])).id;
}

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["admin", "female", "admin"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  event = await createEvent(db, { startsInHours: -48, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("« Bien rentré(e) ? » (question 5)", () => {
  it("rendez-vous déclaré pendant la découverte ; message aux deux 3 heures après", async () => {
    const d = await discovery(p.afiwa!, p.koffi!);
    const when = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const [{ id }] = await as<{ id: string }>(p.afiwa!, "select app.declare_discovery_date($1, $2) as id", [d, when]);
    expect(await as(p.koffi!, "select * from app.my_discovery_dates($1)", [d])).toHaveLength(1);
    expect(await failure(as(p.sena!, "select app.declare_discovery_date($1, $2)", [d, when]))).toMatch(/not_member/);
    await process();
    expect(await notified(p.afiwa!, "date.checkin")).toBe(0); // seulement 2 heures
    await db.query("update app.date_checkins set date_at = now() - interval '3 hours 1 minute' where id = $1", [id]);
    await process();
    expect(await notified(p.afiwa!, "date.checkin")).toBe(1);
    expect(await notified(p.koffi!, "date.checkin")).toBe(1);
    await process();
    expect(await notified(p.afiwa!, "date.checkin")).toBe(1); // une seule fois

    // « Oui » de l'une : l'autre ne voit pas la réponse
    await as(p.afiwa!, "select app.answer_checkin($1, 'ok')", [id]);
    expect(await as(p.afiwa!, "select * from app.my_pending_checkins()")).toEqual([]);
    const pending = await as<{ partner_first_name: string }>(p.koffi!, "select * from app.my_pending_checkins()");
    expect(pending[0]!.partner_first_name).toBe("afiwa");
    expect(await as(p.koffi!, "select * from app.date_checkin_answers where user_id = $1", [p.afiwa])).toEqual([]);

    // Sans réponse : rappel à 12 heures, alerte à 24 heures après le rendez-vous
    await db.query("update app.date_checkin_answers set sent_at = now() - interval '13 hours' where checkin_id = $1", [id]);
    await process();
    expect(await notified(p.koffi!, "date.checkin_reminder")).toBe(1);
    expect(await notified(p.afiwa!, "date.checkin_reminder")).toBe(0);
    expect(await notified(p.admin!, "date.checkin_no_answer")).toBe(0);
    await db.query("update app.date_checkins set date_at = now() - interval '25 hours' where id = $1", [id]);
    await process();
    expect(await notified(p.admin!, "date.checkin_no_answer")).toBe(1);
    await process();
    expect(await notified(p.admin!, "date.checkin_no_answer")).toBe(1);
  });

  it("« J'ai besoin d'aide » : alerte immédiate avec prénom, numéro de membre et téléphone ; traitement par l'équipe", async () => {
    const d = await discovery(p.sena!, p.dossou!);
    const [{ id }] = await as<{ id: string }>(p.sena!, "select app.declare_discovery_date($1, now() - interval '4 hours') as id", [d]);
    await process();
    await as(p.sena!, "select app.answer_checkin($1, 'help')", [id]);
    const { rows } = await db.query<{ payload: { first_name: string; phone: string; member_number: string } }>(
      "select payload from app.notifications where user_id = $1 and kind = 'date.help_requested'",
      [p.admin],
    );
    expect(rows[0]!.payload.first_name).toBe("sena");
    expect(rows[0]!.payload.phone).toMatch(/^\+229/);
    const alerts = await as<{ answer: string; handled_at: Date | null }>(p.admin!, "select * from app.admin_safety_alerts()");
    expect(alerts.some((a) => a.answer === "help" && a.handled_at === null)).toBe(true);
    expect(await failure(as(p.sena!, "select * from app.admin_safety_alerts()"))).toMatch(/forbidden/);
    expect(await failure(as(p.admin!, "select app.admin_handle_safety_alert($1, $2)", [id, p.sena]))).toBeNull();
    expect(await failure(as(p.admin!, "select app.admin_handle_safety_alert($1, $2)", [id, p.sena]))).toMatch(/not_found/);
    expect(await failure(as(p.sena!, "select app.answer_checkin($1, 'maybe')", [id]))).toMatch(/invalid_answer/);
    expect(await failure(as(p.afiwa!, "select app.answer_checkin($1, 'ok')", [id]))).toMatch(/not_found/);
  });

  it("rendez-vous déclaré plus de 24 heures après : aucun message ; tâche réservée au système", async () => {
    const d = await discovery(p.afiwa!, p.dossou!);
    await as(p.afiwa!, "select app.declare_discovery_date($1, now() - interval '2 days')", [d]);
    const before = await notified(p.dossou!, "date.checkin");
    await process();
    expect(await notified(p.dossou!, "date.checkin")).toBe(before);
    expect(await failure(as(p.afiwa!, "select app.process_date_checkins()"))).toMatch(/forbidden|permission denied/);
  });
});
