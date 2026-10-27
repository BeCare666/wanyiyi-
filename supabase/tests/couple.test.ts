import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Vie et fins du couple (9.5 ; questions 6 et 7, réponses du 26 octobre 2026) : activité,
 * alerte à 60 jours, pause 14 jours plus tard, reprise par les deux, union, séparation,
 * départ d'un seul, effacement des conversations.
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

/** Couple et sa conversation (comme les crée app.decide_discovery). */
async function couple(a: string, b: string, counselor: string | null = null) {
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now(), 'continued') returning id", [m.id]);
  const c = await one<{ id: string }>(
    "insert into app.couples (discovery_id, member_a, member_b, counselor_id) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), $4) returning id",
    [d.id, a, b, counselor],
  );
  const conv = await one<{ id: string }>("insert into app.conversations (kind, couple_id) values ('couple', $1) returning id", [c.id]);
  if (counselor) {
    await db.query(
      "insert into app.counselor_access (couple_id, counselor_id, requested_by, status, accepted_at, granted_at, price_xof) values ($1, $2, $3, 'granted', now(), now(), 0)",
      [c.id, counselor, a],
    );
  }
  return { id: c.id, chat: conv.id };
}

const decide = (user: string, id: string, kind: string) => as<{ r: string }>(user, "select app.couple_decide($1, $2) as r", [id, kind]).then((r) => r[0]!.r);
const send = (user: string, chat: string, body: string) => failure(as(user, "select app.send_message($1, $2)", [chat, body]));
const status = async (id: string) => (await one<{ status: string }>("select status from app.couples where id = $1", [id])).status;
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

describe("Vie du couple (9.5, question 6)", () => {
  let c: { id: string; chat: string };

  it("activité : message, étape, rendez-vous, ouverture de l'espace", async () => {
    c = await couple(p.afiwa!, p.koffi!);
    const reset = () => db.query("update app.couples set last_activity_at = now() - interval '30 days', inactivity_alerted_at = now() where id = $1", [c.id]);
    const fresh = async () => {
      const r = await one<{ last: Date; alert: Date | null }>("select last_activity_at as last, inactivity_alerted_at as alert from app.couples where id = $1", [c.id]);
      return Date.now() - r.last.getTime() < 60_000 && r.alert === null;
    };
    await reset();
    expect(await send(p.afiwa!, c.chat, "Bonjour")).toBeNull();
    expect(await fresh()).toBe(true);
    await reset();
    await db.query("insert into app.couple_milestones (couple_id, kind, reached_at) values ($1, 'first_dates', now())", [c.id]);
    expect(await fresh()).toBe(true);
    await reset();
    await db.query("insert into app.date_checkins (couple_id, declared_by, date_at) values ($1, $2, now())", [c.id, p.afiwa]);
    expect(await fresh()).toBe(true);
    await reset();
    await as(p.koffi!, "select app.touch_couple($1)", [c.id]);
    expect(await fresh()).toBe(true);
    expect(await failure(as(p.sena!, "select app.touch_couple($1)", [c.id]))).toMatch(/not_member/);
  });

  it("60 jours : alerte au conseiller, ou à l'administration sans conseiller ; 14 jours plus tard : pause", async () => {
    const withCounselor = await couple(p.sena!, p.dossou!, p.conseillere!);
    await db.query("update app.couples set last_activity_at = now() - interval '61 days' where id in ($1, $2)", [c.id, withCounselor.id]);
    await asSystem("select app.couple_inactivity()");
    expect(await notified(p.conseillere!, "couple.inactive")).toBe(1);
    expect(await notified(p.admin!, "couple.inactive")).toBe(1);
    expect(await status(c.id)).toBe("active");
    // 14 jours après l'alerte, sans activité : pause
    await db.query("update app.couples set inactivity_alerted_at = now() - interval '15 days', last_activity_at = now() - interval '75 days' where id = $1", [c.id]);
    await asSystem("select app.couple_inactivity()");
    expect(await status(c.id)).toBe("paused");
    expect(await send(p.afiwa!, c.chat, "Allô")).toMatch(/conversation_closed/);
    expect(await notified(p.afiwa!, "couple.paused")).toBe(1);
    expect(await failure(as(p.afiwa!, "select app.couple_inactivity()"))).toMatch(/forbidden/);
  });

  it("pause : exclusivité levée ; reprise seulement quand les deux cliquent", async () => {
    const soon = await createEvent(db, { startsInHours: 120 });
    expect(await failure(as(p.afiwa!, "select app.book_event($1)", [soon]))).toBeNull();
    expect(await decide(p.afiwa!, c.id, "resume")).toBe("recorded");
    expect(await status(c.id)).toBe("paused");
    expect(await decide(p.koffi!, c.id, "resume")).toBe("done");
    expect(await status(c.id)).toBe("active");
    expect(await send(p.afiwa!, c.chat, "Nous revoilà")).toBeNull();
    const later = await createEvent(db, { startsInHours: 200 });
    expect(await failure(as(p.koffi!, "select app.book_event($1)", [later]))).toMatch(/couple_exclusivity/);
    expect(await failure(as(p.afiwa!, "select app.couple_decide($1, 'resume')", [c.id]))).toMatch(/invalid_status/);
  });
});

