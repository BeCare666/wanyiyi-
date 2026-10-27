import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Canal privé avec le conseiller du couple et séances (question 9, validée le 27 octobre 2026).
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

async function couple(a: string, b: string, counselor: string | null) {
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now(), 'continued') returning id", [m.id]);
  const c = await one<{ id: string }>(
    "insert into app.couples (discovery_id, member_a, member_b, counselor_id) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), $4) returning id",
    [d.id, a, b, counselor],
  );
  await db.query("insert into app.conversations (kind, couple_id) values ('couple', $1)", [c.id]);
  if (counselor) {
    await db.query(
      "insert into app.counselor_access (couple_id, counselor_id, requested_by, status, accepted_at, granted_at, price_xof) values ($1, $2, $3, 'granted', now(), now(), 0)",
      [c.id, counselor, a],
    );
  }
  return c.id;
}

const open = (user: string, c: string) => as<{ id: string }>(user, "select app.open_private_channel($1) as id", [c]).then((r) => r[0]!.id);

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["conseillere", "female", "counselor"],
    ["autre", "male", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Mme Conseillère'), ($2, 'M. Autre')", [p.conseillere, p.autre]);
  event = await createEvent(db, { startsInHours: -48, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Canal privé (question 9)", () => {
  it("avec le conseiller du couple seulement ; chacun le sien ; l'autre membre ne le lit pas", async () => {
    const lone = await couple(p.sena!, p.dossou!, null);
    expect(await failure(as(p.sena!, "select app.open_private_channel($1)", [lone]))).toMatch(/no_counselor/);
    const c = await couple(p.afiwa!, p.koffi!, p.conseillere!);
    const mine = await open(p.afiwa!, c);
    expect(await open(p.afiwa!, c)).toBe(mine);
    expect(await open(p.koffi!, c)).not.toBe(mine);
    await as(p.afiwa!, "select app.send_message($1, 'Je voudrais vous parler seule')", [mine]);
    await as(p.conseillere!, "select app.send_message($1, 'Bien sûr')", [mine]);
    expect(await as(p.koffi!, "select id from app.messages where conversation_id = $1", [mine])).toEqual([]);
    expect(await as(p.autre!, "select id from app.messages where conversation_id = $1", [mine])).toEqual([]);
    expect(await as(p.conseillere!, "select id from app.messages where conversation_id = $1", [mine])).toHaveLength(2);
    const channels = await as<{ member_first_name: string; unread: number }>(p.conseillere!, "select * from app.counselor_private_channels()");
    expect(channels.find((ch) => ch.member_first_name === "afiwa")!.unread).toBe(1);
    expect(await failure(as(p.sena!, "select app.open_private_channel($1)", [c]))).toMatch(/not_member/);
  });

  it("conseiller retiré : canal fermé, illisible, effacé après 90 jours", async () => {
    const c = await couple(p.sena!, p.koffi!, p.conseillere!);
    const ch = await open(p.sena!, c);
    await as(p.sena!, "select app.send_message($1, 'Bonjour')", [ch]);
    const [{ id: access }] = (await db.query<{ id: string }>("select id from app.counselor_access where couple_id = $1", [c])).rows as [{ id: string }];
    await as(p.koffi!, "select app.revoke_counselor_access($1)", [access]);
    expect(await as(p.sena!, "select id from app.messages where conversation_id = $1", [ch])).toEqual([]);
    expect(await as(p.conseillere!, "select id from app.messages where conversation_id = $1", [ch])).toEqual([]);
    const { delete_after } = await one<{ delete_after: Date }>("select delete_after from app.conversations where id = $1", [ch]);
    expect(Math.round((delete_after.getTime() - Date.now()) / 86_400_000)).toBe(90);
    expect(await failure(as(p.sena!, "select app.send_message($1, 'Encore là ?')", [ch]))).toMatch(/not_member|conversation_closed/);
  });
});

describe("Séances (question 9 c)", () => {
  it("proposées par le conseiller, confirmées quand les deux acceptent, faites : étape franchie", async () => {
    const c = await couple(p.afiwa!, p.dossou!, p.conseillere!);
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(await failure(as(p.afiwa!, "select app.propose_session($1, $2, 'online', null)", [c, soon]))).toMatch(/not_counselor/);
    expect(await failure(as(p.conseillere!, "select app.propose_session($1, now() - interval '1 hour', 'online', null)", [c]))).toMatch(/invalid_date/);
    expect(await failure(as(p.conseillere!, "select app.propose_session($1, $2, 'place', ' ')", [c, soon]))).toMatch(/location_required/);
    const [{ id }] = await as<{ id: string }>(p.conseillere!, "select app.propose_session($1, $2, 'place', 'Café des Cocotiers') as id", [c, soon]);
    expect((await db.query("select 1 from app.notifications where user_id = $1 and kind = 'session.proposed'", [p.dossou])).rows).toHaveLength(1);
    expect((await as<{ r: string }>(p.afiwa!, "select app.accept_session($1) as r", [id]))[0]!.r).toBe("recorded");
    const seen = await as<{ i_accepted: boolean; status: string }>(p.dossou!, "select * from app.couple_sessions($1)", [c]);
    expect(seen[0]).toMatchObject({ i_accepted: false, status: "proposed" });
    expect((await as<{ r: string }>(p.dossou!, "select app.accept_session($1) as r", [id]))[0]!.r).toBe("confirmed");
    expect(await as(p.conseillere!, "select * from app.counselor_agenda()")).toHaveLength(1);
    // Pas encore l'heure : pas « faite »
    expect(await failure(as(p.conseillere!, "select app.complete_session($1)", [id]))).toMatch(/invalid_status/);
    await db.query("update app.sessions set scheduled_at = now() - interval '1 hour' where id = $1", [id]);
    await as(p.conseillere!, "select app.complete_session($1)", [id]);
    const { reached_at } = await one<{ reached_at: Date | null }>("select reached_at from app.couple_milestones where couple_id = $1 and kind = 'counselor_sessions'", [c]);
    expect(reached_at).not.toBeNull();
    expect(await failure(as(p.autre!, "select app.cancel_session($1)", [id]))).toMatch(/not_counselor/);
    expect(await as(p.sena!, "select * from app.couple_sessions($1)", [c])).toEqual([]);
  });

  it("annulation par le conseiller", async () => {
    const fresh = await couple(p.koffi!, p.dossou!, p.autre!);
    const [{ id }] = await as<{ id: string }>(p.autre!, "select app.propose_session($1, now() + interval '2 days', 'online', null) as id", [fresh]);
    await as(p.autre!, "select app.cancel_session($1)", [id]);
    expect(await failure(as(p.koffi!, "select app.accept_session($1)", [id]))).toMatch(/not_pending/);
  });
});
