import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Espace du couple (9.5 ; question 10 d) : partage des numéros à double clic, rendez-vous
 * déclarés, étapes du parcours lisibles par les deux seulement.
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

async function couple(a: string, b: string) {
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now(), 'continued') returning id", [m.id]);
  const c = await one<{ id: string }>(
    "insert into app.couples (discovery_id, member_a, member_b) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid)) returning id",
    [d.id, a, b],
  );
  await db.query("insert into app.conversations (kind, couple_id) values ('couple', $1)", [c.id]);
  return c.id;
}

type Phone = { i_shared: boolean; can_share: boolean; partner_phone: string | null };
const phone = async (user: string, id: string) => (await as<Phone>(user, "select * from app.my_couple_phone($1)", [id]))[0]!;
const share = (user: string, id: string) => as<{ r: boolean }>(user, "select app.share_my_phone($1) as r", [id]).then((r) => r[0]!.r);
const phoneOf = async (user: string) => (await one<{ phone: string }>("select phone from app.users where id = $1", [user])).phone;

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex] of [
    ["afiwa", "female"],
    ["koffi", "male"],
    ["sena", "female"],
    ["dossou", "male"],
    ["ablavi", "female"],
    ["yao", "male"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex });
  }
  event = await createEvent(db, { startsInHours: -48, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Partage des numéros (9.5, question 10 d)", () => {
  it("le numéro de l'autre n'apparaît que quand les deux ont cliqué ; on ne sait pas si l'autre a cliqué", async () => {
    const c = await couple(p.afiwa!, p.koffi!);
    expect(await phone(p.afiwa!, c)).toEqual({ i_shared: false, can_share: true, partner_phone: null });
    expect(await share(p.afiwa!, c)).toBe(false);
    expect(await phone(p.afiwa!, c)).toEqual({ i_shared: true, can_share: true, partner_phone: null });
    expect(await phone(p.koffi!, c)).toEqual({ i_shared: false, can_share: true, partner_phone: null });
    expect(await share(p.koffi!, c)).toBe(true);
    expect((await phone(p.afiwa!, c)).partner_phone).toBe(await phoneOf(p.koffi!));
    expect((await phone(p.koffi!, c)).partner_phone).toBe(await phoneOf(p.afiwa!));
    // Personne d'autre, ni lecture directe de la table
    expect(await as(p.sena!, "select * from app.my_couple_phone($1)", [c])).toEqual([]);
    expect(await failure(as(p.sena!, "select app.share_my_phone($1)", [c]))).toMatch(/not_member/);
    expect(await as(p.afiwa!, "select * from app.phone_shares")).toEqual([]);
    // Blocage par l'administration : numéro masqué ; fin du couple : numéro masqué
    await db.query("update app.couples set blocked_at = now() where id = $1", [c]);
    expect((await phone(p.afiwa!, c)).partner_phone).toBeNull();
    await db.query("update app.couples set blocked_at = null, status = 'left', ended_at = now() where id = $1", [c]);
    expect((await phone(p.afiwa!, c)).partner_phone).toBeNull();
    expect(await failure(as(p.afiwa!, "select app.share_my_phone($1)", [c]))).toMatch(/invalid_status/);
  });

  it("réglage « Autoriser le partage » désactivé, numéro absent ou couple bloqué : pas de partage", async () => {
    const c = await couple(p.sena!, p.dossou!);
    await db.query("update app.member_profiles set share_phone = false where user_id = $1", [p.sena]);
    expect((await phone(p.sena!, c)).can_share).toBe(false);
    expect(await failure(as(p.sena!, "select app.share_my_phone($1)", [c]))).toMatch(/phone_sharing_disabled/);
    await db.query("update app.users set phone = null where id = $1", [p.dossou]);
    expect((await phone(p.dossou!, c)).can_share).toBe(false);
    expect(await failure(as(p.dossou!, "select app.share_my_phone($1)", [c]))).toMatch(/no_phone/);
    const blocked = await couple(p.ablavi!, p.yao!);
    await db.query("update app.couples set blocked_at = now() where id = $1", [blocked]);
    expect(await failure(as(p.ablavi!, "select app.share_my_phone($1)", [blocked]))).toMatch(/couple_blocked/);
  });
});

describe("Rendez-vous et étapes (9.5)", () => {
  it("rendez-vous déclaré par l'un des deux, pendant le couple en cours, compté comme activité", async () => {
    const c = await couple(p.afiwa!, p.yao!);
    await db.query("update app.couples set last_activity_at = now() - interval '10 days' where id = $1", [c]);
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(await failure(as(p.yao!, "select app.declare_date($1, $2)", [c, when]))).toBeNull();
    const dates = await as<{ declared_by_me: boolean }>(p.afiwa!, "select * from app.my_couple_dates($1)", [c]);
    expect(dates).toHaveLength(1);
    expect(dates[0]!.declared_by_me).toBe(false);
    const { last } = await one<{ last: Date }>("select last_activity_at as last from app.couples where id = $1", [c]);
    expect(Date.now() - last.getTime()).toBeLessThan(60_000);
    expect(await as(p.sena!, "select * from app.my_couple_dates($1)", [c])).toEqual([]);
    expect(await failure(as(p.sena!, "select app.declare_date($1, $2)", [c, when]))).toMatch(/not_member/);
    expect(await failure(as(p.yao!, "select app.declare_date($1, null)", [c]))).toMatch(/invalid_date/);
    await db.query("update app.couples set status = 'paused' where id = $1", [c]);
    expect(await failure(as(p.yao!, "select app.declare_date($1, $2)", [c, when]))).toMatch(/invalid_status/);
  });

  it("étapes du parcours lisibles par les deux membres seulement", async () => {
    const c = await couple(p.koffi!, p.ablavi!);
    await db.query("insert into app.couple_milestones (couple_id, kind, reached_at) values ($1, 'first_dates', now())", [c]);
    expect(await as(p.koffi!, "select kind from app.couple_milestones where couple_id = $1", [c])).toEqual([{ kind: "first_dates" }]);
    expect(await as(p.sena!, "select kind from app.couple_milestones where couple_id = $1", [c])).toEqual([]);
  });

  it("messages non lus : ceux de l'autre depuis la dernière lecture, jamais les messages système", async () => {
    const c = await couple(p.sena!, p.yao!);
    const chat = (await one<{ id: string }>("select id from app.conversations where couple_id = $1", [c])).id;
    const unread = async (user: string) =>
      (await as<{ unread: number }>(user, "select unread from app.my_unread_messages() where couple_id = $1", [c]))[0]?.unread ?? null;
    await as(p.sena!, "select app.send_message($1, 'Bonjour')", [chat]);
    await as(p.sena!, "select app.send_message($1, 'Tu vas bien ?')", [chat]);
    await db.query("select app.couple_system_message($1, 'couple.resumed', null)", [c]);
    expect(await unread(p.yao!)).toBe(2);
    expect(await unread(p.sena!)).toBe(0);
    await as(p.yao!, "select app.mark_conversation_read($1)", [chat]);
    expect(await unread(p.yao!)).toBe(0);
    expect(await unread(p.afiwa!)).toBeNull();
    expect(await failure(as(p.afiwa!, "select app.mark_conversation_read($1)", [chat]))).toMatch(/not_member/);
  });
});