describe("Fins du couple (9.5, question 7)", () => {
  it("union déclarée par les deux : chat en lecture seule, effacé après 12 mois sauf si les deux le gardent", async () => {
    const c = await couple(p.ablavi!, p.yao!);
    expect(await decide(p.ablavi!, c.id, "union")).toBe("recorded");
    expect(await status(c.id)).toBe("active");
    expect(await decide(p.yao!, c.id, "union")).toBe("done");
    expect(await status(c.id)).toBe("union_celebrated");
    expect(await send(p.yao!, c.chat, "Merci")).toMatch(/conversation_closed/);
    expect((await as(p.ablavi!, "select id from app.messages where conversation_id = $1", [c.chat])).length).toBeGreaterThan(0);
    const { delete_after } = await one<{ delete_after: Date }>("select delete_after from app.conversations where id = $1", [c.chat]);
    expect(delete_after.getTime() - Date.now()).toBeGreaterThan(360 * 86_400_000);
    await decide(p.ablavi!, c.id, "keep_chat");
    expect(await decide(p.yao!, c.id, "keep_chat")).toBe("done");
    expect((await one<{ delete_after: Date | null }>("select delete_after from app.conversations where id = $1", [c.chat])).delete_after).toBeNull();
  });

  it("séparation décidée par les deux : chat fermé et illisible, 90 jours, 1 mois sans soirées pour les deux", async () => {
    const c = await couple(p.sena!, p.kodjo!);
    await send(p.sena!, c.chat, "Bonsoir");
    expect(await decide(p.sena!, c.id, "separation")).toBe("recorded");
    expect(await decide(p.kodjo!, c.id, "separation")).toBe("done");
    expect(await status(c.id)).toBe("separated");
    expect(await as(p.sena!, "select id from app.messages where conversation_id = $1", [c.chat])).toEqual([]);
    const { delete_after } = await one<{ delete_after: Date }>("select delete_after from app.conversations where id = $1", [c.chat]);
    expect(Math.round((delete_after.getTime() - Date.now()) / 86_400_000)).toBe(90);
    const soon = await createEvent(db, { startsInHours: 120 });
    expect(await failure(as(p.kodjo!, "select app.book_event($1)", [soon]))).toMatch(/blocked_until/);
  });

  it("départ d'un seul : fin immédiate ; message signé du conseiller, ou neutre sans conseiller ; pas d'attente", async () => {
    const withCounselor = await couple(p.mariam!, p.dossou!, p.conseillere!);
    expect(await failure(as(p.dossou!, "select app.leave_couple($1)", [withCounselor.id]))).toBeNull();
    expect(await status(withCounselor.id)).toBe("left");
    const { rows } = await db.query<{ payload: { counselor: string } }>(
      "select payload from app.notifications where user_id = $1 and kind = 'couple.ended_by_partner_counselor'",
      [p.mariam],
    );
    expect(rows[0]!.payload.counselor).toBe("Mme Conseillère");
    const { rows: access } = await db.query<{ status: string }>("select status from app.counselor_access where couple_id = $1", [withCounselor.id]);
    expect(access[0]!.status).toBe("revoked");
    const soon = await createEvent(db, { startsInHours: 150 });
    expect(await failure(as(p.mariam!, "select app.book_event($1)", [soon]))).toBeNull();
    // Couple sans conseiller : message neutre
    const c = await couple(p.ablavi!, p.kodjo!);
    await as(p.kodjo!, "select app.leave_couple($1)", [c.id]);
    expect(await notified(p.ablavi!, "couple.ended_by_partner")).toBe(1);
    expect(await failure(as(p.kodjo!, "select app.leave_couple($1)", [c.id]))).toMatch(/invalid_status/);
  });

  it("effacement à l'échéance par la tâche planifiée ; chacun ne voit que ses propres demandes", async () => {
    const c = await couple(p.afiwa!, p.yao!);
    await send(p.afiwa!, c.chat, "Bonjour");
    await as(p.afiwa!, "select app.couple_decide($1, 'separation')", [c.id]);
    const mine = await as<{ my_requests: string[] }>(p.yao!, "select * from app.my_couple()");
    expect(mine[0]!.my_requests).toEqual([]);
    await db.query("update app.conversations set delete_after = now() - interval '1 minute' where id = $1", [c.chat]);
    await asSystem("select app.purge_conversations()");
    expect((await db.query("select 1 from app.messages where conversation_id = $1", [c.chat])).rows).toEqual([]);
  });
});
